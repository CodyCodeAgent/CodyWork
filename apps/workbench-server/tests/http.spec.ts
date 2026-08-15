import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchDb } from '../src/db/index.js'
import { KnowledgeIndex } from '../src/services/knowledge.js'
import { startServer } from '../src/routes/index.js'

let root: string
let db: WorkbenchDb
let search: KnowledgeIndex
let server: ReturnType<typeof startServer>
let base: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'http-test-'))
  db = new WorkbenchDb(':memory:')
  search = new KnowledgeIndex(':memory:')
  server = startServer({ db, root, search }, 0)
  await new Promise<void>(resolve => server.on('listening', resolve))
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  base = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  search.close()
  db.close()
  rmSync(root, { recursive: true, force: true })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTTP test responses are heterogeneous (objects/arrays/booleans)
async function req(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: any; error?: string; status: number }> {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  return { ok: json.ok, data: json.data, error: json.error, status: res.status }
}

describe('HTTP 路由集成测试', () => {
  let wsId: string

  it('健康检查', async () => {
    const r = await req('GET', '/api/health')
    expect(r.ok).toBe(true)
  })

  it('创建 → 列出 → 删除工作台', async () => {
    const created = await req('POST', '/api/workspaces', { name: 'http-demo', path: join(root, 'http-demo') })
    expect(created.ok).toBe(true)
    wsId = created.data.id

    const list = await req('GET', '/api/workspaces')
    expect(list.data.length).toBe(1)
    expect(list.data[0].name).toBe('http-demo')

    const del = await req('DELETE', `/api/workspaces/${wsId}`)
    expect(del.ok).toBe(true)
    expect((await req('GET', '/api/workspaces')).data.length).toBe(0)
  })

  it('缺参数创建返回错误', async () => {
    const r = await req('POST', '/api/workspaces', { name: 'x' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(400)
    expect(r.error).toContain('必填')
  })

  it('需求全流程：创建 → 列表 → 状态流转', async () => {
    const ws = await req('POST', '/api/workspaces', { name: 'demand-ws', path: join(root, 'demand-ws') })
    wsId = ws.data.id

    const d = await req('POST', `/api/workspaces/${wsId}/demands`, { name: '测试需求' })
    expect(d.ok).toBe(true)
    expect(d.data.status).toBe('draft')

    const list = await req('GET', `/api/workspaces/${wsId}/demands`)
    expect(list.data.length).toBe(1)

    const upd = await req('PUT', `/api/demands/${d.data.id}/status`, { status: 'spec' })
    expect(upd.ok).toBe(true)
    expect(upd.data.status).toBe('spec')

    // 非法状态
    const bad = await req('PUT', `/api/demands/${d.data.id}/status`, { status: 'invalid' })
    expect(bad.ok).toBe(false)
  })

  it('docs 读写', async () => {
    const ws = await req('POST', '/api/workspaces', { name: 'docs-ws', path: join(root, 'docs-ws') })
    wsId = ws.data.id

    const list = await req('GET', `/api/workspaces/${wsId}/docs`)
    expect(list.data.files).toContain('CONSTITUTION.md')

    const write = await req('PUT', `/api/workspaces/${wsId}/docs/CODING.md`, { content: '# 新规范\n' })
    expect(write.ok).toBe(true)

    const read = await req('GET', `/api/workspaces/${wsId}/docs/CODING.md`)
    expect(read.data.content).toBe('# 新规范\n')
  })

  it('404 未匹配路由', async () => {
    const r = await req('GET', '/api/nonexistent')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
  })

  it('AI 端点未配置时优雅报错', async () => {
    const ws = await req('POST', '/api/workspaces', { name: 'ai-ws', path: join(root, 'ai-ws') })
    wsId = ws.data.id
    const d = await req('POST', `/api/workspaces/${wsId}/demands`, { name: 'AI需求' })

    const sdd = await req('POST', `/api/demands/${d.data.id}/sdd/spec`)
    expect(sdd.ok).toBe(false)
    expect(sdd.error).toContain('未配置')

    const compound = await req('POST', `/api/demands/${d.data.id}/compound`)
    expect(compound.ok).toBe(false)
    expect(compound.error).toContain('未配置')
  })
})
