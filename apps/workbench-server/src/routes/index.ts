import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { WebSocketServer, WebSocket } from 'ws'
import { WorkbenchDb, WorkspaceRow } from '../db/index.js'
import { inspectWorkspace, prepareWorkspace, WorkspaceSource } from '../services/workspace.js'
import { addRepositoryToDemand, createDemand, getDemand, importExistingWorktrees, listDemands } from '../services/demands.js'
import { addRepository, clearRepositoryBaselineChanges, listCachedRepositories, syncRepositoryBaseline } from '../services/repositories.js'
import { delegateWorkspaceInitialization } from '../runtime/bootstrap.js'
import { CodyWorkCodexRuntime } from '../runtime/codex.js'
import { runtimeSettings, runtimeSettingsRow, updateRuntimeSettings } from '../runtime/settings.js'
import type { RuntimeSettingsPatch } from '../runtime/settings.js'
import { ConversationService } from '../services/conversations.js'
import { getSkill, listSkills } from '../services/skills.js'
import { getKnowledgeDocument, listKnowledgeDocuments } from '../services/knowledge.js'
import { listBrowsableDirectories } from '../services/directories.js'
import { DashboardCache } from '../services/dashboardCache.js'
import { createStaticAssetHandler } from '../http/staticAssets.js'
import { WorkspaceRegistry } from '../services/workspaceRegistry.js'
import { WorkspaceSetupCoordinator } from '../services/workspaceSetup.js'
import { SkillInstallCoordinator } from '../services/skillInstall.js'
import { AuthSessions } from '../services/authSessions.js'
import { ConversationImageUploads } from '../services/imageUploads.js'
import { createQuickAction, deleteQuickAction, listQuickActions, updateQuickAction } from '../services/quickActions.js'
import type { QuickActionInput } from '../services/quickActions.js'
import { CodyWorkChannelService } from '../services/channelBot.js'

export const CONVERSATION_WEBSOCKET_MAX_BUFFERED_BYTES = 4 * 1024 * 1024

function sendConversationSocket(client: WebSocket, payload: unknown): boolean {
  if (client.readyState !== WebSocket.OPEN) return false
  if (client.bufferedAmount > CONVERSATION_WEBSOCKET_MAX_BUFFERED_BYTES) {
    client.terminate()
    return false
  }
  try {
    client.send(JSON.stringify(payload))
    return true
  } catch {
    client.terminate()
    return false
  }
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown

interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  body: Record<string, unknown>
  query: URLSearchParams
}

export interface AppContext {
  db: WorkbenchDb
  conversations?: ConversationService
  dashboards?: DashboardCache
  workspaces?: WorkspaceRegistry
  workspaceSetup?: WorkspaceSetupCoordinator
  skillInstalls?: SkillInstallCoordinator
  images?: ConversationImageUploads
  channels?: CodyWorkChannelService
}

export function normalizeRepositoryInput(body: Record<string, unknown>): {
  source: 'git' | 'folder'
  url?: string
  path?: string
  name?: string
} {
  const rawType = body.source
  if (rawType !== 'folder' && rawType !== 'git') throw new Error('Repo source 必须是 folder 或 git')
  return {
    source: rawType,
    ...(typeof body.url === 'string' ? { url: body.url } : {}),
    ...(typeof body.path === 'string' ? { path: body.path } : {}),
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
  }
}

const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:3211', 'http://localhost:3211'])
const publicOrigin = process.env.CODYWORK_PUBLIC_ORIGIN?.trim()
if (publicOrigin) ALLOWED_ORIGINS.add(publicOrigin)

export function isAllowedOrigin(origin: string, requestHost?: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const url = new URL(origin)
    if (requestHost && url.host === requestHost) return true
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  } catch {
    return false
  }
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin
  return typeof origin === 'string' && isAllowedOrigin(origin, req.headers.host)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}
}

function json(req: IncomingMessage, res: ServerResponse, code: number, payload: unknown) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    // Workspace, Demand, and conversation state is user-mutated; never let a browser reuse stale API data.
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...corsHeaders(req),
  })
  res.end(JSON.stringify(payload))
}

const AUTH_COOKIE = 'codywork_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function requestCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie
  if (!raw) return {}
  return Object.fromEntries(raw.split(';').map(part => {
    const [key, ...rest] = part.trim().split('=')
    return [key ?? '', decodeURIComponent(rest.join('='))]
  }).filter(([key]) => Boolean(key)))
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function passwordsMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function loginPage(error = ''): string {
  const notice = error ? '<p class="error">密码不正确，请重试。</p>' : ''
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CodyWork 登录</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#1f2937;font:16px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(360px,calc(100vw - 48px));padding:32px;border:1px solid #dbe2f0;border-radius:18px;background:#fff;box-shadow:0 18px 50px #1e293b18}h1{margin:0 0 8px;font-size:26px}p{color:#64748b;line-height:1.55}.error{color:#b91c1c}label{display:grid;gap:8px;font-weight:600}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit}button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:#5b5bf7;color:#fff;font:600 16px inherit;cursor:pointer}</style><main class="card"><h1>CodyWork</h1><p>请输入访问密码以继续。</p>${notice}<form method="post" action="/api/auth/login"><label>访问密码<input name="password" type="password" autofocus required autocomplete="current-password"></label><button type="submit">登录</button></form></main></html>`
}

function parseLoginPassword(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const contentType = String(req.headers['content-type'] ?? '')
        if (contentType.includes('application/json')) {
          const value = JSON.parse(body) as { password?: unknown }
          return resolve(typeof value.password === 'string' ? value.password : '')
        }
        resolve(new URLSearchParams(body).get('password') ?? '')
      } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function readBody(req: IncomingMessage, maxBytes = 1 * 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes <= maxBytes) data += chunk.toString('utf8')
    })
    req.on('end', () => {
      if (bytes > maxBytes) return reject(new Error('请求内容过大'))
      if (!data) return resolve({})
      try {
        const parsed: unknown = JSON.parse(data)
        resolve(typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function normalizeSource(body: Record<string, unknown>): WorkspaceSource {
  const source = body.source
  if (typeof source !== 'object' || source === null) throw new Error('缺少 Workspace source')
  const value = source as Record<string, unknown>
  const normalized: WorkspaceSource = {
    type: value.type === 'git' ? 'git' : 'folder',
  }
  if (typeof value.path === 'string') normalized.path = value.path
  if (typeof value.url === 'string') normalized.url = value.url
  if (typeof value.destination === 'string') normalized.destination = value.destination
  return normalized
}

function requiredParam(ctx: Ctx, key: string): string {
  const value = ctx.params[key]
  if (!value) throw new Error(`参数缺失：${key}`)
  return value
}

function conversationService(ctx: AppContext): ConversationService {
  if (!ctx.conversations) ctx.conversations = new ConversationService(ctx.db, createDefaultRuntime(ctx.db), workspaceId => {
    setTimeout(() => {
      const workspace = ctx.db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined
      if (workspace) void dashboardCache(ctx).refresh(workspace)
    }, 30_000)
  }, (workspaceId, conversationId, path) => imageUploads(ctx).urlForPath(workspaceId, conversationId, path), (workspaceId, conversationId) => imageUploads(ctx).removeConversation(workspaceId, conversationId))
  return ctx.conversations
}

function workspaceSkillCatalog(ctx: AppContext, workspace: WorkspaceRow, forceReload = false) {
  return listSkills(conversationService(ctx).getRuntime(), workspace, forceReload)
}

function imageUploads(ctx: AppContext): ConversationImageUploads {
  if (!ctx.images) ctx.images = new ConversationImageUploads(ctx.db)
  return ctx.images
}

function dashboardCache(ctx: AppContext): DashboardCache {
  if (!ctx.dashboards) ctx.dashboards = new DashboardCache(ctx.db)
  return ctx.dashboards
}

function workspaceRegistry(ctx: AppContext): WorkspaceRegistry {
  if (!ctx.workspaces) {
    ctx.workspaces = new WorkspaceRegistry(ctx.db, workspace => { void dashboardCache(ctx).refresh(workspace) })
  }
  return ctx.workspaces
}

export function channelService(ctx: AppContext): CodyWorkChannelService {
  if (!ctx.channels) ctx.channels = new CodyWorkChannelService(ctx.db, conversationService(ctx), workspaceRegistry(ctx))
  return ctx.channels
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : []
}

function channelAccountInput(body: Record<string, unknown>) {
  return {
    name: typeof body.name === 'string' ? body.name : '',
    appId: typeof body.appId === 'string' ? body.appId : '',
    ...(typeof body.appSecret === 'string' ? { appSecret: body.appSecret } : {}),
    domain: body.domain === 'lark' ? 'lark' as const : 'feishu' as const,
    enabled: body.enabled === true,
    allowAllUsers: body.allowAllUsers === true,
    allowedUserIds: stringArray(body.allowedUserIds),
    allowedConversationIds: stringArray(body.allowedConversationIds),
    groupMentionMode: body.groupMentionMode === 'bound' ? 'bound' as const : 'always' as const,
    privateConversationMode: body.privateConversationMode === 'topic' ? 'topic' as const : 'chat' as const,
  }
}

function getWorkspace(ctx: AppContext, id: string): WorkspaceRow {
  return workspaceRegistry(ctx).get(id)
}

function workspaceSetup(ctx: AppContext): WorkspaceSetupCoordinator {
  if (!ctx.workspaceSetup) {
    ctx.workspaceSetup = new WorkspaceSetupCoordinator((path, name) => workspaceRegistry(ctx).register(path, name))
  }
  return ctx.workspaceSetup
}

function skillInstalls(ctx: AppContext): SkillInstallCoordinator {
  if (!ctx.skillInstalls) ctx.skillInstalls = new SkillInstallCoordinator(ctx.db)
  return ctx.skillInstalls
}

function createDefaultRuntime(db?: WorkbenchDb) {
  const saved = db ? runtimeSettingsRow(db) : undefined
  const command = saved?.codex_command?.trim() || process.env.CODY_CODEX_COMMAND?.trim() || 'codex app-server --stdio'
  const model = process.env.CODY_CODEX_MODEL?.trim()
  return new CodyWorkCodexRuntime({ command, ...(model ? { model } : {}) })
}

async function awaitInitialization(path: string) {
  const result = await delegateWorkspaceInitialization(path)
  if (result.status === 'error') throw new Error(`Codex Workspace 初始化失败：${result.message}`)
  return result
}

function buildRoutes(ctx: AppContext) {
  const routes: { method: string; pattern: string; handler: Handler }[] = []
  const add = (method: string, pattern: string, handler: Handler) => routes.push({ method, pattern, handler })

  add('GET', '/api/health', () => ({ service: 'codywork', status: 'ok' }))

  add('GET', '/api/channels/feishu/accounts', () => channelService(ctx).listAccounts())

  add('POST', '/api/channels/feishu/accounts', async (c) => channelService(ctx).saveAccount(null, channelAccountInput(c.body)))

  add('PATCH', '/api/channels/feishu/accounts/:accountId', async (c) => channelService(ctx).saveAccount(requiredParam(c, 'accountId'), channelAccountInput(c.body)))

  add('DELETE', '/api/channels/feishu/accounts/:accountId', async (c) => {
    await channelService(ctx).deleteAccount(requiredParam(c, 'accountId'))
    return { deleted: true }
  })

  add('POST', '/api/channels/feishu/accounts/:accountId/reconnect', async (c) => {
    await channelService(ctx).reconnect(requiredParam(c, 'accountId'))
    return { reconnected: true }
  })

  add('GET', '/api/channels/feishu/accounts/:accountId/diagnostics', (c) => channelService(ctx).diagnostics(requiredParam(c, 'accountId')))

  add('GET', '/api/channels/feishu/accounts/:accountId/bindings', (c) => channelService(ctx).listBindings(requiredParam(c, 'accountId')))

  add('POST', '/api/channels/feishu/accounts/:accountId/outbox/:outboxId/retry', (c) => {
    channelService(ctx).retryOutbox(requiredParam(c, 'accountId'), requiredParam(c, 'outboxId'))
    return { retried: true }
  })

  add('GET', '/api/runtime/diagnostics', () => conversationService(ctx).diagnostics())

  // Observe the process already owned by the ConversationService. Creating a
  // throwaway App Server for a health click breaks single-owner semantics.
  add('POST', '/api/runtime/test', () => conversationService(ctx).getRuntime().getInfo())

  add('GET', '/api/settings/runtime', () => runtimeSettings(ctx.db))

  add('PATCH', '/api/settings/runtime', async (c) => {
    const patch = c.body as RuntimeSettingsPatch
    const updated = updateRuntimeSettings(ctx.db, patch)
    return { ...updated, restartRequired: true }
  })

  add('GET', '/api/workspaces', () => {
    return workspaceRegistry(ctx).list()
  })

  add('GET', '/api/filesystem/directories', (c) => listBrowsableDirectories(c.query.get('path') ?? undefined))

  add('POST', '/api/workspace-setup', (c) => {
    const source = normalizeSource(c.body)
    return workspaceSetup(ctx).start(source, typeof c.body.name === 'string' ? c.body.name : undefined)
  })

  add('GET', '/api/workspace-setup/:jobId', (c) => {
    return workspaceSetup(ctx).get(requiredParam(c, 'jobId'))
  })

  add('POST', '/api/workspaces', async (c) => {
    const source = normalizeSource(c.body)
    const prepared = prepareWorkspace(source)
    const initialization = prepared.action === 'initialize'
      ? await awaitInitialization(prepared.path)
      : { status: 'initialized' as const, message: 'Workspace 已存在，不需要初始化。' }
    if (prepared.action === 'initialize') {
      const check = inspectWorkspace(prepared.path).check
      if (check.status !== 'ready') {
        const missing = check.missing.length > 0 ? `缺少：${check.missing.join('、')}` : check.message
        throw new Error(`Codex 完成后 Workspace 复检未通过：${missing}`)
      }
    }
    const registered = workspaceRegistry(ctx).register(prepared.path, typeof c.body.name === 'string' && c.body.name.trim() ? c.body.name.trim() : prepared.name)
    return { workspace: registered.workspace, summary: inspectWorkspace(prepared.path), action: prepared.action, initialization, created: registered.created }
  })

  add('GET', '/api/workspaces/:id', (c) => {
    const row = workspaceRegistry(ctx).get(requiredParam(c, 'id'))
    return { workspace: workspaceRegistry(ctx).view(row), summary: inspectWorkspace(row.path) }
  })

  add('POST', '/api/workspaces/:id/open', (c) => {
    const workspace = workspaceRegistry(ctx).open(requiredParam(c, 'id'))
    return { workspace, summary: inspectWorkspace(workspace.path) }
  })

  add('GET', '/api/workspaces/:id/dashboard', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return dashboardCache(ctx).refreshIfStale(row)
  })

  add('GET', '/api/workspaces/:id/quick-actions', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return listQuickActions(ctx.db, workspace, await workspaceSkillCatalog(ctx, workspace))
  })

  add('POST', '/api/workspaces/:id/quick-actions', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return createQuickAction(ctx.db, workspace, await workspaceSkillCatalog(ctx, workspace), c.body as unknown as QuickActionInput)
  })

  add('PATCH', '/api/workspaces/:id/quick-actions/:actionId', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return updateQuickAction(ctx.db, workspace, await workspaceSkillCatalog(ctx, workspace), requiredParam(c, 'actionId'), c.body as unknown as QuickActionInput)
  })

  add('DELETE', '/api/workspaces/:id/quick-actions/:actionId', (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return deleteQuickAction(ctx.db, workspace, requiredParam(c, 'actionId'))
  })

  add('POST', '/api/workspaces/:id/dashboard/refresh', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return dashboardCache(ctx).refresh(row)
  })

  add('GET', '/api/workspaces/:id/knowledge', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return listKnowledgeDocuments(row)
  })

  add('GET', '/api/workspaces/:id/knowledge/:documentId', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return getKnowledgeDocument(row, requiredParam(c, 'documentId'))
  })

  add('GET', '/api/workspaces/:id/skills', async (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return workspaceSkillCatalog(ctx, row, c.query.get('force') === '1')
  })

  add('GET', '/api/workspaces/:id/skills/:skillId', async (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return getSkill(conversationService(ctx).getRuntime(), row, requiredParam(c, 'skillId'))
  })

  add('POST', '/api/workspaces/:id/skills', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    const source = typeof c.body.source === 'string' ? c.body.source.trim() : ''
    const job = skillInstalls(ctx).start(row, source)
    return { jobId: job.id, source: job.source }
  })

  add('GET', '/api/workspaces/:id/skills/install/:jobId', (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return skillInstalls(ctx).get(workspace.id, requiredParam(c, 'jobId'))
  })

  add('GET', '/api/workspaces/:id/repositories', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return listCachedRepositories(ctx.db, row).map(repository => ({
      id: repository.id,
      name: repository.name,
      path: repository.baseline_path,
      originUrl: repository.origin_url,
      defaultRef: repository.default_ref,
      syncStatus: repository.sync_status,
      dirty: Boolean(repository.dirty),
    }))
  })

  add('POST', '/api/workspaces/:id/repositories', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    const repository = addRepository(ctx.db, row, normalizeRepositoryInput(c.body))
    void dashboardCache(ctx).refresh(row)
    return { id: repository.id, name: repository.name, path: repository.baseline_path, originUrl: repository.origin_url, defaultRef: repository.default_ref, syncStatus: repository.sync_status, dirty: Boolean(repository.dirty) }
  })

  add('POST', '/api/workspaces/:id/repositories/:repositoryId/sync', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    const result = syncRepositoryBaseline(ctx.db, row, requiredParam(c, 'repositoryId'))
    void dashboardCache(ctx).refresh(row)
    return {
      repositoryId: result.repository.id,
      ref: result.ref,
      state: result.state,
      message: result.message,
      localHead: result.localHead,
      remoteHead: result.remoteHead,
      commitsBehind: result.commitsBehind,
      commitsAhead: result.commitsAhead,
      repository: {
        id: result.repository.id,
        name: result.repository.name,
        path: result.repository.baseline_path,
        originUrl: result.repository.origin_url,
        defaultRef: result.repository.default_ref,
        syncStatus: result.repository.sync_status,
        dirty: Boolean(result.repository.dirty),
      },
    }
  })

  add('POST', '/api/workspaces/:id/repositories/:repositoryId/clear-baseline', (c) => {
    if (c.body?.confirm !== true) throw new Error('清理基线变更需要明确确认')
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    const result = clearRepositoryBaselineChanges(ctx.db, row, requiredParam(c, 'repositoryId'))
    void dashboardCache(ctx).refresh(row)
    return {
      repositoryId: result.repository.id,
      state: result.state,
      message: result.message,
      discardedTrackedChanges: result.discardedTrackedChanges,
      discardedUntrackedFiles: result.discardedUntrackedFiles,
      repository: {
        id: result.repository.id,
        name: result.repository.name,
        path: result.repository.baseline_path,
        originUrl: result.repository.origin_url,
        defaultRef: result.repository.default_ref,
        syncStatus: result.repository.sync_status,
        dirty: Boolean(result.repository.dirty),
      },
    }
  })

  add('GET', '/api/workspaces/:id/demands', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return listDemands(ctx.db, row)
  })

  add('POST', '/api/workspaces/:id/worktrees/import', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    const result = importExistingWorktrees(ctx.db, row)
    void dashboardCache(ctx).refresh(row)
    return result
  })

  add('POST', '/api/workspaces/:id/demands', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    const body = c.body
    const name = typeof body.name === 'string' ? body.name : ''
    const branchName = typeof body.branchName === 'string' ? body.branchName : undefined
    const repositoryIds = Array.isArray(body.repositoryIds) ? body.repositoryIds.filter((value): value is string => typeof value === 'string') : []
    const result = createDemand(ctx.db, row, { name, ...(branchName === undefined ? {} : { branchName }), repositoryIds })
    void dashboardCache(ctx).refresh(row)
    return result
  })

  add('GET', '/api/workspaces/:id/demands/:demandId', (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    return getDemand(ctx.db, row, requiredParam(c, 'demandId'))
  })

  add('POST', '/api/workspaces/:id/demands/:demandId/repositories', async (c) => {
    const row = getWorkspace(ctx, requiredParam(c, 'id'))
    const demandId = requiredParam(c, 'demandId')
    const repositoryId = typeof c.body.repositoryId === 'string' ? c.body.repositoryId : ''
    if (!repositoryId) throw new Error('Repo 参数缺失')
    const result = addRepositoryToDemand(ctx.db, row, demandId, repositoryId)
    await conversationService(ctx).refreshDemandContexts(row.id, demandId)
    void dashboardCache(ctx).refresh(row)
    return result
  })

  add('GET', '/api/workspaces/:id/demands/:demandId/conversations', (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return conversationService(ctx).list(workspace.id, requiredParam(c, 'demandId'))
  })

  add('GET', '/api/workspaces/:id/demands/:demandId/available-threads', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return conversationService(ctx).listAvailableNativeThreads(workspace.id, requiredParam(c, 'demandId'))
  })

  add('GET', '/api/workspaces/:id/demands/:demandId/composer-options', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return conversationService(ctx).composerOptions(workspace.id, requiredParam(c, 'demandId'))
  })

  add('POST', '/api/workspaces/:id/demands/:demandId/conversations', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    const title = typeof c.body.title === 'string' ? c.body.title : undefined
    return conversationService(ctx).create(workspace.id, requiredParam(c, 'demandId'), title)
  })

  add('POST', '/api/workspaces/:id/demands/:demandId/conversations/bind', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    const nativeId = typeof c.body.nativeId === 'string' ? c.body.nativeId : ''
    const title = typeof c.body.title === 'string' ? c.body.title : undefined
    return conversationService(ctx).bind(workspace.id, requiredParam(c, 'demandId'), { nativeId, title })
  })

  add('GET', '/api/workspaces/:id/conversations/:conversationId', (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return conversationService(ctx).get(workspace.id, requiredParam(c, 'conversationId'))
  })

  add('GET', '/api/workspaces/:id/conversations/:conversationId/history', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return conversationService(ctx).history(workspace.id, requiredParam(c, 'conversationId'))
  })

  add('POST', '/api/workspaces/:id/conversations/:conversationId/images', (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    const conversationId = requiredParam(c, 'conversationId')
    conversationService(ctx).get(workspace.id, conversationId)
    const name = typeof c.body.name === 'string' ? c.body.name : ''
    const dataUrl = typeof c.body.dataUrl === 'string' ? c.body.dataUrl : ''
    return imageUploads(ctx).upload(workspace.id, conversationId, { name, dataUrl })
  })

  add('GET', '/api/workspaces/:id/conversations/:conversationId/images/:imageId', (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    const conversationId = requiredParam(c, 'conversationId')
    conversationService(ctx).get(workspace.id, conversationId)
    const image = imageUploads(ctx).read(workspace.id, conversationId, requiredParam(c, 'imageId'))
    c.res.writeHead(200, {
      'Content-Type': image.mimeType,
      'Content-Length': image.bytes.length,
      'Content-Disposition': `inline; filename="${encodeURIComponent(image.name)}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(c.req),
    })
    c.res.end(image.bytes)
  })

  add('POST', '/api/workspaces/:id/conversations/:conversationId/messages', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    const content = typeof c.body.content === 'string' ? c.body.content : ''
    const mode = c.body.mode === 'steer' ? 'steer' : 'queue'
    const reasoningEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    const collaborationMode: 'default' | 'plan' = c.body.collaborationMode === 'plan' ? 'plan' : 'default'
    const settings = {
      ...(typeof c.body.model === 'string' && c.body.model.trim() ? { model: c.body.model.trim().slice(0, 160) } : {}),
      ...(typeof c.body.reasoningEffort === 'string' && reasoningEfforts.has(c.body.reasoningEffort) ? { reasoningEffort: c.body.reasoningEffort as 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' } : {}),
      collaborationMode,
      ...(Array.isArray(c.body.skills) ? { skills: c.body.skills.filter((item: unknown) => typeof item === 'string').slice(0, 20) as string[] } : {}),
    }
    const clientCommandId = typeof c.body.clientCommandId === 'string' ? c.body.clientCommandId : undefined
    const conversationId = requiredParam(c, 'conversationId')
    const imageIds = Array.isArray(c.body.images)
      ? c.body.images.filter((item: unknown) => typeof item === 'string').slice(0, 8) as string[]
      : []
    const localImages = imageUploads(ctx).resolveForTurn(workspace.id, conversationId, imageIds)
    return conversationService(ctx).send(workspace.id, conversationId, content, mode, settings, clientCommandId, localImages)
  })

  add('POST', '/api/workspaces/:id/conversations/:conversationId/interrupt', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return conversationService(ctx).interrupt(workspace.id, requiredParam(c, 'conversationId'))
  })

  add('POST', '/api/workspaces/:id/conversations/:conversationId/permission', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    const mode = c.body.mode
    if (mode !== 'read-only' && mode !== 'workspace-write' && mode !== 'yolo') throw new Error('权限模式不合法')
    return conversationService(ctx).setPermission(workspace.id, requiredParam(c, 'conversationId'), mode)
  })

  add('PATCH', '/api/workspaces/:id/conversations/:conversationId', (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return conversationService(ctx).rename(workspace.id, requiredParam(c, 'conversationId'), typeof c.body.title === 'string' ? c.body.title : '')
  })

  add('DELETE', '/api/workspaces/:id/conversations/:conversationId', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    return await conversationService(ctx).remove(workspace.id, requiredParam(c, 'conversationId'))
  })

  add('POST', '/api/workspaces/:id/conversations/:conversationId/approvals/:approvalId', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    const outcome = c.body.outcome === 'rejected' ? 'rejected' : 'allowed-once'
    await conversationService(ctx).approve(workspace.id, requiredParam(c, 'conversationId'), requiredParam(c, 'approvalId'), outcome)
    return { resolved: true }
  })

  add('POST', '/api/workspaces/:id/conversations/:conversationId/questions/:requestId', async (c) => {
    const workspace = getWorkspace(ctx, requiredParam(c, 'id'))
    await conversationService(ctx).answer(workspace.id, requiredParam(c, 'conversationId'), requiredParam(c, 'requestId'), c.body.answer)
    return { resolved: true }
  })

  add('DELETE', '/api/workspaces/:id', (c) => {
    const id = c.params.id
    if (!id) throw new Error('Workspace id 缺失')
    workspaceRegistry(ctx).remove(id)
    return { deleted: true }
  })

  return routes
}

function match(pattern: string, pathname: string): Record<string, string> | null {
  const expected = pattern.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  if (expected.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index] ?? ''
    const right = actual[index] ?? ''
    if (left.startsWith(':')) params[left.slice(1)] = decodeURIComponent(right)
    else if (left !== right) return null
  }
  return params
}

export interface ServerOptions {
  host: string
  port: number
  staticRoot?: string
  /** When configured, all browser-facing traffic requires a password session. */
  password?: string
}

export function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/gu, '')
  return normalized === 'localhost' || normalized === '::1'
    || (isIP(normalized) === 4 && normalized.split('.')[0] === '127')
}

function requestIsSecure(req: IncomingMessage): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim().toLowerCase()
  return forwardedProto === 'https' || Boolean((req.socket as IncomingMessage['socket'] & { encrypted?: boolean }).encrypted)
}

export type StartedWorkbenchServer = Server & {
  /** Closes browser projections with an intentional service-restart signal
   * before the HTTP listener goes away. */
  closeRealtime(code?: number, reason?: string): void
}

export function startServer(ctx: AppContext, options: ServerOptions): StartedWorkbenchServer {
  const password = options.password?.trim() || null
  if (!password && !isLoopbackBindHost(options.host)) {
    throw new Error('CODYWORK_PASSWORD is required when CodyWork listens on a non-loopback host')
  }
  const routes = buildRoutes(ctx)
  const serveStaticAsset = options.staticRoot ? createStaticAssetHandler(options.staticRoot) : null
  const sessions = password ? new AuthSessions(ctx.db, password) : null
  const authenticated = (req: IncomingMessage): boolean => {
    if (!password) return true
    const token = requestCookies(req)[AUTH_COOKIE]
    return Boolean(token && sessions?.isAuthenticated(token))
  }
  const rejectUnauthenticated = (req: IncomingMessage, res: ServerResponse, pathname: string): void => {
    if (pathname.startsWith('/api/')) json(req, res, 401, { ok: false, error: 'authentication required' })
    else {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' })
      res.end(loginPage())
    }
  }
  const clientsByConversationId = new Map<string, Set<WebSocket>>()
  const closeConversationClients = (conversationId: string, code: number, reason: string): void => {
    const clients = clientsByConversationId.get(conversationId)
    if (!clients) return
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close(code, reason)
    }
    clientsByConversationId.delete(conversationId)
  }
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    if (typeof origin === 'string' && !isAllowedOrigin(origin, req.headers.host)) return json(req, res, 403, { ok: false, error: 'origin not allowed' })
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', ...corsHeaders(req) })
      return res.end()
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (password && req.method === 'GET' && url.pathname === '/auth/login') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' })
      return res.end(loginPage())
    }
    if (password && req.method === 'POST' && url.pathname === '/api/auth/login') {
      const submitted = await parseLoginPassword(req).catch(() => '')
      if (!passwordsMatch(submitted, password)) {
        if (String(req.headers.accept ?? '').includes('application/json')) return json(req, res, 401, { ok: false, error: 'invalid password' })
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' })
        return res.end(loginPage('invalid'))
      }
      const token = randomBytes(32).toString('base64url')
      sessions?.create(token, Date.now() + SESSION_TTL_MS)
      const secure = requestIsSecure(req) ? '; Secure' : ''
      res.writeHead(303, { Location: '/', 'Set-Cookie': `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`, 'Cache-Control': 'no-store, max-age=0' })
      return res.end()
    }
    // The process supervisor checks this endpoint through loopback only. The
    // externally exposed service never reveals an unauthenticated API.
    if (password && !(url.pathname === '/api/health' && isLoopbackRequest(req)) && !authenticated(req)) {
      return rejectUnauthenticated(req, res, url.pathname)
    }
    const route = routes.find(item => item.method === req.method && match(item.pattern, url.pathname) !== null)
    if (!route) {
      if (!url.pathname.startsWith('/api/') && serveStaticAsset && await serveStaticAsset(req, res, url.pathname)) return
      return json(req, res, 404, { ok: false, error: `not found: ${req.method} ${url.pathname}` })
    }
    let body: Record<string, unknown>
    try {
      const isImageUpload = route.pattern === '/api/workspaces/:id/conversations/:conversationId/images' && req.method === 'POST'
      body = await readBody(req, isImageUpload ? 29 * 1024 * 1024 : 1 * 1024 * 1024)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return json(req, res, message === '请求内容过大' ? 413 : 400, { ok: false, error: message })
    }
    const c: Ctx = { req, res, params: match(route.pattern, url.pathname) ?? {}, body, query: url.searchParams }
    try {
      const result = await route.handler(c)
      if (route.pattern === '/api/workspaces/:id/conversations/:conversationId' && req.method === 'DELETE') {
        closeConversationClients(c.params.conversationId ?? '', 4404, 'conversation deleted')
      }
      if (!res.writableEnded) json(req, res, 200, { ok: true, data: result })
    } catch (error) {
      if (!res.headersSent) json(req, res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
  const websocket = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin
    if (typeof origin === 'string' && !isAllowedOrigin(origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (!authenticated(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)\/events$/)
    if (!parts) { socket.destroy(); return }
    const workspaceId = decodeURIComponent(parts[1] ?? '')
    const conversationId = decodeURIComponent(parts[2] ?? '')
    try { conversationService(ctx).get(workspaceId, conversationId) } catch {
      websocket.handleUpgrade(req, socket, head, client => client.close(4404, 'conversation not found'))
      return
    }
    websocket.handleUpgrade(req, socket, head, client => websocket.emit('connection', client, req, workspaceId, conversationId))
  })
  websocket.on('connection', (client: WebSocket, _req: IncomingMessage, workspaceId: string, conversationId: string) => {
    const service = conversationService(ctx)
    const conversationClients = clientsByConversationId.get(conversationId) ?? new Set<WebSocket>()
    conversationClients.add(client)
    clientsByConversationId.set(conversationId, conversationClients)
    // Each tab is an independent projection client. A slow/background tab is
    // disconnected on its own instead of retaining an unbounded copy of every
    // Codex delta and destabilizing the shared Runtime owner.
    const unsubscribe = service.subscribe(conversationId, (event) => {
      sendConversationSocket(client, { type: 'event', event })
    })
    const heartbeat = setInterval(() => {
      sendConversationSocket(client, { type: 'heartbeat', atIso: new Date().toISOString() })
    }, 15_000)
    heartbeat.unref?.()
    client.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw)) as { type?: string; approvalId?: string; outcome?: 'allowed-once' | 'rejected'; requestId?: string; answer?: unknown }
        if (message.type === 'approval' && message.approvalId) {
          void service.approve(workspaceId, conversationId, message.approvalId, message.outcome === 'rejected' ? 'rejected' : 'allowed-once')
            .catch(error => sendConversationSocket(client, { type: 'error', requestType: 'approval', requestId: message.approvalId, error: error instanceof Error ? error.message : String(error) }))
        }
        if (message.type === 'question' && message.requestId) {
          void service.answer(workspaceId, conversationId, message.requestId, message.answer)
            .catch(error => sendConversationSocket(client, { type: 'error', requestType: 'question', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }))
        }
        if (message.type === 'ping') sendConversationSocket(client, { type: 'pong' })
      } catch { sendConversationSocket(client, { type: 'error', error: 'invalid websocket message' }) }
    })
    client.on('error', () => undefined)
    client.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      conversationClients.delete(client)
      if (conversationClients.size === 0) clientsByConversationId.delete(conversationId)
    })
  })
  server.listen(options.port, options.host, () => console.log(`[codywork] server listening on http://${options.host}:${options.port}`))
  const started = server as StartedWorkbenchServer
  started.closeRealtime = (code = 1012, reason = 'service restart') => {
    for (const conversationId of [...clientsByConversationId.keys()]) closeConversationClients(conversationId, code, reason)
  }
  return started
}
