import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import {
  AcpSessionHost,
  type AcpPermissionOption,
  type AcpSession,
  type AcpSessionConfigOption,
  type AcpSessionUpdate,
} from '@codycodeagent/cody-web-core/acp'
import { nowIso } from '../db/index.js'
import type {
  ConversationHandle,
  CodyWorkRuntime,
  CodexRuntimeInfo,
  CreateConversationRequest,
  ListNativeThreadsRequest,
  NativeThreadSummary,
  ReadConversationRequest,
  ReasoningEffort,
  RuntimeComposerOptions,
  RuntimeContext,
  RuntimeConversationSnapshot,
  RuntimeEvent,
  RuntimePermissionMode,
  RuntimeSkillCatalogEntry,
  RuntimeSkillCatalogRequest,
  SendTurnRequest,
  SendTurnResult,
  SubmitTurnResult,
  WorkspaceCheckRequest,
  WorkspaceCheckResult,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResult,
} from './protocol.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION } from './protocol.js'
import { resolveEffectivePolicy, resolveInstructionBundle } from './policy.js'

type TraeOptions = { command?: string; env?: NodeJS.ProcessEnv }
type PendingApproval = { options: AcpPermissionOption[]; resolve: (optionId: string | null) => void }
type ProductSession = {
  handle: ConversationHandle
  context: RuntimeContext
  mode: RuntimePermissionMode
  acp: AcpSession
  listeners: Set<(event: RuntimeEvent) => void>
  events: RuntimeEvent[]
  watermark: number
  approvals: Map<string, PendingApproval>
  /** The original ACP prompt that owns the task lifecycle. */
  running: Promise<unknown> | null
  /** Supplemental prompts accepted while the original task remains active. */
  appendRuns: Set<Promise<unknown>>
  /** The CodyWork command id currently owned by this single-session ACP process. */
  activeTurnId?: string
  /** Turns terminally interrupted after ACP failed to settle cancellation. */
  forcedInterruptedTurns: Set<string>
  /** Wakes an in-flight adapter turn when its ACP transport is force-closed. */
  forcedInterruptionResolvers: Map<string, () => void>
  closed: boolean
}

const CANCEL_NOTIFICATION_TIMEOUT_MS = 750
const CANCEL_SETTLEMENT_TIMEOUT_MS = 1_500

function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    void promise.then(
      () => { clearTimeout(timer); resolve(true) },
      () => { clearTimeout(timer); resolve(true) },
    )
  })
}

function executionCwd(context: RuntimeContext): string { return realpathSync.native(context.demandPath ?? context.workspacePath) }
function runtimeEvent(
  session: ProductSession,
  type: RuntimeEvent['type'],
  data: Record<string, unknown> = {},
  turnId?: string,
  itemId?: string,
): RuntimeEvent {
  const atIso = nowIso()
  // The shared browser controller discards events without `id`/`threadId` and
  // needs a stable Turn id to settle its optimistic outbox entry. ACP does not
  // supply CodyWork command ids, so the adapter preserves the id assigned at
  // submit time for the whole native prompt lifecycle.
  return {
    id: randomUUID(),
    type,
    // CodyWork routes a stream by its local conversation id, while the shared
    // browser reducer identifies that same stream by its native Session id.
    // They are intentionally different IDs and both must be retained.
    threadId: session.handle.nativeId,
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    data,
    conversationId: session.handle.id,
    timestamp: atIso,
    atIso,
  }
}
function textContent(update: AcpSessionUpdate): string {
  if (!('content' in update) || !update.content || Array.isArray(update.content) || update.content.type !== 'text') return ''
  return update.content.text
}
function isSelectOption(option: AcpSessionConfigOption): option is Extract<AcpSessionConfigOption, { type: 'select' }> { return option.type === 'select' }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function finiteNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function supportsImage(session: ProductSession): boolean { return AcpSessionHost.supportsImage(session.acp) }

/**
 * Trae owns an ACP process per attached CodyWork conversation. Trae ACP is
 * single-session per process, so sharing a process here would silently break
 * concurrent CodyWork conversations. The adapter never writes an alternate
 * conversation transcript: ACP session state is the durable authority.
 */
export class CodyWorkTraeRuntime implements CodyWorkRuntime {
  private readonly sessions = new Map<string, ProductSession>()
  private readonly acp: AcpSessionHost

  constructor(private readonly options: TraeOptions = {}) {
    this.acp = new AcpSessionHost({
      command: options.command?.trim() || globalThis.process.env.CODY_TRAE_COMMAND?.trim() || 'traex acp serve',
      env: options.env,
      clientName: 'codywork',
    })
  }

  async checkConnection(): Promise<CodexRuntimeInfo> {
    // Unlike Codex's shared owner, Trae ACP has no resident process before a
    // conversation starts. A test must therefore complete the ACP initialize
    // handshake, then tear down this probe process immediately.
    await this.acp.probe()
    return this.getInfo()
  }
  async getInfo(): Promise<CodexRuntimeInfo> { return { runtimeVersion: 'traecli-acp', protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION } }
  diagnostics() { return { runtime: 'trae', activeSessions: this.acp.size } }
  async checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult> {
    return { status: existsSync(request.workspacePath) ? 'ready' : 'error', present: existsSync(request.workspacePath) ? [request.workspacePath] : [], missing: existsSync(request.workspacePath) ? [] : [request.workspacePath], message: existsSync(request.workspacePath) ? 'Trae ACP 使用 CodyWork Workspace' : 'Workspace 不存在' }
  }
  async initializeWorkspace(request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult> {
    const context: RuntimeContext = {
      workspacePath: request.workspacePath,
      instructionBundle: resolveInstructionBundle({ workspacePath: request.workspacePath, platformInstructions: request.instruction }),
      effectivePolicy: resolveEffectivePolicy({ workspacePath: request.workspacePath, writableRoots: [request.workspacePath], shell: 'allowlist', approval: 'none' }),
    }
    const conversation = await this.createConversation({ conversationId: `workspace-setup-${randomUUID()}`, context })
    try {
      const result = await this.sendTurn({ conversation, prompt: request.instruction, ...(request.onEvent ? { onEvent: request.onEvent } : {}) })
      return { status: 'initialized', message: result.finalText || 'Trae 已完成 Workspace 初始化。' }
    } finally { this.releaseConversation(conversation) }
  }

  async createConversation(request: CreateConversationRequest): Promise<ConversationHandle> {
    const id = request.conversationId ?? `conversation-${randomUUID()}`
    if (this.sessions.has(id)) return this.requireById(id).handle
    return this.startSession(id, request.context)
  }

  async resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle> {
    const existing = this.sessions.get(request.conversationId ?? '')
    if (existing) {
      if (existing.handle.nativeId !== request.nativeId) throw new Error('会话绑定与请求的原生 Session 不一致')
      return existing.handle
    }
    return this.startSession(request.conversationId ?? `conversation-${randomUUID()}`, request.context, request.nativeId)
  }

  async renameConversation(_conversation: ConversationHandle, _title: string): Promise<void> {
    // ACP v1 does not expose a standard session-title mutation. Pretending to
    // support it would create a product/native title split, so retain the
    // CodyWork title only and leave the native session untouched.
  }

  async readConversationSnapshot(request: ReadConversationRequest): Promise<RuntimeConversationSnapshot> {
    let session = this.sessions.get(request.conversationId)
    if (!session) await this.resumeConversation({ conversationId: request.conversationId, nativeId: request.nativeId, context: request.context })
    session = this.requireById(request.conversationId)
    if (session.handle.nativeId !== request.nativeId) throw new Error('会话绑定与请求的原生 Session 不一致')
    // ACP `session/load` restores the native session into this process. Events
    // below are only the active connection watermark, never persisted by CodyWork.
    return { events: [...session.events], watermark: session.watermark }
  }

  sessionSnapshot(conversation: ConversationHandle) {
    const session = this.sessions.get(conversation.id)
    if (!session || session.handle.nativeId !== conversation.nativeId || session.closed) return null
    return {
      bindingId: session.handle.id,
      threadId: session.handle.nativeId,
      activeTurnId: session.activeTurnId ?? '',
      pendingRequestCount: session.approvals.size,
      attached: true,
      runtimeAvailable: true,
      quarantinedReason: '',
    }
  }

  subscribeConversation(conversation: ConversationHandle, listener: (event: RuntimeEvent) => void): () => void { return this.listen(this.require(conversation), listener) }

  async listNativeThreads(request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]> {
    return (await this.acp.list(executionCwd(request.context)))
      .map(item => ({ nativeId: item.sessionId, preview: item.title ?? item.sessionId, ...(item.cwd ? { cwd: item.cwd } : {}) }))
  }

  async getComposerOptions(context: RuntimeContext): Promise<RuntimeComposerOptions> {
    const session = await this.createEphemeralSession(context)
    try {
      const models = this.models(session.acp.configOptions)
      // ACP exposes mode config metadata, but this adapter has no stable
      // mapping to apply it to a Turn yet. Do not surface a selectable plan
      // control until that mapping exists.
      const collaborationModes: RuntimeComposerOptions['collaborationModes'] = []
      return {
        provider: { type: 'trae', label: 'Trae ACP' },
        capabilities: {
          modelSelection: models.length > 0,
          // ACP config selection is not a reasoning-effort input. Do not
          // label an arbitrary default as supported reasoning.
          reasoning: false,
          structuredSkills: false,
          imageInput: supportsImage(session),
          nativeSessionList: Boolean(session.acp.capabilities.sessionCapabilities?.list)
            && Boolean(session.acp.capabilities.loadSession || session.acp.capabilities.sessionCapabilities?.resume),
          planMode: false,
          // ACP v1 does not advertise a separate steer operation.
          steer: false,
          // A supplemental ACP prompt is explicitly presented as an append,
          // never as a claim that Trae can steer the current Turn.
          append: true,
          questions: false,
          // TraeX owns collection through its ai-contribution plugin. CodyWork
          // reads its durable delivery receipts instead of fabricating reports.
          aiCodeReports: true,
        },
        models,
        skills: [],
        collaborationModes,
      }
    } finally { this.releaseConversation(session.handle) }
  }
  async listSkillCatalog(_request: RuntimeSkillCatalogRequest): Promise<RuntimeSkillCatalogEntry[]> {
    // Trae discovers Skills through its own workspace rules. ACP v1 has no
    // provider-authoritative Skills catalog, so returning an empty catalog is
    // truthful and does not invent unsupported structured skill inputs.
    return []
  }
  async resolveSkills(_context: RuntimeContext, skillIds: string[]): Promise<Array<{ name: string; path: string }>> {
    if (skillIds.length) throw new Error('当前 Trae ACP 未提供可解析的 Skill catalog')
    return []
  }
  async setPermission(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void> { this.require(conversation).mode = mode }
  async updateContext(conversation: ConversationHandle, context: RuntimeContext): Promise<void> { this.require(conversation).context = context }

  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> { return this.submitTurn(request).completed }
  submitTurn(request: SendTurnRequest): SubmitTurnResult {
    const session = this.require(request.conversation)
    if (request.mode === 'append' && session.running && session.activeTurnId) return this.submitAppend(session, request)
    if (this.isBusy(session) && request.mode !== 'steer') {
      const completed = this.whenIdle(session).then(() => this.sendTurn(request))
      return { clientCommandId: request.clientCommandId ?? randomUUID(), started: completed.then(result => ({ threadId: result.conversation.nativeId, turnId: '' })), completed }
    }
    const clientCommandId = request.clientCommandId ?? randomUUID()
    const events: RuntimeEvent[] = []
    const unsubscribe = this.listen(session, event => { events.push(event); request.onEvent?.(event) })
    const started = Promise.resolve({ threadId: session.handle.nativeId, turnId: clientCommandId })
    // ACP does not expose a separate native Turn identifier. Preserve the
    // client command id as the stable Turn identity and publish the same
    // command lifecycle contract as Codex. Channel projections use this
    // boundary to associate a Feishu card with the ensuing streamed output.
    this.emit(session, runtimeEvent(session, 'command.queued', { clientCommandId, text: request.prompt }, undefined, clientCommandId))
    this.emit(session, runtimeEvent(session, 'command.bound', { clientCommandId, nativeTurnId: clientCommandId }, clientCommandId, clientCommandId))
    const completed = this.runTurn(session, request, events).finally(() => unsubscribe())
    const running = completed.finally(() => { if (session.running === running) session.running = null })
    // `running` is only an owner-state sentinel; callers await `completed`.
    // Mirror its rejection as handled so invalid local capability input does
    // not become an unhandled promise rejection after the caller receives it.
    void running.catch(() => undefined)
    session.running = running
    return { clientCommandId, started, completed }
  }

  async interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }> {
    const session = this.require(conversation)
    const turnId = session.activeTurnId
    let cancelDelivered = false
    try {
      // Cancellation is a notification in ACP. Bound the write as a final
      // guard for providers whose transport itself is already wedged.
      cancelDelivered = await settlesWithin(this.acp.cancel(session.acp), CANCEL_NOTIFICATION_TIMEOUT_MS)
    } catch {
      cancelDelivered = false
    }
    if (!turnId || !this.isBusy(session)) return { supported: true }

    const settled = cancelDelivered && await settlesWithin(this.whenIdle(session), CANCEL_SETTLEMENT_TIMEOUT_MS)
    if (!settled && session.activeTurnId === turnId) {
      this.forceInterrupt(session, turnId, cancelDelivered ? 'cancel_timeout' : 'cancel_transport_unavailable')
    }
    return { supported: true }
  }
  releaseConversation(conversation: ConversationHandle): void {
    const session = this.sessions.get(conversation.id)
    if (!session) return
    this.sessions.delete(conversation.id)
    void this.closeSession(session)
  }
  async respondApproval(conversation: ConversationHandle, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const session = this.require(conversation)
    const pending = session.approvals.get(approvalId)
    if (!pending) throw new Error('待处理的 Trae 授权请求不存在')
    const selected = pending.options.find(option => outcome === 'allowed-once' ? option.kind === 'allow_once' : option.kind.startsWith('reject'))
    // The native request will resume asynchronously after this call. Resolve
    // CodyWork's pending state first, otherwise the browser continues to show
    // the same approval card and lets the user click its decision repeatedly.
    session.approvals.delete(approvalId)
    this.emit(session, runtimeEvent(session, 'approval.resolved', {
      approvalId,
      outcome,
      nativeOutcome: selected ? 'selected' : 'cancelled',
      ...(selected ? { optionId: selected.optionId } : {}),
    }, session.activeTurnId))
    pending.resolve(selected?.optionId ?? null)
  }
  async respondQuestion(_conversation: ConversationHandle, _requestId: string, _answer: unknown): Promise<void> { throw new Error('当前 Trae ACP 未提供 CodyWork 问答映射') }
  async close(): Promise<void> { await Promise.all([...this.sessions.values()].map(session => this.closeSession(session))); this.sessions.clear() }

  private async startSession(id: string, context: RuntimeContext, nativeId?: string): Promise<ConversationHandle> {
    const cwd = executionCwd(context)
    const acp = await this.acp.open({ bindingId: id, cwd, ...(nativeId ? { sessionId: nativeId } : {}) })
    const handle = { id, nativeId: acp.sessionId, createdAt: nowIso() }
    const session: ProductSession = { handle, context, mode: this.modeFromContext(context), acp, listeners: new Set(), events: [], watermark: 0, approvals: new Map(), running: null, appendRuns: new Set(), forcedInterruptedTurns: new Set(), forcedInterruptionResolvers: new Map(), closed: false }
    this.sessions.set(id, session)
    this.acp.subscribe(acp, update => this.onUpdate(session, update))
    this.acp.setPermissionHandler(acp, request => this.requestPermission(session, request.options, request.toolCall))
    return handle
  }

  private async createEphemeralSession(context: RuntimeContext): Promise<ProductSession> {
    const handle = await this.createConversation({ conversationId: `composer-options-${randomUUID()}`, context })
    return this.require(handle)
  }
  /**
   * ACP has no separate "steer" method, but its prompt request is independent
   * and can be delivered while a session is active. Keep this product policy
   * distinct from steering: it is a supplemental instruction, not a mutation
   * of the task's current Turn. If an ACP implementation rejects the extra
   * request (for example with a busy error), preserve the message by visibly
   * moving it back to the normal queue.
   */
  private submitAppend(session: ProductSession, request: SendTurnRequest): SubmitTurnResult {
    const clientCommandId = request.clientCommandId ?? randomUUID()
    const activeTurnId = session.activeTurnId!
    // Applying model/mode/skill settings while an ACP request is in flight is
    // provider-dependent. Queue those commands so their requested semantics
    // are not silently discarded.
    if (request.localImages?.length || request.settings?.model?.trim() || request.settings?.reasoningEffort || request.settings?.collaborationMode || request.settings?.skills?.length) {
      return this.submitTurn({ ...request, mode: 'queue', clientCommandId })
    }
    const events: RuntimeEvent[] = []
    const unsubscribe = this.listen(session, event => { events.push(event); request.onEvent?.(event) })
    this.emit(session, runtimeEvent(session, 'command.queued', { clientCommandId, text: request.prompt }, undefined, clientCommandId))
    const started = Promise.resolve({ threadId: session.handle.nativeId, turnId: activeTurnId })
    let append!: Promise<SendTurnResult>
    const completed = (async () => {
      try {
        // Calling prompt starts the ACP JSON-RPC request synchronously. The
        // response remains asynchronous, while the user-visible event records
        // that the supplemental instruction has been handed to the active ACP
        // task rather than held behind the product queue.
        const prompt = this.acp.prompt(session.acp, [{ type: 'text', text: request.prompt }])
        this.emit(session, runtimeEvent(session, 'command.appended', { clientCommandId, delivery: 'acp_prompt' }, activeTurnId, clientCommandId))
        await prompt
        return { conversation: session.handle, finalText: this.finalText(events), events: [...events] }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        this.emit(session, runtimeEvent(session, 'command.requeued', {
          clientCommandId,
          reason: `Trae 暂未接受追加，已转入队列：${reason}`,
        }, undefined, clientCommandId))
        // Preserve command identity: browser/channel retry and durable outbox
        // reconciliation must still see this as one user message.
        // Remove this failed append before entering the queue barrier; otherwise
        // the queued retry would wait for its own promise forever.
        session.appendRuns.delete(append)
        return this.sendTurn({ ...request, mode: 'queue', clientCommandId })
      } finally {
        unsubscribe()
      }
    })()
    append = completed.finally(() => { session.appendRuns.delete(append) })
    session.appendRuns.add(append)
    void append.catch(() => undefined)
    return { clientCommandId, started, completed: append }
  }
  private isBusy(session: ProductSession): boolean { return Boolean(session.running) || session.appendRuns.size > 0 }
  private async whenIdle(session: ProductSession): Promise<void> {
    // A just-completed main prompt can still have an accepted supplemental
    // prompt. Drain until the set stabilizes before starting the next queued
    // command, so no follow-up is lost or reordered.
    while (session.running || session.appendRuns.size) {
      await Promise.allSettled([...(session.running ? [session.running] : []), ...session.appendRuns])
    }
  }
  private async runTurn(session: ProductSession, request: SendTurnRequest, events: RuntimeEvent[]): Promise<SendTurnResult> {
    const turnId = request.clientCommandId ?? randomUUID()
    let started = false
    session.activeTurnId = turnId
    try {
      if (request.localImages?.length && !supportsImage(session)) throw new Error('当前 Trae ACP 未声明图片 Prompt 能力')
      if (request.settings?.skills?.length) throw new Error('当前 Trae ACP 未提供结构化 Skill 输入能力')
      if (request.settings?.reasoningEffort) throw new Error('当前 Trae ACP 未提供推理程度配置')
      if (request.settings?.collaborationMode === 'plan') throw new Error('当前 Trae ACP 未提供 Plan 模式配置')
      if (request.mode === 'steer') throw new Error('当前 Trae ACP 未提供引导当前 Turn 的能力；请使用“追加到当前任务”')
      if (request.settings?.model?.trim()) await this.setModel(session, request.settings.model.trim())
      const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [{ type: 'text', text: this.promptWithInstructions(session.context, request.prompt) }]
      for (const image of request.localImages ?? []) blocks.push({ type: 'image', data: readFileSync(image.path).toString('base64'), mimeType: image.path.endsWith('.png') ? 'image/png' : 'image/jpeg' })
      this.emit(session, runtimeEvent(session, 'turn.started', {}, turnId))
      this.emit(session, runtimeEvent(session, 'turn.activity', { label: '正在准备 Trae 请求…', details: ['已建立 ACP 会话', '正在提交提示词'] }, turnId))
      this.emit(session, runtimeEvent(session, 'user.completed', { text: request.prompt }, turnId, turnId))
      started = true
      const interrupted = new Promise<{ kind: 'interrupted' }>(resolve => {
        session.forcedInterruptionResolvers.set(turnId, () => resolve({ kind: 'interrupted' }))
      })
      const prompt = this.acp.prompt(session.acp, blocks).then(response => ({ kind: 'response' as const, response }))
      const outcome = await Promise.race([prompt, interrupted])
      const finalText = this.finalText(events)
      if (outcome.kind === 'interrupted') return { conversation: session.handle, finalText, events: [...events] }
      if (!session.forcedInterruptedTurns.has(turnId)) {
        // ACP streams agent_message_chunk as deltas only. Emit the normalized
        // terminal item as well so projections that intentionally render the
        // final assistant response (for example Feishu cards) do not need to
        // understand each provider's streaming wire format.
        if (finalText) this.emit(session, runtimeEvent(session, 'assistant.completed', { text: finalText }, turnId, `assistant:${turnId}`))
        this.emit(session, runtimeEvent(session, outcome.response.stopReason === 'cancelled' ? 'turn.interrupted' : 'turn.completed', { stopReason: outcome.response.stopReason }, turnId))
      }
      return { conversation: session.handle, finalText, events: [...events] }
    } catch (error) {
      // A forced transport teardown is already represented by a single
      // turn.interrupted event. Do not reopen the same Turn as failed when
      // the in-flight prompt rejects after its connection is closed.
      if (session.forcedInterruptedTurns.has(turnId)) {
        return { conversation: session.handle, finalText: this.finalText(events), events: [...events] }
      }
      const message = error instanceof Error ? error.message : String(error)
      // A setup failure happens before there is a native user item. Surface a
      // command failure first so the browser turns its optimistic queued row
      // into a retryable failure instead of leaving it permanently queued.
      if (!started) this.emit(session, runtimeEvent(session, 'command.failed', { error: message }, turnId, turnId))
      this.emit(session, runtimeEvent(session, 'turn.failed', { error: message }, turnId))
      throw error
    } finally {
      session.forcedInterruptionResolvers.delete(turnId)
      if (session.activeTurnId === turnId) session.activeTurnId = undefined
    }
  }
  /** Product policy over Core's ACP permission transport. Core routes the
   * native request exactly once; CodyWork decides its approval experience. */
  private async requestPermission(session: ProductSession, options: AcpPermissionOption[], toolCall: unknown): Promise<string | null> {
    if (session.mode === 'yolo') return options.find(option => option.kind === 'allow_once' || option.kind === 'allow_always')?.optionId ?? null
    if (session.mode === 'read-only') return options.find(option => option.kind === 'reject_once' || option.kind === 'reject_always')?.optionId ?? null
    const approvalId = randomUUID()
    const selection = new Promise<string | null>(resolve => session.approvals.set(approvalId, { options, resolve }))
    this.emit(session, runtimeEvent(session, 'approval.requested', { approvalId, toolCall, options }, session.activeTurnId))
    const optionId = await selection
    // `respondApproval` removes the item before waking the Core request broker;
    // retain cleanup for cancellation and process-close paths.
    session.approvals.delete(approvalId)
    return optionId
  }
  private async closeSession(session: ProductSession): Promise<void> {
    if (session.closed) return
    session.closed = true
    for (const approval of session.approvals.values()) approval.resolve(null)
    session.approvals.clear()
    await this.acp.close(session.acp)
  }
  private onUpdate(session: ProductSession, update: AcpSessionUpdate): void {
    const text = textContent(update)
    const turnId = session.activeTurnId
    if (turnId && session.forcedInterruptedTurns.has(turnId)) return
    if (update.sessionUpdate === 'agent_message_chunk') {
      this.emit(session, runtimeEvent(session, 'turn.activity', { label: 'Trae 正在生成回复…', details: ['正在接收模型输出'] }, turnId))
      this.emit(session, runtimeEvent(session, 'assistant.delta', { text }, turnId, turnId ? `assistant:${turnId}` : undefined))
    } else if (update.sessionUpdate === 'user_message_chunk') this.emit(session, runtimeEvent(session, 'user.completed', { text }, turnId, turnId))
    else if (update.sessionUpdate === 'agent_thought_chunk') this.emit(session, runtimeEvent(session, 'reasoning.delta', { text }, turnId, turnId ? `reasoning:${turnId}` : undefined))
    else if (update.sessionUpdate === 'tool_call') this.emit(session, runtimeEvent(session, 'tool.started', { ...update }, turnId))
    else if (update.sessionUpdate === 'tool_call_update') this.emit(session, runtimeEvent(session, update.status === 'completed' ? 'tool.completed' : 'tool.updated', { ...update }, turnId))
  }
  private emit(session: ProductSession, event: RuntimeEvent): void { session.events.push(event); session.watermark++; for (const listener of session.listeners) listener(event) }
  private forceInterrupt(session: ProductSession, turnId: string, cause: 'cancel_timeout' | 'cancel_transport_unavailable'): void {
    if (session.forcedInterruptedTurns.has(turnId)) return
    session.forcedInterruptedTurns.add(turnId)
    session.forcedInterruptionResolvers.get(turnId)?.()
    for (const approval of session.approvals.values()) approval.resolve(null)
    session.approvals.clear()
    this.emit(session, runtimeEvent(session, 'turn.interrupted', { stopReason: 'cancelled', cause }, turnId))
    // One ACP process owns one session. Once it has ignored cancellation,
    // preserving the process would keep the conversation stuck indefinitely.
    this.sessions.delete(session.handle.id)
    session.closed = true
    this.acp.terminate(session.acp)
  }
  private listen(session: ProductSession, listener: (event: RuntimeEvent) => void): () => void { session.listeners.add(listener); return () => session.listeners.delete(listener) }
  private finalText(events: RuntimeEvent[]): string { return events.filter(event => event.type === 'assistant.delta').map(event => String(event.data.text ?? '')).join('') }
  private promptWithInstructions(context: RuntimeContext, prompt: string): string { return context.instructionBundle.systemInstructions ? `${context.instructionBundle.systemInstructions}\n\n---\n\n${prompt}` : prompt }
  private require(conversation: ConversationHandle): ProductSession { const session = this.sessions.get(conversation.id); if (!session || session.handle.nativeId !== conversation.nativeId || session.closed) throw new Error('Trae conversation runtime is not available'); return session }
  private requireById(id: string): ProductSession { const session = this.sessions.get(id); if (!session) throw new Error('Trae conversation runtime is not available'); return session }
  private modeFromContext(context: RuntimeContext): RuntimePermissionMode { return context.effectivePolicy.approval === 'none' ? 'yolo' : context.effectivePolicy.writableRoots.length ? 'workspace-write' : 'read-only' }
  private models(options: AcpSessionConfigOption[]): RuntimeComposerOptions['models'] {
    const model = options.find(option => option.id === 'model' || option.category === 'model')
    if (!model || !isSelectOption(model)) return []
    const values = model.options.flatMap(entry => 'options' in entry ? entry.options : [entry])
    return values.map(value => {
      const metadata = this.modelMetadata(value._meta)
      return {
        id: value.value,
        label: value.name,
        description: value.description ?? '',
        ...(metadata ? { metadata } : {}),
        isDefault: value.value === model.currentValue,
        defaultReasoningEffort: 'none' as ReasoningEffort,
        supportedReasoningEfforts: [] as ReasoningEffort[],
      }
    })
  }
  private modelMetadata(meta: unknown): RuntimeComposerOptions['models'][number]['metadata'] {
    if (!isRecord(meta) || !isRecord(meta.trae)) return undefined
    const trae = meta.trae
    const contextWindow = finiteNumber(trae.contextWindow)
    const maxContextWindow = finiteNumber(trae.maxContextWindow)
    const load = isRecord(trae.load) ? finiteNumber(trae.load.percent) : undefined
    const supportsMaxMode = typeof trae.supportsMaxMode === 'boolean' ? trae.supportsMaxMode : undefined
    const rawQuota = isRecord(trae.weeklyQuota) ? trae.weeklyQuota : undefined
    const weeklyQuota = rawQuota && typeof rawQuota.applies === 'boolean' && typeof rawQuota.isDepleted === 'boolean'
      ? {
          applies: rawQuota.applies,
          isDepleted: rawQuota.isDepleted,
          ...(finiteNumber(rawQuota.usedPercent) !== undefined ? { usedPercent: finiteNumber(rawQuota.usedPercent) } : {}),
          ...(finiteNumber(rawQuota.remainingPercent) !== undefined ? { remainingPercent: finiteNumber(rawQuota.remainingPercent) } : {}),
          ...(finiteNumber(rawQuota.resetTime) !== undefined ? { resetTime: finiteNumber(rawQuota.resetTime) } : {}),
        }
      : undefined
    if (contextWindow === undefined && maxContextWindow === undefined && load === undefined && supportsMaxMode === undefined && !weeklyQuota) return undefined
    return {
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxContextWindow !== undefined ? { maxContextWindow } : {}),
      ...(supportsMaxMode !== undefined ? { supportsMaxMode } : {}),
      ...(load !== undefined ? { loadPercent: load } : {}),
      ...(weeklyQuota ? { weeklyQuota } : {}),
    }
  }
  private modes(session: ProductSession): RuntimeComposerOptions['collaborationModes'] {
    return session.acp.configOptions.filter(isSelectOption).filter(option => option.category === 'mode').flatMap(option => option.options.flatMap(entry => 'options' in entry ? entry.options : [entry]).map(value => ({ name: value.value, mode: value.value === 'plan' ? 'plan' as const : 'default' as const, label: value.name })))
  }
  private async setModel(session: ProductSession, model: string): Promise<void> {
    const option = session.acp.configOptions.find(value => value.id === 'model' || value.category === 'model')
    if (!option || !isSelectOption(option)) throw new Error('当前 Trae ACP 未提供模型选择配置')
    const values = option.options.flatMap(entry => 'options' in entry ? entry.options : [entry])
    // ACP's machine value is authoritative. Accepting the display name as a
    // fallback keeps a browser with a previously-cached picker compatible
    // when a provider changes model id casing or aliases between releases.
    const selected = values.find(value => value.value === model) ?? values.find(value => value.name === model)
    if (!selected) throw new Error(`当前 Trae ACP 不支持模型：${model}`)
    if (selected.value === option.currentValue) return
    await this.acp.setConfigOption(session.acp, option.id, selected.value)
  }
}
