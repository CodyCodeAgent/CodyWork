import { composerHasContent } from '@codycodeagent/cody-web-core/composer'
import { resolve } from 'node:path'
import { WorkbenchDb, ConversationCreatedVia, ConversationPermissionMode, ConversationRow, WorkspaceRow, nowIso, makeId } from '../db/index.js'
import { getDemand } from './demands.js'
import { resolveEffectivePolicy, resolveInstructionBundle } from '../runtime/policy.js'
import type {
  ConversationHandle,
  CodyWorkRuntime,
  NativeThreadSummary,
  RuntimeContext,
  RuntimeEvent,
  RuntimeComposerOptions,
  RuntimeConversationSnapshot,
} from '../runtime/protocol.js'

export interface ConversationView {
  id: string
  scope: ConversationRow['scope']
  demandId: string | null
  nativeId: string
  title: string
  createdVia: ConversationCreatedVia
  status: ConversationRow['status']
  permissionMode: ConversationPermissionMode
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
}

export interface AvailableNativeThread extends NativeThreadSummary {
  bound: boolean
}

type Listener = (event: ConversationEvent) => void

type ConversationSendSettings = {
  model?: string
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  collaborationMode?: 'default' | 'plan'
  skills?: string[]
}

type RuntimeTurnSettings = {
  model?: string
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  collaborationMode?: 'default' | 'plan'
  skills?: Array<{ name: string; path: string }>
}

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

function toView(row: ConversationRow): ConversationView {
  return {
    id: row.id,
    scope: row.scope,
    demandId: row.demand_id,
    nativeId: row.native_id,
    title: row.title,
    createdVia: row.created_via,
    status: 'idle',
    permissionMode: row.permission_mode,
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
  private readonly channelListeners = new Map<string, Set<Listener>>()
  private readonly allChannelListeners = new Set<Listener>()
  private readonly runtimeSubscriptions = new Map<string, () => void>()
  private runtime: CodyWorkRuntime

  constructor(
    private readonly db: WorkbenchDb,
    runtime: CodyWorkRuntime,
    private readonly onTurnFinished?: (workspaceId: string) => void,
    private readonly imageUrlForPath?: (workspaceId: string, conversationId: string, path: string) => string | null,
    private readonly onConversationRemoving?: (workspaceId: string, conversationId: string) => void,
  ) { this.runtime = runtime }

  getRuntime(): CodyWorkRuntime { return this.runtime }

  diagnostics() { return this.runtime.diagnostics?.() ?? null }

  list(workspaceId: string, demandId: string): ConversationView[] {
    const rows = this.db.db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND scope = 'demand' AND demand_id = ? ORDER BY updated_at DESC, created_at DESC").all(workspaceId, demandId) as unknown as ConversationRow[]
    return rows.map(toView)
  }

  listWorkspace(workspaceId: string): ConversationView[] {
    this.workspacePath(workspaceId)
    const rows = this.db.db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND scope = 'workspace' ORDER BY updated_at DESC, created_at DESC").all(workspaceId) as unknown as ConversationRow[]
    return rows.map(toView)
  }

  /** Returns recent Codex threads that may be resumed under this Demand's policy. */
  async listAvailableNativeThreads(workspaceId: string, demandId: string): Promise<AvailableNativeThread[]> {
    const demand = this.requireDemand(workspaceId, demandId)
    const threads = await this.runtime.listNativeThreads({ context: this.contextFor(demand, 'workspace-write') })
    const boundRows = this.db.db.prepare('SELECT native_id FROM conversations').all() as Array<{ native_id: string }>
    const bound = new Set(boundRows.map(row => row.native_id))
    return threads.map(thread => ({ ...thread, bound: bound.has(thread.nativeId) }))
  }

  get(workspaceId: string, conversationId: string): ConversationView {
    const row = this.db.db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND id = ?').get(workspaceId, conversationId) as ConversationRow | undefined
    if (!row) throw new Error('会话不存在')
    return toView(row)
  }

  async history(workspaceId: string, conversationId: string): Promise<RuntimeConversationSnapshot> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const context = this.contextForRow(row)
    const snapshot = await this.runtime.readConversationSnapshot({ conversationId, nativeId: row.native_id, context })
    return { ...snapshot, events: snapshot.events.map(event => this.withPublicImageUrls(event)) }
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

  /** Shares the owner Runtime stream with server-side channel projections.
   * It deliberately preserves local image paths; browser subscribers receive
   * the authenticated public URL projection from `subscribe`. */
  subscribeChannel(conversationId: string, listener: Listener): () => void {
    const set = this.channelListeners.get(conversationId) ?? new Set<Listener>()
    set.add(listener)
    this.channelListeners.set(conversationId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.channelListeners.delete(conversationId)
    }
  }

  /** Observes the owner Runtime event bus independently of an individual
   * conversation handle. Channel hosts use this process-lifetime tap so a
   * resumed handle cannot silently orphan external projections. */
  subscribeAllChannels(listener: Listener): () => void {
    this.allChannelListeners.add(listener)
    return () => { this.allChannelListeners.delete(listener) }
  }

  async create(workspaceId: string, demandId: string, title?: string, createdVia: ConversationCreatedVia = 'browser'): Promise<ConversationView> {
    const demand = this.requireDemand(workspaceId, demandId)
    const context = this.contextFor(demand, 'workspace-write')
    const id = makeId('conversation')
    const handle = await this.runtime.createConversation({ conversationId: id, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: 'demand',
      demand_id: demand.id,
      workspace_id: workspaceId,
      native_id: handle.nativeId,
      title: title?.trim() || '新会话',
      created_via: createdVia,
      status: 'idle',
      permission_mode: 'workspace-write',
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.db.db.prepare('INSERT INTO conversations (id, scope, demand_id, workspace_id, native_id, title, created_via, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        row.id, row.scope, row.demand_id, row.workspace_id, row.native_id,
        row.title, row.created_via, row.status, row.permission_mode,
        row.policy_hash, row.instruction_hash, row.created_at,
        row.updated_at,
      )
    this.handles.set(id, handle)
    this.contexts.set(id, context)
    this.attachRuntimeStream(handle)
    return this.get(workspaceId, id)
  }

  async createWorkspace(workspaceId: string, title?: string, createdVia: ConversationCreatedVia = 'browser'): Promise<ConversationView> {
    const context = this.workspaceContext(workspaceId)
    const id = makeId('conversation')
    const handle = await this.runtime.createConversation({ conversationId: id, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: 'workspace',
      demand_id: null,
      workspace_id: workspaceId,
      native_id: handle.nativeId,
      title: title?.trim() || 'Workspace 搜索',
      created_via: createdVia,
      status: 'idle',
      permission_mode: 'read-only',
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.db.db.prepare('INSERT INTO conversations (id, scope, demand_id, workspace_id, native_id, title, created_via, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.scope, row.demand_id, row.workspace_id, row.native_id, row.title, row.created_via, row.status, row.permission_mode, row.policy_hash, row.instruction_hash, row.created_at, row.updated_at)
    this.handles.set(id, handle)
    this.contexts.set(id, context)
    this.attachRuntimeStream(handle)
    this.audit(id, 'conversation.workspace_created', { workspaceId, policyHash: context.effectivePolicy.hash })
    return this.get(workspaceId, id)
  }

  /** Binds a native Codex thread to this Demand without weakening its Worktree policy. */
  async bind(workspaceId: string, demandId: string, input: { nativeId: string; title?: string }): Promise<ConversationView> {
    const nativeId = input.nativeId.trim()
    if (!nativeId) throw new Error('请输入 Thread 或 Session ID')
    if (nativeId.length > 240) throw new Error('Thread 或 Session ID 过长')
    const demand = this.requireDemand(workspaceId, demandId)
    const existing = this.db.db.prepare('SELECT * FROM conversations WHERE native_id = ?').get(nativeId) as ConversationRow | undefined
    if (existing) {
      if (existing.workspace_id === workspaceId && existing.demand_id === demandId) throw new Error('这个 Thread 已绑定到当前 Demand')
      throw new Error('这个 Thread 已绑定到另一个 Demand，不能跨 Worktree 复用')
    }
    const context = this.contextFor(demand, 'workspace-write')
    const id = makeId('conversation')
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: 'demand',
      demand_id: demand.id,
      workspace_id: workspaceId,
      native_id: nativeId,
      title: input.title?.trim() || `已绑定 Thread ${nativeId.slice(0, 8)}`,
      created_via: 'browser',
      status: 'idle',
      permission_mode: 'workspace-write',
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.db.db.prepare('INSERT INTO conversations (id, scope, demand_id, workspace_id, native_id, title, created_via, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.scope, row.demand_id, row.workspace_id, row.native_id, row.title, row.created_via, row.status, row.permission_mode, row.policy_hash, row.instruction_hash, row.created_at, row.updated_at)
    this.audit(id, 'conversation.bound', { nativeId, demandId: demand.id, policyHash: context.effectivePolicy.hash })
    return this.get(workspaceId, id)
  }

  async composerOptions(workspaceId: string, demandId: string): Promise<RuntimeComposerOptions> {
    const demand = this.requireDemand(workspaceId, demandId)
    return this.runtime.getComposerOptions(this.contextFor(demand, 'workspace-write'))
  }

  async workspaceComposerOptions(workspaceId: string): Promise<RuntimeComposerOptions> {
    return this.runtime.getComposerOptions(this.workspaceContext(workspaceId))
  }

  /**
   * A Demand can gain another Repo after its conversations were attached.
   * Keep the persisted policy fingerprint and every live Runtime session in
   * sync so the next Turn can use the new Worktree immediately.
   */
  async refreshDemandContexts(workspaceId: string, demandId: string): Promise<void> {
    const demand = this.requireDemand(workspaceId, demandId)
    const rows = this.db.db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND demand_id = ?').all(workspaceId, demandId) as unknown as ConversationRow[]
    const updatedAt = nowIso()
    const updateMetadata = this.db.db.prepare('UPDATE conversations SET policy_hash = ?, instruction_hash = ?, updated_at = ? WHERE id = ?')

    for (const row of rows) {
      const context = this.contextFor(demand, row.permission_mode)
      updateMetadata.run(context.effectivePolicy.hash, context.instructionBundle.sha256, updatedAt, row.id)
      const handle = this.handles.get(row.id)
      if (!handle) continue
      this.contexts.set(row.id, context)
      await this.runtime.updateContext(handle, context)
    }
  }

  async send(
    workspaceId: string,
    conversationId: string,
    prompt: string,
    mode: 'queue' | 'steer' = 'queue',
    settings?: ConversationSendSettings,
    requestedCommandId?: string,
    localImages: Array<{ path: string }> = [],
  ): Promise<{ accepted: true; commandId: string }> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const text = prompt.trim()
    const requestedSkills = (settings?.skills ?? []).filter(skill => typeof skill === 'string' && skill.trim()).map(skill => skill.trim()).slice(0, 20)
    if (!composerHasContent({ text, skills: requestedSkills, images: localImages })) throw new Error('消息不能为空')
    const commandId = requestedCommandId?.trim().slice(0, 200) || makeId('command')
    const context = this.contexts.get(conversationId)
    if (!context) throw new Error('会话 Runtime 上下文不可用')
    const selectedSkills = await this.runtime.resolveSkills(context, requestedSkills)
    const runtimeSettings: RuntimeTurnSettings = {
      ...(settings?.model ? { model: settings.model } : {}),
      ...(settings?.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
      ...(settings?.collaborationMode ? { collaborationMode: settings.collaborationMode } : {}),
      ...(selectedSkills.length ? { skills: selectedSkills } : {}),
    }
    this.db.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversationId)
    const submission = this.runtime.submitTurn({
      conversation: this.handleFor(row),
      prompt: text,
      ...(localImages.length ? { localImages } : {}),
      mode,
      clientCommandId: commandId,
      ...(Object.keys(runtimeSettings).length ? { settings: runtimeSettings } : {}),
      ...(!this.runtimeSubscriptions.has(conversationId) ? { onEvent: (event: RuntimeEvent) => this.appendRuntimeEvent(event) } : {}),
    })
    void submission.started.then((handle) => {
      this.audit(conversationId, 'turn.bound', { commandId, nativeTurnId: handle.turnId })
    }).catch((error: unknown) => {
      this.audit(conversationId, 'command.failed', { commandId, error: error instanceof Error ? error.message : String(error) })
    })
    void submission.completed.then(
      () => this.onTurnFinished?.(row.workspace_id),
      () => this.onTurnFinished?.(row.workspace_id),
    )
    return { accepted: true, commandId: submission.clientCommandId }
  }

  async setPermission(workspaceId: string, conversationId: string, mode: ConversationPermissionMode): Promise<ConversationView> {
    const row = this.requireConversation(workspaceId, conversationId)
    if (row.scope === 'workspace' && mode !== 'read-only') {
      throw new Error('Workspace 会话固定为只读；需要修改代码时请进入 Demand Worktree')
    }
    await this.ensureHandle(row)
    const context = this.contexts.get(conversationId)
    if (context) {
      const next = permissionPolicy(context, mode)
      this.contexts.set(conversationId, next)
      await this.runtime.setPermission(this.handleFor(row), mode)
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
    return result
  }

  async approve(workspaceId: string, conversationId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    await this.runtime.respondApproval(this.handleFor(row), approvalId, outcome)
    this.audit(conversationId, 'approval.resolved', { approvalId, outcome })
  }

  async answer(workspaceId: string, conversationId: string, requestId: string, answer: unknown): Promise<void> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    await this.runtime.respondQuestion(this.handleFor(row), requestId, answer)
    this.audit(conversationId, 'question.resolved', { requestId, answer })
  }

  async rename(workspaceId: string, conversationId: string, title: string): Promise<ConversationView> {
    const row = this.requireConversation(workspaceId, conversationId)
    const value = title.trim()
    if (!value) throw new Error('会话标题不能为空')
    if (value.length > 120) throw new Error('会话标题不能超过 120 个字符')
    if (value === row.title) return toView(row)
    await this.ensureHandle(row)
    await this.runtime.renameConversation(this.handleFor(row), value)
    this.db.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(value, nowIso(), conversationId)
    this.audit(conversationId, 'conversation.renamed', { title: value })
    return this.get(workspaceId, conversationId)
  }

  /** Removes CodyWork's local record only. The native Codex Thread is intentionally retained. */
  async remove(workspaceId: string, conversationId: string): Promise<{ deleted: true }> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const handle = this.handleFor(row)
    const state = this.runtime.sessionSnapshot?.(handle) ?? null
    if (state?.activeTurnId || state?.pendingRequestCount) {
      throw new Error('会话正在执行或等待确认，请先停止后再删除')
    }
    if (row.scope === 'demand') {
      const count = this.db.db.prepare("SELECT COUNT(*) AS count FROM conversations WHERE workspace_id = ? AND scope = 'demand' AND demand_id = ?").get(workspaceId, row.demand_id) as { count: number }
      if (count.count <= 1) throw new Error('每个 Demand 至少保留一个会话')
    }

    this.onConversationRemoving?.(workspaceId, conversationId)
    // Local audit records are deleted through their foreign-key cascade; native Thread is retained.
    this.db.db.prepare('DELETE FROM conversations WHERE id = ? AND workspace_id = ?').run(conversationId, workspaceId)
    this.handles.delete(conversationId)
    this.contexts.delete(conversationId)
    this.listeners.delete(conversationId)
    this.channelListeners.delete(conversationId)
    this.runtimeSubscriptions.get(conversationId)?.()
    this.runtimeSubscriptions.delete(conversationId)
    return { deleted: true }
  }

  private appendRuntimeEvent(event: RuntimeEvent): void {
    // Channel projections are side effects of the native Runtime stream. A
    // broken or stale provider listener must never block the browser's primary
    // realtime projection (or another channel listener) for the same Thread.
    for (const listener of this.channelListeners.get(event.conversationId) ?? []) {
      try { listener(event) }
      catch (error) {
        console.error(`[codywork] channel listener failed for ${event.conversationId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const listener of this.allChannelListeners) {
      try { listener(event) }
      catch (error) {
        console.error(`[codywork] global channel listener failed for ${event.conversationId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.publish(this.withPublicImageUrls(event))
  }

  private withPublicImageUrls(event: RuntimeEvent): RuntimeEvent {
    if (!this.imageUrlForPath || !Array.isArray(event.data.images)) return event
    const resolveImageUrl = this.imageUrlForPath
    const workspaceId = this.requireConversationById(event.conversationId).workspace_id
    const images = event.data.images.map(image => typeof image === 'string'
      ? resolveImageUrl(workspaceId, event.conversationId, image) ?? image
      : image)
    return { ...event, data: { ...event.data, images } }
  }

  private requireConversationById(conversationId: string): ConversationRow {
    const row = this.db.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as ConversationRow | undefined
    if (!row) throw new Error('会话不存在')
    return row
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

  private workspaceContext(workspaceId: string): RuntimeContext {
    const workspacePath = this.workspacePath(workspaceId)
    const bundle = resolveInstructionBundle({ workspacePath, workspaceSearch: true })
    return {
      workspacePath,
      instructionBundle: bundle,
      effectivePolicy: resolveEffectivePolicy({
        workspacePath,
        readableRoots: [workspacePath],
        writableRoots: [],
        shell: 'full',
        approval: 'workbench',
      }),
    }
  }

  private contextForRow(row: ConversationRow): RuntimeContext {
    if (row.scope === 'workspace') return this.workspaceContext(row.workspace_id)
    if (!row.demand_id) throw new Error('需求会话缺少 Demand')
    return this.contextFor(this.requireDemand(row.workspace_id, row.demand_id), row.permission_mode)
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
    const context = this.contextForRow(row)
    const handle = await this.runtime.resumeConversation({ conversationId: row.id, nativeId: row.native_id, context })
    this.handles.set(row.id, handle)
    this.contexts.set(row.id, context)
    this.attachRuntimeStream(handle)
  }

  private attachRuntimeStream(handle: ConversationHandle): void {
    if (this.runtimeSubscriptions.has(handle.id) || !this.runtime.subscribeConversation) return
    this.runtimeSubscriptions.set(handle.id, this.runtime.subscribeConversation(handle, event => this.appendRuntimeEvent(event)))
  }

}
