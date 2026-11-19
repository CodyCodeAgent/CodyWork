import { randomUUID } from 'node:crypto'
import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import {
  AcpSessionHost,
  splitAcpCommand,
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

export const DEFAULT_ANTIGRAVITY_CLI_COMMAND = 'agy acp'
export const DEFAULT_GEMINI_CLI_COMMAND = DEFAULT_ANTIGRAVITY_CLI_COMMAND

export type GeminiOptions = {
  command?: string
  env?: NodeJS.ProcessEnv
}

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
  running: Promise<unknown> | null
  appendRuns: Set<Promise<unknown>>
  activeTurnId?: string
  forcedInterruptedTurns: Set<string>
  forcedInterruptionResolvers: Map<string, () => void>
  closed: boolean
}

const CANCEL_NOTIFICATION_TIMEOUT_MS = 750
const CANCEL_SETTLEMENT_TIMEOUT_MS = 1_500
const GEMINI_AUTH_FAILURE = /(?:api[_ -]?key|unauthenticated|unauthorized|login required|401|403|permission_denied)/i
const GEMINI_NETWORK_FAILURE = /(?:econnrefused|enotfound|etimedout|fetch failed|network|socket hang up|error sending request)/i
const GEMINI_NOT_FOUND = /(?:enoent|not found|command not found)/i

export function presentGeminiFailure(error: unknown): { message: string; code?: string } {
  const original = error instanceof Error ? error.message : String(error)
  if (GEMINI_NOT_FOUND.test(original)) {
    return {
      message: '未找到 Antigravity CLI 可执行文件（agy），请先安装 Antigravity CLI 或在 Runtime 设置中配置 agy acp 命令路径。',
      code: 'gemini_cli_not_found',
    }
  }
  if (GEMINI_AUTH_FAILURE.test(original)) {
    return {
      message: 'Antigravity CLI 鉴权失败，请先在终端运行 agy（或 agy acp --login）完成 Google 登录，或配置 GEMINI_API_KEY 后重试。',
      code: 'gemini_auth_failed',
    }
  }
  if (GEMINI_NETWORK_FAILURE.test(original)) {
    return {
      message: 'Antigravity CLI 网络连接失败，请检查代理配置（.runtime/codywork.network.env）后重试。',
      code: 'gemini_network_failed',
    }
  }
  return { message: original }
}

function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    void promise.then(
      () => { clearTimeout(timer); resolve(true) },
      () => { clearTimeout(timer); resolve(true) },
    )
  })
}

function executionCwd(context: RuntimeContext): string {
  return realpathSync.native(context.demandPath ?? context.workspacePath)
}

function runtimeEvent(
  session: ProductSession,
  type: RuntimeEvent['type'],
  data: Record<string, unknown> = {},
  turnId?: string,
  itemId?: string,
): RuntimeEvent {
  const atIso = nowIso()
  return {
    id: randomUUID(),
    type,
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

function isSelectOption(option: AcpSessionConfigOption): option is Extract<AcpSessionConfigOption, { type: 'select' }> {
  return option.type === 'select'
}

function supportsImage(session: ProductSession): boolean {
  return AcpSessionHost.supportsImage(session.acp)
}

/**
 * Gemini CLI ACP runtime adapter.
 * Each attached CodyWork conversation owns an isolated `gemini --acp` process
 * via CodyWebCore's provider-neutral AcpSessionHost.
 */
function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function searchPathEntries(env: NodeJS.ProcessEnv): string[] {
  const entries = (env.PATH ?? globalThis.process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const home = env.HOME ?? globalThis.process.env.HOME
  if (home) {
    const localBin = join(home, '.local', 'bin')
    if (!entries.includes(localBin)) entries.push(localBin)
  }
  return entries
}

function commandExistsInEnv(rawCommand: string, env: NodeJS.ProcessEnv): boolean {
  const { command } = splitAcpCommand(rawCommand)
  if (isAbsolute(command) || command.includes('/')) return isExecutableFile(command)
  return searchPathEntries(env).some(dir => isExecutableFile(join(dir, command)))
}

export class CodyWorkGeminiRuntime implements CodyWorkRuntime {
  private readonly sessions = new Map<string, ProductSession>()
  private readonly acp: AcpSessionHost
  private readonly resolvedCommand: string
  private readonly resolvedEnv: NodeJS.ProcessEnv

  constructor(private readonly options: GeminiOptions = {}) {
    this.resolvedCommand = options.command?.trim()
      || globalThis.process.env.CODY_ANTIGRAVITY_COMMAND?.trim()
      || globalThis.process.env.CODY_GEMINI_COMMAND?.trim()
      || DEFAULT_ANTIGRAVITY_CLI_COMMAND
    const apiKey = options.env?.GEMINI_API_KEY
      ?? globalThis.process.env.CODY_GEMINI_API_KEY
      ?? globalThis.process.env.GEMINI_API_KEY
    const baseEnv: NodeJS.ProcessEnv = {
      ...globalThis.process.env,
      ...options.env,
      ...(apiKey ? { GEMINI_API_KEY: apiKey } : {}),
    }
    const enrichedPath = searchPathEntries(baseEnv).join(delimiter)
    this.resolvedEnv = { ...baseEnv, PATH: enrichedPath }
    this.acp = new AcpSessionHost({
      command: this.resolvedCommand,
      env: {
        ...options.env,
        PATH: enrichedPath,
        ...(apiKey ? { GEMINI_API_KEY: apiKey } : {}),
      },
      clientName: 'codywork',
    })
  }

  private assertCommandAvailable(): void {
    if (!commandExistsInEnv(this.resolvedCommand, this.resolvedEnv)) {
      throw new Error(presentGeminiFailure(new Error(`spawn ${this.resolvedCommand} ENOENT`)).message)
    }
  }

  async checkConnection(): Promise<CodexRuntimeInfo> {
    this.assertCommandAvailable()
    try {
      await this.acp.probe()
      return this.getInfo()
    } catch (error) {
      throw new Error(presentGeminiFailure(error).message)
    }
  }

  async getInfo(): Promise<CodexRuntimeInfo> {
    return { runtimeVersion: 'antigravity-cli-acp', protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION }
  }

  diagnostics() {
    return { runtime: 'gemini', activeSessions: this.acp.size }
  }

  async checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult> {
    const ok = existsSync(request.workspacePath)
    return {
      status: ok ? 'ready' : 'error',
      present: ok ? [request.workspacePath] : [],
      missing: ok ? [] : [request.workspacePath],
      message: ok ? 'Gemini CLI ACP 使用 CodyWork Workspace' : 'Workspace 不存在',
    }
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
      return { status: 'initialized', message: result.finalText || 'Gemini CLI 已完成 Workspace 初始化。' }
    } finally {
      this.releaseConversation(conversation)
    }
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
    // ACP v1 does not standardize remote session title mutation; keep title in CodyWork.
  }

  async readConversationSnapshot(request: ReadConversationRequest): Promise<RuntimeConversationSnapshot> {
    let session = this.sessions.get(request.conversationId)
    if (!session) await this.resumeConversation({ conversationId: request.conversationId, nativeId: request.nativeId, context: request.context })
    session = this.requireById(request.conversationId)
    if (session.handle.nativeId !== request.nativeId) throw new Error('会话绑定与请求的原生 Session 不一致')
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

  subscribeConversation(conversation: ConversationHandle, listener: (event: RuntimeEvent) => void): () => void {
    return this.listen(this.require(conversation), listener)
  }

  async listNativeThreads(request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]> {
    this.assertCommandAvailable()
    try {
      return (await this.acp.list(executionCwd(request.context)))
        .map(item => ({ nativeId: item.sessionId, preview: item.title ?? item.sessionId, ...(item.cwd ? { cwd: item.cwd } : {}) }))
    } catch (error) {
      throw new Error(presentGeminiFailure(error).message)
    }
  }

  async getComposerOptions(context: RuntimeContext): Promise<RuntimeComposerOptions> {
    const session = await this.createEphemeralSession(context)
    try {
      const models = this.models(session.acp.configOptions)
      return {
        provider: { type: 'gemini', label: 'Gemini (Antigravity)' },
        capabilities: {
          modelSelection: models.length > 0,
          reasoning: false,
          structuredSkills: false,
          imageInput: supportsImage(session),
          nativeSessionList: Boolean(session.acp.capabilities.sessionCapabilities?.list)
            && Boolean(session.acp.capabilities.loadSession || session.acp.capabilities.sessionCapabilities?.resume),
          planMode: false,
          steer: false,
          append: true,
          questions: false,
          aiCodeReports: false,
        },
        models,
        skills: [],
        collaborationModes: [],
      }
    } finally {
      this.releaseConversation(session.handle)
    }
  }

  async listSkillCatalog(_request: RuntimeSkillCatalogRequest): Promise<RuntimeSkillCatalogEntry[]> {
    return []
  }

  async resolveSkills(_context: RuntimeContext, skillIds: string[]): Promise<Array<{ name: string; path: string }>> {
    if (skillIds.length) throw new Error('当前 Gemini CLI ACP 未提供可解析的 Skill catalog')
    return []
  }

  async setPermission(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void> {
    this.require(conversation).mode = mode
  }

  async updateContext(conversation: ConversationHandle, context: RuntimeContext): Promise<void> {
    this.require(conversation).context = context
  }

  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> {
    return this.submitTurn(request).completed
  }

  submitTurn(request: SendTurnRequest): SubmitTurnResult {
    const session = this.require(request.conversation)
    if (request.mode === 'append' && session.running && session.activeTurnId) return this.submitAppend(session, request)
    if (this.isBusy(session) && request.mode !== 'steer') {
      const completed = this.whenIdle(session).then(() => this.sendTurn(request))
      return {
        clientCommandId: request.clientCommandId ?? randomUUID(),
        started: completed.then(result => ({ threadId: result.conversation.nativeId, turnId: '' })),
        completed,
      }
    }
    const clientCommandId = request.clientCommandId ?? randomUUID()
    const events: RuntimeEvent[] = []
    const unsubscribe = this.listen(session, event => { events.push(event); request.onEvent?.(event) })
    const started = Promise.resolve({ threadId: session.handle.nativeId, turnId: clientCommandId })
    this.emit(session, runtimeEvent(session, 'command.queued', { clientCommandId, text: request.prompt }, undefined, clientCommandId))
    this.emit(session, runtimeEvent(session, 'command.bound', { clientCommandId, nativeTurnId: clientCommandId }, clientCommandId, clientCommandId))
    const completed = this.runTurn(session, request, events).finally(() => unsubscribe())
    const running = completed.finally(() => { if (session.running === running) session.running = null })
    void running.catch(() => undefined)
    session.running = running
    return { clientCommandId, started, completed }
  }

  async interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }> {
    const session = this.require(conversation)
    const turnId = session.activeTurnId
    let cancelDelivered = false
    try {
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
    if (!pending) throw new Error('待处理的 Gemini CLI 授权请求不存在')
    const selected = pending.options.find(option => outcome === 'allowed-once' ? option.kind === 'allow_once' : option.kind.startsWith('reject'))
    session.approvals.delete(approvalId)
    this.emit(session, runtimeEvent(session, 'approval.resolved', {
      approvalId,
      outcome,
      nativeOutcome: selected ? 'selected' : 'cancelled',
      ...(selected ? { optionId: selected.optionId } : {}),
    }, session.activeTurnId))
    pending.resolve(selected?.optionId ?? null)
  }

  async respondQuestion(_conversation: ConversationHandle, _requestId: string, _answer: unknown): Promise<void> {
    throw new Error('当前 Gemini CLI ACP 未提供 CodyWork 问答映射')
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(session => this.closeSession(session)))
    this.sessions.clear()
  }

  private async startSession(id: string, context: RuntimeContext, nativeId?: string): Promise<ConversationHandle> {
    this.assertCommandAvailable()
    const cwd = executionCwd(context)
    let acp: AcpSession
    try {
      acp = await this.acp.open({ bindingId: id, cwd, ...(nativeId ? { sessionId: nativeId } : {}) })
    } catch (error) {
      throw new Error(presentGeminiFailure(error).message)
    }
    const handle = { id, nativeId: acp.sessionId, createdAt: nowIso() }
    const session: ProductSession = {
      handle,
      context,
      mode: this.modeFromContext(context),
      acp,
      listeners: new Set(),
      events: [],
      watermark: 0,
      approvals: new Map(),
      running: null,
      appendRuns: new Set(),
      forcedInterruptedTurns: new Set(),
      forcedInterruptionResolvers: new Map(),
      closed: false,
    }
    this.sessions.set(id, session)
    this.acp.subscribe(acp, update => this.onUpdate(session, update))
    this.acp.setPermissionHandler(acp, request => this.requestPermission(session, request.options, request.toolCall))
    return handle
  }

  private async createEphemeralSession(context: RuntimeContext): Promise<ProductSession> {
    const handle = await this.createConversation({ conversationId: `composer-options-${randomUUID()}`, context })
    return this.require(handle)
  }

  private submitAppend(session: ProductSession, request: SendTurnRequest): SubmitTurnResult {
    const clientCommandId = request.clientCommandId ?? randomUUID()
    const activeTurnId = session.activeTurnId!
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
        const prompt = this.acp.prompt(session.acp, [{ type: 'text', text: request.prompt }])
        this.emit(session, runtimeEvent(session, 'command.appended', { clientCommandId, delivery: 'acp_prompt' }, activeTurnId, clientCommandId))
        await prompt
        return { conversation: session.handle, finalText: this.finalText(events), events: [...events] }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        this.emit(session, runtimeEvent(session, 'command.requeued', {
          clientCommandId,
          reason: `Gemini CLI 暂未接受追加，已转入队列：${reason}`,
        }, undefined, clientCommandId))
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

  private isBusy(session: ProductSession): boolean {
    return Boolean(session.running) || session.appendRuns.size > 0
  }

  private async whenIdle(session: ProductSession): Promise<void> {
    while (session.running || session.appendRuns.size) {
      await Promise.allSettled([...(session.running ? [session.running] : []), ...session.appendRuns])
    }
  }

  private async runTurn(session: ProductSession, request: SendTurnRequest, events: RuntimeEvent[]): Promise<SendTurnResult> {
    const turnId = request.clientCommandId ?? randomUUID()
    let started = false
    session.activeTurnId = turnId
    try {
      if (request.localImages?.length && !supportsImage(session)) throw new Error('当前 Gemini CLI ACP 未声明图片 Prompt 能力')
      if (request.settings?.skills?.length) throw new Error('当前 Gemini CLI ACP 未提供结构化 Skill 输入能力')
      if (request.settings?.reasoningEffort) throw new Error('当前 Gemini CLI ACP 未提供推理程度配置')
      if (request.settings?.collaborationMode === 'plan') throw new Error('当前 Gemini CLI ACP 未提供 Plan 模式配置')
      if (request.mode === 'steer') throw new Error('当前 Gemini CLI ACP 未提供引导当前 Turn 的能力；请使用“追加到当前任务”')
      if (request.settings?.model?.trim()) await this.setModel(session, request.settings.model.trim())
      const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: this.promptWithInstructions(session.context, request.prompt) },
      ]
      for (const image of request.localImages ?? []) {
        blocks.push({
          type: 'image',
          data: readFileSync(image.path).toString('base64'),
          mimeType: image.path.endsWith('.png') ? 'image/png' : 'image/jpeg',
        })
      }
      request.beforeStart?.()
      this.emit(session, runtimeEvent(session, 'turn.started', {}, turnId))
      this.emit(session, runtimeEvent(session, 'turn.activity', { label: '正在准备 Gemini CLI 请求…', details: ['已建立 ACP 会话', '正在提交提示词'] }, turnId))
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
        if (finalText) this.emit(session, runtimeEvent(session, 'assistant.completed', { text: finalText }, turnId, `assistant:${turnId}`))
        this.emit(session, runtimeEvent(session, outcome.response.stopReason === 'cancelled' ? 'turn.interrupted' : 'turn.completed', { stopReason: outcome.response.stopReason }, turnId))
      }
      return { conversation: session.handle, finalText, events: [...events] }
    } catch (error) {
      if (session.forcedInterruptedTurns.has(turnId)) {
        return { conversation: session.handle, finalText: this.finalText(events), events: [...events] }
      }
      const failure = presentGeminiFailure(error)
      const eventData = { error: failure.message, ...(failure.code ? { code: failure.code } : {}) }
      if (!started) this.emit(session, runtimeEvent(session, 'command.failed', eventData, turnId, turnId))
      this.emit(session, runtimeEvent(session, 'turn.failed', eventData, turnId))
      throw new Error(failure.message)
    } finally {
      session.forcedInterruptionResolvers.delete(turnId)
      if (session.activeTurnId === turnId) session.activeTurnId = undefined
    }
  }

  private async requestPermission(session: ProductSession, options: AcpPermissionOption[], toolCall: unknown): Promise<string | null> {
    if (session.mode === 'yolo') return options.find(option => option.kind === 'allow_once' || option.kind === 'allow_always')?.optionId ?? null
    if (session.mode === 'read-only') return options.find(option => option.kind === 'reject_once' || option.kind === 'reject_always')?.optionId ?? null
    const approvalId = randomUUID()
    const selection = new Promise<string | null>(resolve => session.approvals.set(approvalId, { options, resolve }))
    this.emit(session, runtimeEvent(session, 'approval.requested', { approvalId, toolCall, options }, session.activeTurnId))
    const optionId = await selection
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
      this.emit(session, runtimeEvent(session, 'turn.activity', { label: 'Gemini CLI 正在生成回复…', details: ['正在接收模型输出'] }, turnId))
      this.emit(session, runtimeEvent(session, 'assistant.delta', { text }, turnId, turnId ? `assistant:${turnId}` : undefined))
    } else if (update.sessionUpdate === 'user_message_chunk') {
      this.emit(session, runtimeEvent(session, 'user.completed', { text }, turnId, turnId))
    } else if (update.sessionUpdate === 'agent_thought_chunk') {
      this.emit(session, runtimeEvent(session, 'reasoning.delta', { text }, turnId, turnId ? `reasoning:${turnId}` : undefined))
    } else if (update.sessionUpdate === 'tool_call') {
      this.emit(session, runtimeEvent(session, 'tool.started', { ...update }, turnId))
    } else if (update.sessionUpdate === 'tool_call_update') {
      this.emit(session, runtimeEvent(session, update.status === 'completed' ? 'tool.completed' : 'tool.updated', { ...update }, turnId))
    }
  }

  private emit(session: ProductSession, event: RuntimeEvent): void {
    session.events.push(event)
    session.watermark++
    for (const listener of session.listeners) listener(event)
  }

  private forceInterrupt(session: ProductSession, turnId: string, cause: 'cancel_timeout' | 'cancel_transport_unavailable'): void {
    if (session.forcedInterruptedTurns.has(turnId)) return
    session.forcedInterruptedTurns.add(turnId)
    session.forcedInterruptionResolvers.get(turnId)?.()
    for (const approval of session.approvals.values()) approval.resolve(null)
    session.approvals.clear()
    this.emit(session, runtimeEvent(session, 'turn.interrupted', { stopReason: 'cancelled', cause }, turnId))
    this.sessions.delete(session.handle.id)
    session.closed = true
    this.acp.terminate(session.acp)
  }

  private listen(session: ProductSession, listener: (event: RuntimeEvent) => void): () => void {
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }

  private finalText(events: RuntimeEvent[]): string {
    return events.filter(event => event.type === 'assistant.delta').map(event => String(event.data.text ?? '')).join('')
  }

  private promptWithInstructions(context: RuntimeContext, prompt: string): string {
    return context.instructionBundle.systemInstructions ? `${context.instructionBundle.systemInstructions}\n\n---\n\n${prompt}` : prompt
  }

  private require(conversation: ConversationHandle): ProductSession {
    const session = this.sessions.get(conversation.id)
    if (!session || session.handle.nativeId !== conversation.nativeId || session.closed) {
      throw new Error('Gemini CLI conversation runtime is not available')
    }
    return session
  }

  private requireById(id: string): ProductSession {
    const session = this.sessions.get(id)
    if (!session) throw new Error('Gemini CLI conversation runtime is not available')
    return session
  }

  private modeFromContext(context: RuntimeContext): RuntimePermissionMode {
    return context.effectivePolicy.approval === 'none'
      ? 'yolo'
      : context.effectivePolicy.writableRoots.length
        ? 'workspace-write'
        : 'read-only'
  }

  private models(options: AcpSessionConfigOption[]): RuntimeComposerOptions['models'] {
    const model = options.find(option => option.id === 'model' || option.category === 'model')
    if (!model || !isSelectOption(model)) return []
    const values = model.options.flatMap(entry => 'options' in entry ? entry.options : [entry])
    return values.map(value => ({
      id: value.value,
      label: value.name,
      description: value.description ?? '',
      isDefault: value.value === model.currentValue,
      defaultReasoningEffort: 'none' as ReasoningEffort,
      supportedReasoningEfforts: [] as ReasoningEffort[],
    }))
  }

  private async setModel(session: ProductSession, model: string): Promise<void> {
    const option = session.acp.configOptions.find(value => value.id === 'model' || value.category === 'model')
    if (!option || !isSelectOption(option)) throw new Error('当前 Gemini CLI ACP 未提供模型选择配置')
    const values = option.options.flatMap(entry => 'options' in entry ? entry.options : [entry])
    const selected = values.find(value => value.value === model) ?? values.find(value => value.name === model)
    if (!selected) throw new Error(`当前 Gemini CLI ACP 不支持模型：${model}`)
    if (selected.value === option.currentValue) return
    await this.acp.setConfigOption(session.acp, option.id, selected.value)
  }
}
