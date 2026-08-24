import { randomUUID } from 'node:crypto'
import {
  createAppServerHost,
  type AppServerHost,
  type RuntimeNotification,
  type ServerRequest,
} from '@codycodeagent/cody-web-core/runtime'
import { asRecord, readItemId, readThreadId, readTurnId } from '@codycodeagent/cody-web-core/protocol'
import { nowIso } from '../db/index.js'
import type {
  ConversationHandle,
  ConversationRuntimeAdapter,
  CreateConversationRequest,
  ListNativeThreadsRequest,
  NativeThreadSummary,
  RuntimeContext,
  RuntimeEvent,
  RuntimeManifest,
  RuntimeComposerOptions,
  RuntimePermissionMode,
  ReasoningEffort,
  SendTurnRequest,
  SendTurnResult,
  WorkspaceCheckRequest,
  WorkspaceCheckResult,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResult,
} from './protocol.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION } from './protocol.js'
import { resolveEffectivePolicy, resolveInstructionBundle } from './policy.js'

type PendingApproval = { rpcId: number; conversationId: string; kind: 'approval' | 'question'; questions?: Array<{ id?: unknown }> }
type CodexOptions = { command?: string; model?: string; env?: NodeJS.ProcessEnv }
type TurnRun = {
  events: RuntimeEvent[]
  finalText: string
  completed: boolean
  failed: Error | null
  listener: ((event: RuntimeEvent) => void) | undefined
  resolve: (() => void) | undefined
  reject: ((error: Error) => void) | undefined
}
type CodexConversation = ConversationHandle & {
  context: RuntimeContext
  mode: RuntimePermissionMode
  planMode: boolean
  model: string
  reasoningEffort: ReasoningEffort | ''
  activeTurn: string | undefined
  approvals: Map<string, PendingApproval>
}

function workspaceCheck(path: string): WorkspaceCheckResult { return { status: 'ready', present: [path], missing: [], message: 'Codex App Server uses the CodyWork Workspace' } }
function threadModeOptions(context: RuntimeContext, mode: RuntimePermissionMode): Record<string, unknown> {
  return { cwd: context.demandPath ?? context.workspacePath, runtimeWorkspaceRoots: context.effectivePolicy.readableRoots, sandbox: mode === 'read-only' ? 'read-only' : 'workspace-write', approvalPolicy: mode === 'yolo' || mode === 'read-only' ? 'never' : 'on-request' }
}
function turnModeOptions(context: RuntimeContext, mode: RuntimePermissionMode, planMode: boolean, model: string, reasoningEffort: ReasoningEffort | ''): Record<string, unknown> {
  const sandboxPolicy = mode === 'read-only' ? { type: 'readOnly', networkAccess: false } : { type: 'workspaceWrite', writableRoots: context.effectivePolicy.writableRoots, networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
  return { cwd: context.demandPath ?? context.workspacePath, runtimeWorkspaceRoots: context.effectivePolicy.readableRoots, sandboxPolicy, approvalPolicy: mode === 'yolo' || mode === 'read-only' ? 'never' : 'on-request', ...(planMode ? { collaborationMode: { mode: 'plan', settings: { model, reasoning_effort: reasoningEffort || null, developer_instructions: null } } } : {}), ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) }
}
function itemType(item: unknown): string { return item && typeof item === 'object' ? String((item as { type?: unknown }).type ?? '') : '' }
function textFromItem(item: unknown): string { if (!item || typeof item !== 'object') return ''; const value = item as { text?: unknown; aggregatedOutput?: unknown }; return typeof value.text === 'string' ? value.text : typeof value.aggregatedOutput === 'string' ? value.aggregatedOutput : '' }
function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return new Date(value * 1000).toISOString()
}
function threadSummary(value: unknown): NativeThreadSummary | null {
  if (!value || typeof value !== 'object') return null
  const thread = value as Record<string, unknown>
  const nativeId = typeof thread.id === 'string' ? thread.id.trim() : ''
  if (!nativeId) return null
  return {
    nativeId,
    preview: typeof thread.preview === 'string' ? thread.preview.trim() : '',
    ...(typeof thread.cwd === 'string' && thread.cwd.trim() ? { cwd: thread.cwd.trim() } : {}),
    ...(toIsoTimestamp(thread.createdAt) ? { createdAt: toIsoTimestamp(thread.createdAt) } : {}),
    ...(toIsoTimestamp(thread.updatedAt) ? { updatedAt: toIsoTimestamp(thread.updatedAt) } : {}),
    ...(typeof thread.source === 'string' && thread.source ? { source: thread.source } : {}),
  }
}
function composerOptions(value: unknown): RuntimeComposerOptions {
  const record = asRecord(value) ?? {}
  const models = Array.isArray(record.data) ? record.data.flatMap(item => {
    const model = asRecord(item)
    const id = typeof model?.id === 'string' ? model.id.trim() : typeof model?.model === 'string' ? model.model.trim() : ''
    return id ? [id] : []
  }) : []
  return { models: [...new Set(models)], collaborationModes: [] }
}
function collaborationOptions(value: unknown): RuntimeComposerOptions['collaborationModes'] {
  const record = asRecord(value) ?? {}
  const data = Array.isArray(record.data) ? record.data : []
  return data.flatMap(item => {
    const mode = asRecord(item)
    const name = typeof mode?.name === 'string' ? mode.name.trim() : ''
    const kind = mode?.mode === 'plan' ? 'plan' : 'default'
    if (!name) return []
    const settings = asRecord(mode?.settings) ?? {}
    return [{ name, mode: kind, label: typeof mode?.label === 'string' && mode.label.trim() ? mode.label.trim() : name, ...(typeof settings.model === 'string' && settings.model.trim() ? { model: settings.model.trim() } : {}), ...(typeof settings.reasoning_effort === 'string' ? { reasoningEffort: settings.reasoning_effort as ReasoningEffort } : {}) }]
  })
}

/** A single service-level Codex App Server, with every thread bound to its own demand worktree policy. */
export class CodexRuntimeAdapter implements ConversationRuntimeAdapter {
  readonly provider = 'codex'
  private readonly sessions = new Map<string, CodexConversation>()
  private readonly sessionsByThread = new Map<string, CodexConversation>()
  private readonly runs = new Map<string, TurnRun>()
  private host: AppServerHost | null = null
  private unlisten: (() => void) | null = null
  constructor(private readonly options: CodexOptions = {}) {}

  async checkConnection(cwd = process.cwd()): Promise<RuntimeManifest> {
    const host = createAppServerHost({
      command: this.command(), cwd,
      ...(this.options.env ? { env: this.options.env } : {}),
      initializeParams: this.initializeParams(),
    })
    try { await host.ensureInitialized(); return await this.getManifest() } finally { await host.dispose() }
  }
  async getManifest(): Promise<RuntimeManifest> {
    return {
      provider: this.provider, runtimeVersion: 'codex-app-server',
      protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION, streaming: true,
      resume: true, fork: false, interrupt: true, approvals: true, diffs: true,
      subagents: true, readPolicy: 'roots', writePolicy: 'roots',
      shellPolicy: 'allowlist', approval: 'runtime', workspaceInitialize: true,
      workspaceRepair: false, goals: true, plans: true, questions: true,
    }
  }
  async checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult> { return workspaceCheck(request.workspacePath) }
  async initializeWorkspace(request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult> {
    const context: RuntimeContext = { workspacePath: request.workspacePath, instructionBundle: resolveInstructionBundle({ workspacePath: request.workspacePath, platformInstructions: request.instruction }), effectivePolicy: resolveEffectivePolicy({ workspacePath: request.workspacePath, readableRoots: [request.workspacePath], writableRoots: [request.workspacePath], shell: 'allowlist', approval: 'none' }) }
    const conversation = await this.createConversation({ context })
    const result = await this.sendTurn({ conversation, prompt: request.instruction })
    return { status: 'initialized', message: result.finalText || 'Codex 已完成 Workspace 初始化。' }
  }
  async createConversation(request: CreateConversationRequest): Promise<ConversationHandle> {
    const host = await this.ensureHost(request.context); const mode = this.modeFromContext(request.context)
    const result = await host.call<{ thread?: { id?: string; model?: string } }>('thread/start', { model: this.options.model ?? null, ...threadModeOptions(request.context, mode), baseInstructions: request.context.instructionBundle.systemInstructions, developerInstructions: this.policyInstructions(request.context) })
    const nativeId = result.thread?.id; if (!nativeId) throw new Error('Codex App Server 没有返回 thread id')
    const handle = { id: request.conversationId ?? `conversation-${randomUUID()}`, provider: this.provider, nativeId, createdAt: nowIso() }
    this.attach({ ...handle, context: request.context, mode, planMode: false, model: this.options.model ?? result.thread?.model ?? 'gpt-5.4', reasoningEffort: '', activeTurn: undefined, approvals: new Map() })
    return handle
  }
  async resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle> {
    const host = await this.ensureHost(request.context); const mode = this.modeFromContext(request.context)
    await host.call('thread/resume', { threadId: request.nativeId, model: this.options.model ?? null, ...threadModeOptions(request.context, mode), baseInstructions: request.context.instructionBundle.systemInstructions, developerInstructions: this.policyInstructions(request.context) })
    const handle = { id: request.conversationId ?? `conversation-${randomUUID()}`, provider: this.provider, nativeId: request.nativeId, createdAt: nowIso() }
    this.attach({ ...handle, context: request.context, mode, planMode: false, model: this.options.model ?? 'gpt-5.4', reasoningEffort: '', activeTurn: undefined, approvals: new Map() }); return handle
  }
  async listNativeThreads(request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]> {
    const host = await this.ensureHost(request.context)
    const summaries: NativeThreadSummary[] = []
    let cursor: string | null = null
    // The App Server has opaque cursors. Bound the picker to a useful recent window
    // so a large local session archive cannot monopolize the server process.
    for (let page = 0; page < 10; page += 1) {
      const result: { data?: unknown; nextCursor?: unknown } = await host.call('thread/list', {
        archived: false,
        limit: 100,
        sortKey: 'updated_at',
        ...(cursor ? { cursor } : {}),
      })
      const data = Array.isArray(result.data) ? result.data : []
      for (const item of data) {
        const summary = threadSummary(item)
        if (summary) summaries.push(summary)
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null
      if (!cursor) break
    }
    return summaries
  }
  async getComposerOptions(context: RuntimeContext): Promise<RuntimeComposerOptions> {
    const host = await this.ensureHost(context)
    const [modelsResult, modesResult] = await Promise.allSettled([
      host.call('model/list', {}),
      host.call('collaborationMode/list', {}),
    ])
    const models = modelsResult.status === 'fulfilled' ? composerOptions(modelsResult.value).models : []
    const collaborationModes = modesResult.status === 'fulfilled' ? collaborationOptions(modesResult.value) : []
    return { models, collaborationModes }
  }
  async setPermission(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void> {
    const session = this.require(conversation); session.mode = mode
    await this.requireHost().call('thread/settings/update', { threadId: session.nativeId, cwd: session.context.demandPath ?? session.context.workspacePath, approvalPolicy: mode === 'yolo' || mode === 'read-only' ? 'never' : 'on-request', sandboxPolicy: mode === 'read-only' ? { type: 'readOnly', networkAccess: false } : { type: 'workspaceWrite', writableRoots: session.context.effectivePolicy.writableRoots, networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } })
  }
  async sendCommand(request: SendTurnRequest): Promise<SendTurnResult> {
    const session = this.require(request.conversation); const host = this.requireHost()
    if (request.prompt.startsWith('/plan')) {
      if (request.prompt === '/plan' || request.prompt === '/plan on') session.planMode = !session.planMode
      else if (request.prompt === '/plan off' || request.prompt === '/plan reject') session.planMode = false
      await host.call('thread/settings/update', { threadId: session.nativeId, collaborationMode: { mode: session.planMode ? 'plan' : 'default', settings: { model: session.model, reasoning_effort: session.reasoningEffort || null, developer_instructions: null } } })
      return { conversation: request.conversation, finalText: '', events: [] }
    }
    const value = request.prompt.replace(/^\/goal\s*/i, '').trim()
    if (request.prompt.startsWith('/goal')) {
      if (!value || value === 'clear' || value === '清除') await host.call('thread/goal/clear', { threadId: session.nativeId })
      else { const statusMap: Record<string, string> = { pause: 'paused', 暂停: 'paused', resume: 'active', 恢复: 'active', complete: 'complete', 完成: 'complete' }; const status = statusMap[value]; if (status) { const current = await host.call<{ goal?: { objective?: string } }>('thread/goal/get', { threadId: session.nativeId }); await host.call('thread/goal/set', { threadId: session.nativeId, objective: current.goal?.objective ?? '', status }) } else await host.call('thread/goal/set', { threadId: session.nativeId, objective: value, status: 'active' }) }
    }
    return { conversation: request.conversation, finalText: '', events: [] }
  }
  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> {
    const session = this.require(request.conversation); if (session.activeTurn && request.mode !== 'steer') throw new Error('该会话已有运行中的 Turn；请排队或先中断。')
    if (request.settings?.model?.trim()) session.model = request.settings.model.trim()
    if (request.settings?.reasoningEffort) session.reasoningEffort = request.settings.reasoningEffort
    const steer = request.mode === 'steer' && Boolean(session.activeTurn)
    const result = await this.requireHost().call<{ turn?: { id?: string } }>(steer ? 'turn/steer' : 'turn/start', steer ? { threadId: session.nativeId, expectedTurnId: session.activeTurn, input: [{ type: 'text', text: request.prompt, text_elements: [] }] } : { threadId: session.nativeId, input: [{ type: 'text', text: request.prompt, text_elements: [] }], ...turnModeOptions(session.context, session.mode, session.planMode, session.model, session.reasoningEffort) })
    const turnId = result.turn?.id ?? `turn-${randomUUID()}`; session.activeTurn = turnId
    const run = this.runs.get(turnId) ?? { events: [], finalText: '', completed: false, failed: null, listener: undefined, resolve: undefined, reject: undefined }; this.runs.set(turnId, run); if (request.onEvent) run.listener = request.onEvent; for (const event of run.events) request.onEvent?.(event)
    if (!run.completed && !run.failed) await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Codex turn 超时')), 10 * 60 * 1000); run.resolve = () => { clearTimeout(timer); resolve() }; run.reject = (error) => { clearTimeout(timer); reject(error) } })
    this.runs.delete(turnId)
    if (run.failed) throw run.failed
    return { conversation: request.conversation, finalText: run.finalText, events: run.events }
  }
  async interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }> {
    const session = this.require(conversation)
    if (!session.activeTurn) return { supported: false }
    await this.requireHost().call('turn/interrupt', {
      threadId: session.nativeId, turnId: session.activeTurn,
    })
    return { supported: true }
  }
  async respondApproval(conversation: ConversationHandle, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> { const session = this.require(conversation); const pending = session.approvals.get(approvalId); if (!pending || pending.kind !== 'approval') throw new Error('Codex approval 不存在或已失效'); await this.requireHost().resolveServerRequest(pending.rpcId, { result: { decision: outcome === 'allowed-once' ? 'approved' : { denied: { rejection: 'CodyWork 用户拒绝了本次操作' } } } }); session.approvals.delete(approvalId) }
  async respondQuestion(conversation: ConversationHandle, requestId: string, answer: unknown): Promise<void> { const session = this.require(conversation); const pending = session.approvals.get(requestId); if (!pending || pending.kind !== 'question') throw new Error('Codex question 不存在或已失效'); const questionId = pending.questions?.[0]?.id; const key = typeof questionId === 'string' && questionId ? questionId : 'answer'; await this.requireHost().resolveServerRequest(pending.rpcId, { result: { answers: { [key]: { answers: [String(answer ?? '')] } } } }); session.approvals.delete(requestId) }
  async close(): Promise<void> {
    this.unlisten?.()
    this.unlisten = null
    this.sessions.clear()
    this.sessionsByThread.clear()
    await this.host?.dispose()
    this.host = null
  }

  private async ensureHost(context: RuntimeContext): Promise<AppServerHost> {
    if (!this.host) {
      this.host = createAppServerHost({
        command: this.command(), cwd: context.demandPath ?? context.workspacePath,
        ...(this.options.env ? { env: this.options.env } : {}),
        initializeParams: this.initializeParams(),
        onDisconnected: reason => this.handleDisconnect(reason),
      })
      this.unlisten = this.host.subscribe(notification => this.handleNotification(notification))
    }
    await this.host.ensureInitialized()
    return this.host
  }
  private requireHost(): AppServerHost { if (!this.host) throw new Error('Codex App Server 尚未初始化'); return this.host }
  private command(): string { return this.options.command?.trim() || 'codex app-server --stdio' }
  private initializeParams(): Record<string, unknown> { return { clientInfo: { name: 'codywork', title: 'CodyWork', version: '0.2.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } }
  private attach(session: CodexConversation): void {
    this.sessions.set(session.id, session)
    this.sessionsByThread.set(session.nativeId, session)
  }
  private require(conversation: ConversationHandle): CodexConversation { const session = this.sessions.get(conversation.id); if (!session) throw new Error('Codex conversation runtime is not available'); return session }
  private modeFromContext(context: RuntimeContext): RuntimePermissionMode { return context.effectivePolicy.approval === 'none' ? 'yolo' : context.effectivePolicy.writableRoots.length ? 'workspace-write' : 'read-only' }
  private policyInstructions(context: RuntimeContext): string { return `Effective CodyWork policy. Readable roots: ${context.effectivePolicy.readableRoots.join(', ')}. Writable roots: ${context.effectivePolicy.writableRoots.join(', ')}. Do not access or modify paths outside these roots.` }
  private sessionFor(params: unknown): CodexConversation | undefined {
    const direct = this.sessionsByThread.get(readThreadId(params))
    if (direct) return direct
    const active = [...this.sessions.values()].filter(session => Boolean(session.activeTurn))
    return active.length === 1 ? active[0] : undefined
  }
  private runFor(turnId: string): TurnRun { const run = this.runs.get(turnId); if (run) return run; const created: TurnRun = { events: [], finalText: '', completed: false, failed: null, listener: undefined, resolve: undefined, reject: undefined }; this.runs.set(turnId, created); return created }
  private emit(session: CodexConversation, turnId: string, type: RuntimeEvent['type'], data: Record<string, unknown>, itemId?: string): void { const event: RuntimeEvent = { id: randomUUID(), type, conversationId: session.id, turnId, ...(itemId ? { itemId } : {}), provider: this.provider, timestamp: nowIso(), data }; const run = this.runFor(turnId); run.events.push(event); if (type === 'message.delta') run.finalText += String(data.text ?? ''); run.listener?.(event) }
  private handleServerRequest(request: ServerRequest): void { const outer = asRecord(request.params); const params = outer?.params ?? request.params; const session = this.sessionFor(params); if (!session) return; const turnId = readTurnId(params) || session.activeTurn || `turn-${randomUUID()}`; if (this.isApprovalRequest(request.method)) { const approvalId = String(asRecord(params)?.approvalId ?? request.id); session.approvals.set(approvalId, { rpcId: request.id, conversationId: session.id, kind: 'approval' }); this.emit(session, turnId, 'approval.requested', { approvalId, requestId: request.id, reason: asRecord(params)?.reason ?? 'Codex 请求执行受保护操作。', method: request.method, params }) } else if (request.method === 'item/tool/requestUserInput') { const questions = Array.isArray(asRecord(params)?.questions) ? asRecord(params)?.questions as Array<{ id?: unknown }> : []; session.approvals.set(String(request.id), { rpcId: request.id, conversationId: session.id, kind: 'question', questions }); this.emit(session, turnId, 'question.requested', { requestId: String(request.id), questions, params }) } }
  private handleNotification(notification: RuntimeNotification): void {
    if (notification.method === 'server/request') { const request = notification.params as ServerRequest; if (typeof request?.id === 'number') this.handleServerRequest(request); return }
    const session = this.sessionFor(notification.params); if (!session) return; const params = asRecord(notification.params) ?? {}; const turnId = readTurnId(params) || session.activeTurn || `turn-${randomUUID()}`; const itemId = readItemId(params)
    if (notification.method === 'turn/started') { session.activeTurn = turnId; this.emit(session, turnId, 'turn.started', params); return }
    if (notification.method === 'turn/completed') { this.emit(session, turnId, 'turn.completed', params); session.activeTurn = undefined; const run = this.runFor(turnId); run.completed = true; run.resolve?.(); return }
    if (notification.method === 'item/agentMessage/delta') { this.emit(session, turnId, 'message.delta', { text: String(params.delta ?? ''), nativeEvent: params }, itemId); return }
    if (notification.method === 'item/reasoning/summaryTextDelta' || notification.method === 'item/reasoning/textDelta') { this.emit(session, turnId, 'reasoning.delta', { text: String(params.delta ?? ''), nativeEvent: params }, itemId); return }
    if (notification.method === 'item/plan/delta') { this.emit(session, turnId, 'plan.updated', { text: String(params.delta ?? ''), nativeEvent: params }, itemId); return }
    if (notification.method === 'turn/plan/updated') { this.emit(session, turnId, 'plan.updated', params, itemId); return }
    if (notification.method === 'turn/diff/updated' || notification.method === 'item/fileChange/patchUpdated') { this.emit(session, turnId, 'diff.updated', params, itemId); return }
    if (notification.method === 'item/commandExecution/outputDelta' || notification.method === 'command/exec/outputDelta' || notification.method === 'process/outputDelta') { this.emit(session, turnId, 'tool.completed', { output: String(params.delta ?? ''), nativeEvent: params }, itemId); return }
    if (notification.method === 'item/fileChange/outputDelta') { this.emit(session, turnId, 'file.changed', { text: String(params.delta ?? ''), nativeEvent: params }, itemId); return }
    if (notification.method === 'item/started' || notification.method === 'item/completed') { this.itemEvent(session, turnId, notification.method.endsWith('started') ? 'started' : 'completed', params.item, params); return }
    if (notification.method === 'thread/goal/updated') { this.emit(session, turnId, 'goal.updated', asRecord(params.goal) ?? params); return }
    if (notification.method === 'thread/goal/cleared') { this.emit(session, turnId, 'goal.updated', { status: 'cleared' }); return }
    if (notification.method === 'error') { this.emit(session, turnId, 'turn.failed', { error: params.error ?? params }); session.activeTurn = undefined; const run = this.runFor(turnId); run.failed = new Error(String(params.error ?? 'Codex Runtime error')); run.reject?.(run.failed) }
  }
  private itemEvent(session: CodexConversation, turnId: string, phase: 'started' | 'completed', item: unknown, params: Record<string, unknown>): void { const type = itemType(item); const id = item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : ''; const data = { item, nativeEvent: params }; if (type === 'agentMessage') { const text = textFromItem(item); if (text) this.emit(session, turnId, 'message.completed', { text, ...data }, id); return }; if (type === 'fileChange') { this.emit(session, turnId, phase === 'completed' ? 'diff.updated' : 'file.changed', data, id); return }; if (type === 'commandExecution' || type === 'mcpToolCall' || type === 'dynamicToolCall' || type === 'collabAgentToolCall') { this.emit(session, turnId, phase === 'completed' ? 'tool.completed' : 'tool.started', data, id); return }; if (type === 'plan') { this.emit(session, turnId, 'plan.updated', data, id); return }; if (type === 'reasoning') { const text = textFromItem(item); if (text) this.emit(session, turnId, 'reasoning.delta', { text, ...data }, id) } }
  private isApprovalRequest(method: string): boolean { return method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval' || method === 'execCommandApproval' || method === 'item/permissions/requestApproval' }
  private handleDisconnect(reason: Error): void {
    // A host exit invalidates every App Server-side thread attachment. Keeping
    // these objects around would let the next turn start a fresh process without
    // initialize/thread-resume, which looks like a successfully accepted message
    // that never receives a response.
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    this.sessionsByThread.clear()
    this.unlisten?.()
    this.unlisten = null
    this.host = null

    for (const session of sessions) {
      const turnId = session.activeTurn ?? `turn-${randomUUID()}`
      this.emit(session, turnId, 'runtime.disconnected', { error: reason.message })
      const run = this.runs.get(turnId)
      if (run) {
        run.failed = reason
        run.reject?.(reason)
      }
      session.activeTurn = undefined
    }
  }
}
