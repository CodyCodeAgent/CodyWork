import { composerHasContent } from '@codycodeagent/cody-web-core/composer'
import { WorkbenchDb, ConversationCreatedVia, ConversationPermissionMode, ConversationRow, nowIso, makeId } from '../db/index.js'
import type {
  ConversationHandle,
  CodyWorkRuntime,
  NativeThreadSummary,
  RuntimeEvent,
  RuntimeComposerOptions,
  RuntimeConversationSnapshot,
} from '../runtime/protocol.js'
import { ConversationEventHub } from './conversationEventHub.js'
import { ConversationContextResolver } from './conversationContext.js'
import { ConversationRepository } from './conversationRepository.js'
import type {
  ConversationAction,
  ConversationActionResult,
  ConversationCommand,
  ConversationCommandGateway,
  ConversationCommandReceipt,
  ConversationCommandSettings,
} from './conversationGateway.js'

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

type ConversationSendSettings = ConversationCommandSettings

type RuntimeTurnSettings = {
  model?: string
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  collaborationMode?: 'default' | 'plan'
  skills?: Array<{ name: string; path: string }>
}

function toView(row: ConversationRow): ConversationView {
  return {
    id: row.id,
    scope: row.scope,
    demandId: row.demand_id,
    nativeId: row.native_id,
    title: row.title,
    createdVia: row.created_via,
    status: row.status,
    permissionMode: row.permission_mode,
    policyHash: row.policy_hash,
    instructionHash: row.instruction_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function persistedStatusForEvent(event: RuntimeEvent): ConversationRow['status'] | null {
  if (event.type === 'command.queued' || event.type === 'command.bound' || event.type === 'turn.started'
    || event.type === 'turn.activity' || event.type === 'turn.retrying') return 'running'
  if (event.type === 'approval.requested' || event.type === 'question.requested') return 'awaiting_approval'
  if (event.type === 'approval.resolved' || event.type === 'question.resolved') return 'running'
  if (event.type === 'turn.completed' || event.type === 'turn.interrupted') return 'completed'
  if (event.type === 'command.failed' || event.type === 'turn.failed') return 'failed'
  if (event.type === 'turn.disconnected') return 'disconnected'
  return null
}

/** Provides durable CodyWork conversation metadata and a reconnectable event stream. */
export class ConversationService implements ConversationCommandGateway {
  private readonly handles = new Map<string, ConversationHandle>()
  private readonly runtimeSubscriptions = new Map<string, () => void>()
  private readonly repository: ConversationRepository
  private readonly contexts: ConversationContextResolver
  private runtime: CodyWorkRuntime
  readonly events = new ConversationEventHub()

  constructor(
    db: WorkbenchDb,
    runtime: CodyWorkRuntime,
    private readonly onTurnFinished?: (workspaceId: string) => void,
    private readonly imageUrlForPath?: (workspaceId: string, conversationId: string, path: string) => string | null,
    private readonly onConversationRemoving?: (workspaceId: string, conversationId: string) => void,
  ) {
    this.runtime = runtime
    this.repository = new ConversationRepository(db)
    this.contexts = new ConversationContextResolver(db)
  }

  getRuntime(): CodyWorkRuntime { return this.runtime }

  diagnostics() { return this.runtime.diagnostics?.() ?? null }

  list(workspaceId: string, demandId: string): ConversationView[] {
    return this.repository.listDemand(workspaceId, demandId).map(toView)
  }

  listWorkspace(workspaceId: string): ConversationView[] {
    this.contexts.workspacePath(workspaceId)
    return this.repository.listWorkspace(workspaceId).map(toView)
  }

  /** Returns recent Codex threads that may be resumed under this Demand's policy. */
  async listAvailableNativeThreads(workspaceId: string, demandId: string): Promise<AvailableNativeThread[]> {
    const demand = this.requireDemand(workspaceId, demandId)
    const threads = await this.runtime.listNativeThreads({ context: this.contexts.demandContext(demand, 'workspace-write') })
    const bound = new Set(this.repository.listNativeIds())
    return threads.map(thread => ({ ...thread, bound: bound.has(thread.nativeId) }))
  }

  get(workspaceId: string, conversationId: string): ConversationView {
    const row = this.repository.get(workspaceId, conversationId)
    if (!row) throw new Error('会话不存在')
    return toView(row)
  }

  async history(workspaceId: string, conversationId: string): Promise<RuntimeConversationSnapshot> {
    const snapshot = await this.historyCanonical(workspaceId, conversationId)
    return { ...snapshot, events: snapshot.events.map(event => this.withPublicImageUrls(event)) }
  }

  /** Canonical native-path snapshot for server-side projections. */
  async historyCanonical(workspaceId: string, conversationId: string): Promise<RuntimeConversationSnapshot> {
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const context = this.contexts.forRow(row)
    return this.runtime.readConversationSnapshot({ conversationId, nativeId: row.native_id, context })
  }

  subscribe(conversationId: string, listener: Listener): () => void {
    return this.events.subscribe({ conversationId }, event => listener(this.withPublicImageUrls(event)))
  }

  async create(workspaceId: string, demandId: string, title?: string, createdVia: ConversationCreatedVia = 'browser'): Promise<ConversationView> {
    const demand = this.requireDemand(workspaceId, demandId)
    const context = this.contexts.demandContext(demand, 'workspace-write')
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
    this.repository.insert(row)
    this.handles.set(id, handle)
    this.attachRuntimeStream(handle)
    return this.get(workspaceId, id)
  }

  async createWorkspace(workspaceId: string, title?: string, createdVia: ConversationCreatedVia = 'browser'): Promise<ConversationView> {
    const context = this.contexts.workspaceContext(workspaceId, 'yolo')
    const id = makeId('conversation')
    const handle = await this.runtime.createConversation({ conversationId: id, context })
    const now = nowIso()
    const row: ConversationRow = {
      id,
      scope: 'workspace',
      demand_id: null,
      workspace_id: workspaceId,
      native_id: handle.nativeId,
      title: title?.trim() || 'Workspace 会话',
      created_via: createdVia,
      status: 'idle',
      permission_mode: 'yolo',
      policy_hash: context.effectivePolicy.hash,
      instruction_hash: context.instructionBundle.sha256,
      created_at: now,
      updated_at: now,
    }
    this.repository.insert(row)
    this.handles.set(id, handle)
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
    const existing = this.repository.getByNativeId(nativeId)
    if (existing) {
      if (existing.workspace_id === workspaceId && existing.demand_id === demandId) throw new Error('这个 Thread 已绑定到当前 Demand')
      throw new Error('这个 Thread 已绑定到另一个 Demand，不能跨 Worktree 复用')
    }
    const context = this.contexts.demandContext(demand, 'workspace-write')
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
    this.repository.insert(row)
    this.audit(id, 'conversation.bound', { nativeId, demandId: demand.id, policyHash: context.effectivePolicy.hash })
    return this.get(workspaceId, id)
  }

  async composerOptions(workspaceId: string, demandId: string): Promise<RuntimeComposerOptions> {
    const demand = this.requireDemand(workspaceId, demandId)
    return this.runtime.getComposerOptions(this.contexts.demandContext(demand, 'workspace-write'))
  }

  async workspaceComposerOptions(workspaceId: string): Promise<RuntimeComposerOptions> {
    return this.runtime.getComposerOptions(this.contexts.workspaceContext(workspaceId))
  }

  /**
   * A Demand can gain another Repo after its conversations were attached.
   * Keep the persisted policy fingerprint and every live Runtime session in
   * sync so the next Turn can use the new Worktree immediately.
   */
  async refreshDemandContexts(workspaceId: string, demandId: string): Promise<void> {
    const demand = this.requireDemand(workspaceId, demandId)
    const rows = this.repository.listDemandRows(workspaceId, demandId)
    const updatedAt = nowIso()

    for (const row of rows) {
      // The Runtime context is the immutable Demand scope ceiling. Approval
      // behavior is selected per command and must not erase writable roots.
      const context = this.contexts.demandContext(demand, 'workspace-write')
      this.repository.updateContext(row.id, context.effectivePolicy.hash, context.instructionBundle.sha256, updatedAt)
      const handle = this.handles.get(row.id)
      if (!handle) continue
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
    return this.submitCommand({
      id: requestedCommandId,
      workspaceId,
      conversationId,
      origin: { kind: 'browser' },
      prompt,
      submitMode: mode,
      executionProfile: { permissionMode: row.permission_mode },
      settings,
      localImages,
    })
  }

  async submitCommand(command: ConversationCommand): Promise<ConversationCommandReceipt> {
    const { workspaceId, conversationId } = command
    const row = this.requireConversation(workspaceId, conversationId)
    await this.ensureHandle(row)
    const text = command.prompt.trim()
    const localImages = command.localImages ?? []
    const requestedSkills = (command.settings?.skills ?? []).filter(skill => typeof skill === 'string' && skill.trim()).map(skill => skill.trim()).slice(0, 20)
    if (!composerHasContent({ text, skills: requestedSkills, images: localImages })) throw new Error('消息不能为空')
    const commandId = command.id?.trim().slice(0, 200) || makeId('command')
    const permissionMode = command.executionProfile?.permissionMode ?? row.permission_mode
    const context = this.contexts.forRow(row)
    const selectedSkills = await this.runtime.resolveSkills(context, requestedSkills)
    const runtimeSettings: RuntimeTurnSettings = {
      ...(command.settings?.model ? { model: command.settings.model } : {}),
      ...(command.settings?.reasoningEffort ? { reasoningEffort: command.settings.reasoningEffort } : {}),
      ...(command.settings?.collaborationMode ? { collaborationMode: command.settings.collaborationMode } : {}),
      ...(selectedSkills.length ? { skills: selectedSkills } : {}),
    }
    this.repository.touch(conversationId)
    const submission = this.runtime.submitTurn({
      conversation: this.handleFor(row),
      prompt: text,
      ...(localImages.length ? { localImages } : {}),
      mode: command.submitMode ?? 'queue',
      clientCommandId: commandId,
      executionProfile: { permissionMode },
      ...(Object.keys(runtimeSettings).length ? { settings: runtimeSettings } : {}),
      ...(!this.runtimeSubscriptions.has(conversationId) ? { onEvent: (event: RuntimeEvent) => this.appendRuntimeEvent(event) } : {}),
    })
    void submission.started.then((handle) => {
      this.audit(conversationId, 'turn.bound', { commandId, nativeTurnId: handle.turnId, origin: command.origin, executionProfile: { permissionMode } })
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
    await this.ensureHandle(row)
    await this.runtime.setPermission(this.handleFor(row), mode)
    this.repository.updatePermission(conversationId, mode)
    this.audit(conversationId, 'permission.changed', { mode })
    return this.get(workspaceId, conversationId)
  }

  async interrupt(workspaceId: string, conversationId: string): Promise<{ supported: boolean }> {
    const result = await this.executeAction({ kind: 'interrupt', workspaceId, conversationId, origin: { kind: 'browser' } })
    return { supported: result.kind === 'interrupt' && result.supported }
  }

  async approve(workspaceId: string, conversationId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    await this.executeAction({ kind: 'approval.resolve', workspaceId, conversationId, origin: { kind: 'browser' }, requestId: approvalId, outcome })
  }

  async answer(workspaceId: string, conversationId: string, requestId: string, answer: unknown): Promise<void> {
    await this.executeAction({ kind: 'question.resolve', workspaceId, conversationId, origin: { kind: 'browser' }, requestId, answer })
  }

  async executeAction(action: ConversationAction): Promise<ConversationActionResult> {
    const row = this.requireConversation(action.workspaceId, action.conversationId)
    await this.ensureHandle(row)
    const handle = this.handleFor(row)
    if (action.kind === 'interrupt') {
      const result = await this.runtime.interrupt(handle)
      this.audit(action.conversationId, 'turn.interrupt', { ...result, origin: action.origin })
      return { kind: 'interrupt', supported: result.supported }
    }
    if (action.kind === 'approval.resolve') {
      await this.runtime.respondApproval(handle, action.requestId, action.outcome)
      this.audit(action.conversationId, 'approval.resolved', { approvalId: action.requestId, outcome: action.outcome, origin: action.origin })
      return { kind: 'resolved' }
    }
    await this.runtime.respondQuestion(handle, action.requestId, action.answer)
    this.audit(action.conversationId, 'question.resolved', { requestId: action.requestId, answer: action.answer, origin: action.origin })
    return { kind: 'resolved' }
  }

  async rename(workspaceId: string, conversationId: string, title: string): Promise<ConversationView> {
    const row = this.requireConversation(workspaceId, conversationId)
    const value = title.trim()
    if (!value) throw new Error('会话标题不能为空')
    if (value.length > 120) throw new Error('会话标题不能超过 120 个字符')
    if (value === row.title) return toView(row)
    await this.ensureHandle(row)
    await this.runtime.renameConversation(this.handleFor(row), value)
    this.repository.updateTitle(conversationId, value)
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
      if (this.repository.demandCount(workspaceId, row.demand_id) <= 1) throw new Error('每个 Demand 至少保留一个会话')
    }

    this.onConversationRemoving?.(workspaceId, conversationId)
    // Local audit records are deleted through their foreign-key cascade; native Thread is retained.
    this.repository.delete(workspaceId, conversationId)
    this.handles.delete(conversationId)
    this.events.clear(conversationId)
    this.runtimeSubscriptions.get(conversationId)?.()
    this.runtimeSubscriptions.delete(conversationId)
    return { deleted: true }
  }

  private appendRuntimeEvent(event: RuntimeEvent): void {
    const status = persistedStatusForEvent(event)
    if (status) {
      this.repository.updateStatus(event.conversationId, status, event.timestamp || nowIso())
    }
    this.events.publish(event)
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
    const row = this.repository.getById(conversationId)
    if (!row) throw new Error('会话不存在')
    return row
  }

  private audit(conversationId: string, action: string, data: unknown): void {
    this.repository.audit(conversationId, action, data)
  }

  private requireDemand(workspaceId: string, demandId: string) {
    return this.contexts.demand(workspaceId, demandId)
  }

  private requireConversation(workspaceId: string, conversationId: string): ConversationRow {
    const row = this.repository.get(workspaceId, conversationId)
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
    const context = this.contexts.forRow(row)
    const handle = await this.runtime.resumeConversation({ conversationId: row.id, nativeId: row.native_id, context })
    this.handles.set(row.id, handle)
    this.attachRuntimeStream(handle)
  }

  private attachRuntimeStream(handle: ConversationHandle): void {
    if (this.runtimeSubscriptions.has(handle.id) || !this.runtime.subscribeConversation) return
    this.runtimeSubscriptions.set(handle.id, this.runtime.subscribeConversation(handle, event => this.appendRuntimeEvent(event)))
  }

}
