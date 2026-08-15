import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import {
  WorkbenchDb,
  nowIso,
  makeId,
  slugify,
  DemandStatus,
  SDD_STEPS,
  WorkspaceRow,
  DemandRow,
} from '../db/index.js'
import * as csr from '../services/csr.js'
import { generateSddStep, SDD_STEPS as AI_STEPS, AiConfig } from '../services/ai.js'
import { KnowledgeIndex } from '../services/knowledge.js'

type Handler = (ctx: Ctx) => Promise<unknown> | unknown

interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  body: Record<string, unknown> | null
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => (data += c))
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function json(res: ServerResponse, code: number, payload: unknown) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(body)
}

export interface AppContext {
  db: WorkbenchDb
  root: string
  ai?: AiConfig | undefined
  search?: KnowledgeIndex | undefined
}

/** 路由表：method + 路径模式（:param）。 */
function buildRoutes(ctx: AppContext): { method: string; pattern: string; handler: Handler }[] {
  const routes: { method: string; pattern: string; handler: Handler }[] = []

  const r = (method: string, pattern: string, handler: Handler) => routes.push({ method, pattern, handler })

  // ── 工作台实例 ──
  r('GET', '/api/workspaces', () => {
    return ctx.db.db.prepare('SELECT * FROM workspaces ORDER BY created_at DESC').all()
  })
  r('POST', '/api/workspaces', (c) => {
    const body = c.body ?? {}
    const name = body['name']
    const path = body['path']
    const repos = Array.isArray(body['repos']) ? (body['repos'] as unknown[]) : []
    if (!name || !path) throw new Error('name 和 path 必填')
    const nameStr = String(name)
    const pathStr = String(path)
    const id = makeId('ws')
    csr.initCsrSkeleton(pathStr, nameStr)
    ctx.db.db
      .prepare('INSERT INTO workspaces (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run(id, nameStr, pathStr, nowIso())
    for (const url of repos) {
      const added = csr.addRepo(pathStr, String(url))
      if (added.ok && added.name) {
        ctx.db.db
          .prepare('INSERT INTO repos (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)')
          .run(makeId('repo'), id, added.name, nowIso())
      }
    }
    return { id, name: nameStr, path: pathStr }
  })
  r('DELETE', '/api/workspaces/:id', (c) => {
    const ws = ctx.db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(param(c, 'id'))
    if (!ws) return { ok: false, error: 'not found' }
    ctx.db.db.prepare('DELETE FROM workspaces WHERE id = ?').run(param(c, 'id'))
    return { ok: true }
  })

  // ── 仓库 ──
  r('GET', '/api/workspaces/:id/repos', (c) => {
    const ws = getWs(ctx, param(c, 'id'))
    const repos = ctx.db.db.prepare('SELECT * FROM repos WHERE workspace_id = ? ORDER BY name').all(param(c, 'id'))
    return repos.map(row => ({ ...(row as object), status: csr.repoStatus(ws.path, String((row as { name: string }).name)) }))
  })
  r('POST', '/api/workspaces/:id/repos', (c) => {
    const ws = getWs(ctx, param(c, 'id'))
    const { url } = c.body ?? {}
    if (!url) throw new Error('url 必填')
    const added = csr.addRepo(ws.path, String(url))
    if (!added.ok || !added.name) return { ok: false, error: added.error ?? '添加失败' }
    const repoName = added.name
    ctx.db.db
      .prepare('INSERT INTO repos (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(makeId('repo'), param(c, 'id'), repoName, nowIso())
    return { ok: true, name: repoName }
  })
  r('DELETE', '/api/workspaces/:id/repos/:name', (c) => {
    ctx.db.db.prepare('DELETE FROM repos WHERE workspace_id = ? AND name = ?').run(param(c, 'id'), param(c, 'name'))
    return { ok: true }
  })

  // ── 需求 ──
  r('GET', '/api/workspaces/:id/demands', (c) => {
    return ctx.db.db.prepare('SELECT * FROM demands WHERE workspace_id = ? ORDER BY created_at DESC').all(param(c, 'id'))
  })
  r('POST', '/api/workspaces/:id/demands', (c) => {
    const ws = getWs(ctx, param(c, 'id'))
    const { name } = c.body ?? {}
    if (!name) throw new Error('name 必填')
    const slug = slugify(String(name))
    const id = makeId('demand')
    csr.createDemandSpecs(ws.path, slug)
    ctx.db.db
      .prepare('INSERT INTO demands (id, workspace_id, name, slug, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, param(c, 'id'), String(name), slug, 'draft', nowIso())
    return { id, slug, status: 'draft' }
  })
  r('GET', '/api/demands/:id', (c) => {
    const d = getDemand(ctx, param(c, 'id'))
    const ws = getWs(ctx, d.workspace_id)
    return { ...d, worktrees: csr.listWorktrees(ws.path, d.slug) }
  })
  r('PUT', '/api/demands/:id/status', (c) => {
    getDemand(ctx, param(c, 'id'))
    const status = c.body?.['status']
    if (!SDD_STEPS.includes(status as DemandStatus)) throw new Error(`非法状态: ${String(status)}`)
    ctx.db.db.prepare('UPDATE demands SET status = ? WHERE id = ?').run(String(status), param(c, 'id'))
    return { ok: true, status: String(status) }
  })

  // ── AI 生成层（生成性操作）──
  r('POST', '/api/demands/:id/sdd/:step', async (c) => {
    const d = getDemand(ctx, param(c, 'id'))
    const ws = getWs(ctx, d.workspace_id)
    if (!ctx.ai) throw new Error('AI 生成层未配置（缺少 DEEPSEEK_API_KEY 或 dsh 运行时）')
    const step = AI_STEPS.find(s => s.step === param(c, 'step'))
    if (!step) throw new Error(`非法步骤: ${param(c, 'step')}`)
    const content = await generateSddStep({ ...ctx.ai, cwd: ws.path }, d.slug, step)
    return { step: step.step, content }
  })

  // ── worktree ──
  r('POST', '/api/demands/:id/worktrees', (c) => {
    const d = getDemand(ctx, param(c, 'id'))
    const ws = getWs(ctx, d.workspace_id)
    const reposRaw = c.body?.['repos']
    const repos = Array.isArray(reposRaw) ? (reposRaw as unknown[]) : []
    const results: { ok: boolean; path?: string; error?: string }[] = []
    for (const repoName of repos) {
      results.push(csr.createWorktree(ws.path, d.slug, String(repoName)))
    }
    return { results }
  })
  r('DELETE', '/api/demands/:id/worktrees/:repo', (c) => {
    const d = getDemand(ctx, param(c, 'id'))
    const ws = getWs(ctx, d.workspace_id)
    return csr.removeWorktree(ws.path, d.slug, param(c, 'repo'))
  })

  // ── 知识库 ──
  r('GET', '/api/workspaces/:id/docs', (c) => {
    const ws = getWs(ctx, param(c, 'id'))
    return { files: csr.listDocs(ws.path) }
  })
  r('GET', '/api/workspaces/:id/docs/*path', (c) => {
    const ws = getWs(ctx, param(c, 'id'))
    const rel = param(c, 'path')
    return { path: rel, content: csr.readFile(ws.path, rel) }
  })
  r('PUT', '/api/workspaces/:id/docs/*path', (c) => {
    const ws = getWs(ctx, param(c, 'id'))
    csr.writeFile(ws.path, param(c, 'path'), String(c.body?.content ?? ''))
    return { ok: true }
  })

  // ── 知识/排障检索 ──
  r('GET', '/api/workspaces/:id/search', (c) => {
    getWs(ctx, param(c, 'id'))
    const q = c.query.get('q') ?? ''
    if (!ctx.search) throw new Error('检索未配置')
    const hits = ctx.search.search(q)
    return { query: q, hits, total: hits.length }
  })
  r('POST', '/api/workspaces/:id/search/rebuild', (c) => {
    const ws = getWs(ctx, param(c, 'id'))
    if (!ctx.search) throw new Error('检索未配置')
    return ctx.search.rebuild(ws.path)
  })

  // ── 健康检查 ──
  r('GET', '/api/health', () => ({ ok: true }))

  return routes
}

function getWs(ctx: AppContext, id: string): WorkspaceRow {
  const ws = ctx.db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined
  if (!ws) throw new Error(`workspace ${id} 不存在`)
  return ws
}
function getDemand(ctx: AppContext, id: string): DemandRow {
  const d = ctx.db.db.prepare('SELECT * FROM demands WHERE id = ?').get(id) as DemandRow | undefined
  if (!d) throw new Error(`demand ${id} 不存在`)
  return d
}

/** 路径匹配：/api/workspaces/:id/docs/*path → params { id, path }。 */
function match(pattern: string, pathname: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const sp = pathname.split('/').filter(Boolean)
  if (pp.length > sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    const pseg = pp[i]
    const sseg = sp[i]
    if (pseg === undefined || sseg === undefined) return null
    if (pseg.startsWith(':')) {
      params[pseg.slice(1)] = sseg
    } else if (pseg === '*') {
      params['path'] = sp.slice(i).join('/')
      return params
    } else if (pseg !== sseg) {
      return null
    }
  }
  if (pp.length !== sp.length) return null
  return params
}

/** 取路径参数，缺省为空串（路由已保证存在）。 */
function param(c: Ctx, key: string): string {
  return c.params[key] ?? ''
}

export function startServer(ctx: AppContext, port: number) {
  const routes = buildRoutes(ctx)
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      return res.end()
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'
    const pathname = url.pathname
    const route = routes.find(rt => rt.method === method && match(rt.pattern, pathname))
    if (!route) {
      return json(res, 404, { ok: false, error: `not found: ${method} ${pathname}` })
    }
    const c: Ctx = {
      req,
      res,
      params: match(route.pattern, pathname) ?? {},
      query: url.searchParams,
      body: await readBody(req).catch(() => null),
    }
    try {
      const result = await route.handler(c)
      json(res, 200, { ok: true, data: result })
    } catch (e) {
      json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
  server.listen(port, () => {
    console.log(`[cody-workbench] server listening on http://127.0.0.1:${port}`)
  })
  return server
}
