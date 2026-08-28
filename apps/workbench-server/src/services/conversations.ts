import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { WorkbenchDb, ConversationPermissionMode, ConversationRow, WorkspaceRow, nowIso, makeId } from '../db/index.js'
import { getDemand } from './demands.js'
import { resolveEffectivePolicy, resolveInstructionBundle } from '../runtime/policy.js'
import type {
  ConversationHandle,
  ConversationRuntimeAdapter,
  NativeThreadSummary,
  RuntimeContext,
  RuntimeEvent,
  RuntimeComposerOptions,
} from '../runtime/protocol.js'

export interface ConversationView {
  id: string
  demandId: string
  provider: string
  nativeId: string
  title: string
  status: ConversationRow['status']
  permissionMode: ConversationPermissionMode
  goal: unknown
  plan: unknown
  policyHash: string
  instructionHash: string
  createdAt: string
  updatedAt: string
}

export interface ConversationEvent extends RuntimeEvent {
  id: string
  type: RuntimeEvent['type']
  conversationId: string
  turnId?: string
  itemId?: string
  provider: string
}

export interface AvailableNativeThread extends NativeThreadSummary {
  bound: boolean
}

type Listener = (event: ConversationEvent) => void

type DemandContext = {
  id: string
  name: string
  branchName: string
  worktreeKey: string
  status: 'in_progress' | 'completed' | 'blocked'
  createdAt: string
  updatedAt: string
  workspaceId: string
  repositories: { id: string; name: string; worktreePath: string }[]
}

function parseJson(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) as unknown } catch { return null }
}

/**
 * A shared App Server process can exit independently of CodyWork's durable
 * conversation metadata. This error is raised before `turn/start` is sent, so
 * re-attaching the native Thread and retrying the same request is safe.
 */
function isMissingRuntimeAttachment(error: Error): boolean {
  return error.message.includes('Codex conversation runtime is not available')
}

function toView(row: ConversationRow): ConversationView {
  return {
    id: row.id,
    demandId: row.demand_id,
    provider: row.provider,
    nativeId: row.native_id,
    title: row.title,
    status: row.status,
    permissionMode: row.permission_mode,
    goal: parseJson(row.goal_json),
    plan: parseJson(row.plan_json),
    policyHash: row.policy_hash,
    instructionHash: row.instruction_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function permissionPolicy(context: RuntimeContext, mode: ConversationPermissionMode): RuntimeContext {
  const writable = mode === 'read-only' ? [] : context.effectivePolicy.writableRoots
  return {
    ...context,
    effectivePolicy: resolveEffectivePolicy({
      workspacePath: context.workspacePath,
      readableRoots: context.effectivePolicy.readableRoots,
      writableRoots: writable,
      deniedRoots: context.effectivePolicy.deniedRoots,
      shell: context.effectivePolicy.shell,
      approval: mode === 'yolo' ? 'none' : 'workbench',
    }),
  }
}

/** Provides durable CodyWork conversation metadata and a reconnectable event stream. */
export class ConversationService {
  private readonly handles = new Map<string, ConversationHandle>()
  private readonly contexts = new Map<string, RuntimeContext>()
  private readonly listeners = new Map<string, Set<Listener>>()
  /** Serializes ordinary queue sends per conversation; steering stays attached to the active turn. */
  private readonly turnChains = new Map<string, Promise<void>>()
  /** App Server failure notifications, held until the enclosing send settles. */
  private readonly runtimeFailureMessages = new Map<string, string>()

  private runtime: ConversationRuntimeAdapter

  constructor(private readonly db: WorkbenchDb, runtime: ConversationRuntimeAdapter, private readonly onTurnFinished?: (workspaceId: string) => void) { this.runtime = runtime }

  getRuntime(): ConversationRuntimeAdapter { return this.runtime }

  async replaceRuntime(runtime: ConversationRuntimeAdapter): Promise<void> {
    await this.runtime.close()
    this.runtime = runtime
    this.handles.clear(); this.contexts.clear()
    this.db.db.prepare("UPDATE conversations SET status = 'disconnected', updated_at = ? WHERE status IN ('running', 'awaiting_approval')").run(nowIso())
  }

  async manifest() { return this.runtime.getManifest() }

  list(workspaceId: string, demandId: string): ConversationView[] {
    const rows = this.db.db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND demand_id = ? ORDER BY updated_at DESC, created_at DESC').all(workspaceId, demandId) as unknown as ConversationRow[]
    return rows.map(toView)
  }

  /** Returns recent provider threads that may be resumed under this Demand's policy. */
  async listAvailableNativeThreads(workspaceId: string, demandId: string): Promise<AvailableNativeThread[]> {
    const demand = this.requireDemand(workspaceId, demandId)
    const manifest = await this.runtime.getManifest()
    if (!manifest.resume || !this.runtime.listNativeThreads) throw new Error('当前 Runtime 不支持列出可恢复 Thread')
    const threads = await this.runtime.listNativeThreads({ context: this.contextFor(demand, 'workspace-write') })
    const boundRows = this.db.db.prepare('SELECT native_id FROM conversations WHERE provider = ?').all(this.runtime.provider) as Array<{ native_id: string }>
    const bound = new Set(boundRows.map(row => row.native_id))
    return threads.map(thread => ({ ...thread, bound: bound.has(thread.nativeId) }))
  }

  get(workspaceId: string, conversationId: string): ConversationView {
    const row = this.db.db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND id = ?').get(workspaceId, conversationId) as ConversationRow | undefined
    if (!row) throw new Error('会话不存在')
    return toView(row)
  }

  async history(workspaceId: string, conversationId: string): Promise<ConversationEvent[]> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    if (!this.runtime.readConversation) throw new Error('当前 Runtime 不支持读取原生 Thread 历史')
    try {
      const events = await this.runtime.readConversation({ conversation: this.handleFor(row), context: this.contexts.get(conversationId)! })
      // Native Codex Thread history remains authoritative. Retain only the
      // current bounded failure diagnostic, so refresh does not make a visible
      // Runtime error turn back into an unexplained failed status.
      if (row.status === 'failed' && !events.some(event => event.type === 'turn.failed')) {
        const failure = this.db.db.prepare("SELECT id, data_json, created_at FROM conversation_audits WHERE conversation_id = ? AND action = 'turn.failed' ORDER BY id DESC LIMIT 1").get(conversationId) as { id: number; data_json: string; created_at: string } | undefined
        const data = failure ? parseJson(failure.data_json) : null
        const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
        events.push({
          id: `audit:turn.failed:${String(failure?.id ?? row.updated_at)}`,
          type: 'turn.failed',
          threadId: row.native_id,
          conversationId,
          ...(typeof record.turnId === 'string' ? { turnId: record.turnId } : {}),
          provider: row.provider,
          timestamp: failure?.created_at ?? row.updated_at,
          atIso: failure?.created_at ?? row.updated_at,
          data: { error: typeof record.error === 'string' ? record.error : 'Codex 未能完成本次回复。' },
        })
      }
      return events
    } catch (error) {
      // App Server cannot read a just-started native thread until its first user
      // turn materializes. Treat only an untouched local conversation as empty.
      if (row.status === 'idle' && !row.goal_json && !row.plan_json) return []
      throw error
    }
  }

  subscribe(conversationId: string, listener: Listener): () => void {
    const set = this.listeners.get(conversationId) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(conversationId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(conversationId)
    }
  }

  async create(workspaceId: string, demandId: string, title?: string): Promise<ConversationView> {
    const demand = this.requireDemand(workspaceId, demandId)
    const context = this.contextFor(demand, 'workspace-write')
    const id = makeId('conversation')
    const handle = await this.runtime.createConversation({ conversationId: id, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      demand_id: demand.id,
      workspace_id: workspaceId,
      provider: handle.provider,
      native_id: handle.nativeId,
      title: title?.trim() || '新会话',
      status: 'idle',
      permission_mode: 'workspace-write',
      goal_json: null,
      plan_json: null,
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.db.db.prepare('INSERT INTO conversations (id, demand_id, workspace_id, provider, native_id, title, status, permission_mode, goal_json, plan_json, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        row.id, row.demand_id, row.workspace_id, row.provider, row.native_id,
        row.title, row.status, row.permission_mode, row.goal_json, row.plan_json,
        row.policy_hash, row.instruction_hash, row.created_at,
        row.updated_at,
      )
    this.handles.set(id, handle)
    this.contexts.set(id, context)
    return this.get(workspaceId, id)
  }

  /** Binds a provider-native thread to this Demand without weakening its Worktree policy. */
  async bind(workspaceId: string, demandId: string, input: { nativeId: string; title?: string }): Promise<ConversationView> {
    const nativeId = input.nativeId.trim()
    if (!nativeId) throw new Error('请输入 Thread 或 Session ID')
    if (nativeId.length > 240) throw new Error('Thread 或 Session ID 过长')
    const demand = this.requireDemand(workspaceId, demandId)
    const manifest = await this.runtime.getManifest()
    if (!manifest.resume || !this.runtime.resumeConversation) throw new Error('当前 Runtime 不支持恢复已有 Thread')
    const existing = this.db.db.prepare('SELECT * FROM conversations WHERE provider = ? AND native_id = ?').get(this.runtime.provider, nativeId) as ConversationRow | undefined
    if (existing) {
      if (existing.workspace_id === workspaceId && existing.demand_id === demandId) throw new Error('这个 Thread 已绑定到当前 Demand')
      throw new Error('这个 Thread 已绑定到另一个 Demand，不能跨 Worktree 复用')
    }
    const context = this.contextFor(demand, 'workspace-write')
    const id = makeId('conversation')
    const handle = await this.runtime.resumeConversation({ conversationId: id, nativeId, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      demand_id: demand.id,
      workspace_id: workspaceId,
      provider: handle.provider,
      native_id: nativeId,
      title: input.title?.trim() || `已绑定 Thread ${nativeId.slice(0, 8)}`,
      status: 'idle',
      permission_mode: 'workspace-write',
      goal_json: null,
      plan_json: null,
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.db.db.prepare('INSERT INTO conversations (id, demand_id, workspace_id, provider, native_id, title, status, permission_mode, goal_json, plan_json, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.demand_id, row.workspace_id, row.provider, row.native_id, row.title, row.status, row.permission_mode, row.goal_json, row.plan_json, row.policy_hash, row.instruction_hash, row.created_at, row.updated_at)
    this.handles.set(id, handle)
    this.contexts.set(id, context)
    this.audit(id, 'conversation.bound', { nativeId, demandId: demand.id, policyHash: context.effectivePolicy.hash })
    return this.get(workspaceId, id)
  }

  async composerOptions(workspaceId: string, demandId: string): Promise<RuntimeComposerOptions> {
    const demand = this.requireDemand(workspaceId, demandId)
    if (!this.runtime.getComposerOptions) return { models: [], collaborationModes: [] }
    return this.runtime.getComposerOptions(this.contextFor(demand, 'workspace-write'))
  }

  async send(workspaceId: string, conversationId: string, prompt: string, mode: 'queue' | 'steer' = 'queue', settings?: { model?: string; reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; skills?: string[] }): Promise<{ accepted: true; turnId: string }> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const text = prompt.trim()
    if (!text) throw new Error('消息不能为空')
    const turnId = `turn-${randomUUID()}`
    const requestedSkills = (settings?.skills ?? []).filter(skill => typeof skill === 'string' && skill.trim()).map(skill => skill.trim()).slice(0, 20)
    const promptWithSkills = requestedSkills.length ? `Use these explicitly selected Workspace Skills when relevant: ${requestedSkills.map(skill => `$${skill}`).join(', ')}.\n\n${text}` : text
    if (text === '/plan' || text === '/plan on' || text === '/plan off' || text === '/plan approve' || text === '/plan reject') {
      await this.runtime.sendCommand?.({ conversation: this.handleFor(row), prompt: text, mode })
      const current = parseJson(row.plan_json) as { active?: boolean } | null
      const active = text === '/plan off' || text === '/plan reject' ? false : text === '/plan approve' ? Boolean(current?.active) : text === '/plan on' || text === '/plan' ? !current?.active : false
      const status = text === '/plan approve' ? 'approved' : text === '/plan reject' ? 'rejected' : active ? 'planning' : 'inactive'
      const plan = { active, status, updatedAt: nowIso() }
      this.db.db.prepare('UPDATE conversations SET plan_json = ?, status = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(plan), 'idle', nowIso(), conversationId)
      return { accepted: true, turnId }
    }
    if (text.startsWith('/goal')) {
      await this.runtime.sendCommand?.({ conversation: this.handleFor(row), prompt: text, mode })
      const objective = text.replace(/^\/goal\s*/, '').trim()
      const current = parseJson(row.goal_json) as { objective?: string } | null
      const commandStatus = objective === 'pause' || objective === '暂停' ? 'paused' : objective === 'resume' || objective === '恢复' ? 'active' : objective === 'complete' || objective === '完成' ? 'completed' : objective === 'clear' || objective === '清除' ? 'cleared' : null
      const goal = commandStatus === 'cleared' ? null : commandStatus ? { objective: current?.objective ?? '', status: commandStatus, updatedAt: nowIso() } : objective ? { objective, status: 'active', updatedAt: nowIso() } : null
      this.db.db.prepare('UPDATE conversations SET goal_json = ?, status = ?, updated_at = ? WHERE id = ?').run(goal ? JSON.stringify(goal) : null, 'idle', nowIso(), conversationId)
      return { accepted: true, turnId }
    }
    this.db.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run('running', nowIso(), conversationId)
    const run = () => this.runTurn(row, promptWithSkills, turnId, settings)
    const previous = this.turnChains.get(conversationId) ?? Promise.resolve()
    const scheduled = mode === 'queue' ? previous.catch(() => undefined).then(run) : run()
    this.turnChains.set(conversationId, scheduled)
    void scheduled.finally(() => {
      if (this.turnChains.get(conversationId) === scheduled) this.turnChains.delete(conversationId)
    })
    return { accepted: true, turnId }
  }

  async setPermission(workspaceId: string, conversationId: string, mode: ConversationPermissionMode): Promise<ConversationView> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const context = this.contexts.get(conversationId)
    if (context) {
      const next = permissionPolicy(context, mode)
      this.contexts.set(conversationId, next)
      await this.runtime.setPermission?.(this.handleFor(row), mode)
    }
    this.db.db.prepare('UPDATE conversations SET permission_mode = ?, updated_at = ? WHERE id = ?').run(mode, nowIso(), conversationId)
    this.audit(conversationId, 'permission.changed', { mode })
    return this.get(workspaceId, conversationId)
  }

  async interrupt(workspaceId: string, conversationId: string): Promise<{ supported: boolean }> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const result = await this.runtime.interrupt(this.handleFor(row))
    this.audit(conversationId, 'turn.interrupt', result)
    if (result.supported) this.db.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run('idle', nowIso(), conversationId)
    return result
  }

  async approve(workspaceId: string, conversationId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    await this.runtime.respondApproval?.(this.handleFor(row), approvalId, outcome)
    this.audit(conversationId, 'approval.resolved', { approvalId, outcome })
  }

  async answer(workspaceId: string, conversationId: string, requestId: string, answer: unknown): Promise<void> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    await this.runtime.respondQuestion?.(this.handleFor(row), requestId, answer)
    this.audit(conversationId, 'question.resolved', { requestId, answer })
  }

  rename(workspaceId: string, conversationId: string, title: string): ConversationView {
    this.requireConversation(workspaceId, conversationId)
    const value = title.trim()
    if (!value) throw new Error('会话标题不能为空')
    this.db.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(value, nowIso(), conversationId)
    this.audit(conversationId, 'conversation.renamed', { title: value })
    return this.get(workspaceId, conversationId)
  }

  /** Removes CodyWork's local record only. The provider-native Thread is intentionally retained. */
  remove(workspaceId: string, conversationId: string): { deleted: true } {
    const row = this.requireConversation(workspaceId, conversationId)
    if (row.status === 'running' || row.status === 'awaiting_approval' || this.turnChains.has(conversationId)) {
      throw new Error('会话正在执行或等待确认，请先停止后再删除')
    }
    const count = this.db.db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE workspace_id = ? AND demand_id = ?').get(workspaceId, row.demand_id) as { count: number }
    if (count.count <= 1) throw new Error('每个 Demand 至少保留一个会话')

    // Local audit records are deleted through their foreign-key cascade; native Thread is retained.
    this.db.db.prepare('DELETE FROM conversations WHERE id = ? AND workspace_id = ?').run(conversationId, workspaceId)
    this.handles.delete(conversationId)
    this.contexts.delete(conversationId)
    this.listeners.delete(conversationId)
    return { deleted: true }
  }

  private async runTurn(row: ConversationRow, prompt: string, turnId: string, settings?: { model?: string; reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }): Promise<void> {
    const mode = row.permission_mode
    try {
      await this.sendRuntimeTurn(row, prompt, settings)
      const current = this.db.db.prepare('SELECT status FROM conversations WHERE id = ?').get(row.id) as { status?: string } | undefined
      if (current?.status !== 'idle') this.db.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run('completed', nowIso(), row.id)
    } catch (error) {
      this.fail(row.id, row.provider, turnId, error instanceof Error ? error : new Error(String(error)))
    }
    this.onTurnFinished?.(row.workspace_id)
    void mode
  }

  private async sendRuntimeTurn(row: ConversationRow, prompt: string, settings?: { model?: string; reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }): Promise<void> {
    const send = async (): Promise<void> => {
      await this.runtime.sendTurn({
        conversation: this.handleFor(row),
        prompt,
        ...(settings ? { settings } : {}),
        onEvent: event => this.appendRuntimeEvent(event),
      })
    }
    try {
      await send()
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (!isMissingRuntimeAttachment(error)) throw error

      // The App Server owns transient thread attachments. Drop only CodyWork's
      // stale in-memory references, resume the provider-native Thread under the
      // existing Demand policy, then retry the request once. Do not retry any
      // other failure: a remote turn may already have started in that case.
      this.handles.delete(row.id)
      this.contexts.delete(row.id)
      await this.ensureHandle(row)
      this.audit(row.id, 'runtime.resumed', { reason: 'runtime attachment was unavailable' })
      await send()
    }
  }

  private appendRuntimeEvent(event: RuntimeEvent): void {
    const data = event.data
    this.publish({ ...event, data })
    if (event.type === 'approval.requested') this.db.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run('awaiting_approval', nowIso(), event.conversationId)
    if (event.type === 'turn.failed') {
      this.runtimeFailureMessages.set(event.conversationId, String(event.data.error ?? 'Codex 未能完成本次回复。'))
      this.db.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run('failed', nowIso(), event.conversationId)
    }
  }

  private fail(conversationId: string, provider: string, turnId: string, error: Error): void {
    const message = error.message.slice(0, 1_000)
    const alreadyPublished = this.runtimeFailureMessages.get(conversationId) === message
    this.runtimeFailureMessages.delete(conversationId)
    this.db.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run('failed', nowIso(), conversationId)
    // This is a bounded diagnostic audit, not a mirrored event history. Native
    // Codex Thread history remains the only durable message timeline.
    this.audit(conversationId, 'turn.failed', { turnId, error: message })
    console.warn('[CodyWork] Codex turn failed', { conversationId, turnId, error: message })
    if (!alreadyPublished) {
      const row = this.db.db.prepare('SELECT native_id FROM conversations WHERE id = ?').get(conversationId) as { native_id?: string } | undefined
      const timestamp = nowIso()
      this.publish({ id: `live:${randomUUID()}`, conversationId, type: 'turn.failed', threadId: row?.native_id ?? '', provider, turnId, timestamp, atIso: timestamp, data: { error: message } })
    }
  }

  private publish(event: ConversationEvent): void {
    for (const listener of this.listeners.get(event.conversationId) ?? []) listener(event)
  }

  private audit(conversationId: string, action: string, data: unknown): void {
    this.db.db.prepare('INSERT INTO conversation_audits (conversation_id, action, data_json, created_at) VALUES (?, ?, ?, ?)').run(conversationId, action, JSON.stringify(data), nowIso())
  }

  private contextFor(demand: DemandContext, mode: ConversationPermissionMode): RuntimeContext {
    const workspacePath = this.workspacePath(demand.workspaceId)
    const repositories = demand.repositories.map(repository => repository.worktreePath)
    const demandPath = resolve(workspacePath, 'worktrees', demand.worktreeKey)
    const writableRoots = [...repositories, resolve(demandPath, 'docs')]
    const bundle = resolveInstructionBundle({ workspacePath, demandPath, repositoryPaths: repositories })
    return permissionPolicy({
      workspacePath,
      demandPath,
      instructionBundle: bundle,
      effectivePolicy: resolveEffectivePolicy({ workspacePath, readableRoots: [workspacePath], writableRoots, shell: 'disabled', approval: 'workbench' }),
    }, mode)
  }

  private workspacePath(workspaceId: string): string {
    const row = this.db.db.prepare('SELECT path FROM workspaces WHERE id = ?').get(workspaceId) as { path?: string } | undefined
    if (!row?.path) throw new Error('Workspace 不存在')
    return row.path
  }

  private requireDemand(workspaceId: string, demandId: string) {
    const workspace = this.db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined
    if (!workspace) throw new Error('Workspace 不存在')
    const demand = getDemand(this.db, workspace, demandId)
    if (!demand) throw new Error('需求不存在')
    return { ...demand, workspaceId }
  }

  private requireConversation(workspaceId: string, conversationId: string): ConversationRow {
    const row = this.db.db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND id = ?').get(workspaceId, conversationId) as ConversationRow | undefined
    if (!row) throw new Error('会话不存在')
    return row
  }

  private async ensureHandle(row: ConversationRow): Promise<void> {
    if (this.handles.has(row.id)) return
    await this.restore(row)
    if (!this.handles.has(row.id)) throw new Error('会话尚未连接 Runtime，请刷新后重试')
  }

  private handleFor(row: ConversationRow): ConversationHandle {
    const handle = this.handles.get(row.id)
    if (!handle) throw new Error('会话尚未连接 Runtime，请刷新后重试')
    return handle
  }

  private async restore(row: ConversationRow): Promise<void> {
    if (this.handles.has(row.id)) return
    const demand = this.requireDemand(row.workspace_id, row.demand_id)
    const context = permissionPolicy(this.contextFor(demand, row.permission_mode), row.permission_mode)
    const handle = await (this.runtime.resumeConversation
      ? this.runtime.resumeConversation({ conversationId: row.id, nativeId: row.native_id, context })
      : this.runtime.createConversation({ conversationId: row.id, context }))
    this.handles.set(row.id, handle)
    this.contexts.set(row.id, context)
  }
}
