import { randomUUID } from 'node:crypto'
import { createAppServerHost, type AppServerHost } from '@codycodeagent/cody-web-core/runtime'
import {
  buildTurnUserInput,
  CodexSessionManager,
  type ExecutionContext,
  type ExecutionPolicyProvider,
  type ThreadBinding,
  type TurnInput,
} from '@codycodeagent/cody-web-core/session'
import { createConversationState, reduceConversationEvents, type CodexEvent } from '@codycodeagent/cody-web-core/conversation'
import { asRecord } from '@codycodeagent/cody-web-core/protocol'
import { nowIso } from '../db/index.js'
import type {
  ConversationHandle,
  ConversationRuntimeAdapter,
  CreateConversationRequest,
  ListNativeThreadsRequest,
  NativeThreadSummary,
  ReadConversationRequest,
  ReasoningEffort,
  RuntimeComposerOptions,
  RuntimeContext,
  RuntimeEvent,
  RuntimeManifest,
  RuntimePermissionMode,
  SendTurnRequest,
  SendTurnResult,
  WorkspaceCheckRequest,
  WorkspaceCheckResult,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResult,
} from './protocol.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION } from './protocol.js'
import { isWithinRoot, resolveEffectivePolicy, resolveInstructionBundle } from './policy.js'

type CodexOptions = { command?: string; model?: string; env?: NodeJS.ProcessEnv }
type ProductSession = {
  handle: ConversationHandle
  binding: ThreadBinding
  context: RuntimeContext
  mode: RuntimePermissionMode
  planMode: boolean
  model: string
  reasoningEffort: ReasoningEffort | ''
}

function workspaceCheck(path: string): WorkspaceCheckResult {
  return { status: 'ready', present: [path], missing: [], message: 'Codex App Server uses the CodyWork Workspace' }
}

function approvalPolicy(mode: RuntimePermissionMode): 'never' | 'untrusted' {
  // `on-request` lets the model decide whether to ask and therefore does not
  // guarantee a prompt for destructive shell commands. Workspace-write uses
  // Codex's untrusted-command gate; CodyWork's broker still makes the decision.
  return mode === 'yolo' || mode === 'read-only' ? 'never' : 'untrusted'
}

function sandboxPolicy(context: RuntimeContext, mode: RuntimePermissionMode): TurnInput['sandboxPolicy'] {
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: false }
  return {
    type: 'workspaceWrite', writableRoots: context.effectivePolicy.writableRoots,
    networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true,
  }
}

function policyInstructions(context: RuntimeContext): string {
  return `Effective CodyWork policy. Readable roots: ${context.effectivePolicy.readableRoots.join(', ')}. Writable roots: ${context.effectivePolicy.writableRoots.join(', ')}. Never access or modify paths outside these roots.`
}

function executionContext(context: RuntimeContext, mode: RuntimePermissionMode): ExecutionContext {
  const cwd = context.demandPath ?? context.workspacePath
  return {
    thread: {
      cwd, approvalPolicy: approvalPolicy(mode), sandbox: mode === 'read-only' ? 'read-only' : 'workspace-write',
      runtimeWorkspaceRoots: context.effectivePolicy.writableRoots,
      baseInstructions: context.instructionBundle.systemInstructions, developerInstructions: policyInstructions(context),
      experimentalRawEvents: false,
    },
    turn: {
      cwd,
      runtimeWorkspaceRoots: context.effectivePolicy.writableRoots,
      approvalPolicy: approvalPolicy(mode),
      sandboxPolicy: sandboxPolicy(context, mode),
    },
  }
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return new Date(value * 1000).toISOString()
}

function threadSummary(value: unknown): NativeThreadSummary | null {
  const thread = asRecord(value)
  const nativeId = typeof thread?.id === 'string' ? thread.id.trim() : ''
  if (!nativeId) return null
  return {
    nativeId, preview: typeof thread?.preview === 'string' ? thread.preview.trim() : '',
    ...(typeof thread?.cwd === 'string' && thread.cwd.trim() ? { cwd: thread.cwd.trim() } : {}),
    ...(toIsoTimestamp(thread?.createdAt) ? { createdAt: toIsoTimestamp(thread?.createdAt) } : {}),
    ...(toIsoTimestamp(thread?.updatedAt) ? { updatedAt: toIsoTimestamp(thread?.updatedAt) } : {}),
    ...(typeof thread?.source === 'string' && thread.source ? { source: thread.source } : {}),
  }
}

function modelOptions(value: unknown): string[] {
  const rows = Array.isArray(asRecord(value)?.data) ? asRecord(value)!.data as unknown[] : []
  return [...new Set(rows.flatMap(item => {
    const row = asRecord(item)
    const model = typeof row?.id === 'string' ? row.id.trim() : typeof row?.model === 'string' ? row.model.trim() : ''
    return model ? [model] : []
  }))]
}

function collaborationOptions(value: unknown): RuntimeComposerOptions['collaborationModes'] {
  const rows = Array.isArray(asRecord(value)?.data) ? asRecord(value)!.data as unknown[] : []
  return rows.flatMap(item => {
    const row = asRecord(item)
    const name = typeof row?.name === 'string' ? row.name.trim() : ''
    if (!name) return []
    const settings = asRecord(row?.settings)
    return [{
      name, mode: row?.mode === 'plan' ? 'plan' as const : 'default' as const,
      label: typeof row?.label === 'string' && row.label.trim() ? row.label.trim() : name,
      ...(typeof settings?.model === 'string' && settings.model.trim() ? { model: settings.model.trim() } : {}),
      ...(typeof settings?.reasoning_effort === 'string' ? { reasoningEffort: settings.reasoning_effort as ReasoningEffort } : {}),
    }]
  })
}

function toRuntimeEvent(event: CodexEvent, conversationId: string): RuntimeEvent {
  return { ...event, conversationId, provider: 'codex', timestamp: event.atIso }
}

function referencedPaths(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return /path|cwd|root|file/iu.test(key) && value.startsWith('/') ? [value] : []
  if (Array.isArray(value)) return value.flatMap(item => referencedPaths(item, key))
  const row = asRecord(value)
  return row ? Object.entries(row).flatMap(([childKey, child]) => referencedPaths(child, childKey)) : []
}

/** Thin CodyWork product adapter over the shared Codex runtime/session core. */
export class CodexRuntimeAdapter implements ConversationRuntimeAdapter {
  readonly provider = 'codex'
  private host: AppServerHost | null = null
  private manager: CodexSessionManager | null = null
  private readonly sessions = new Map<string, ProductSession>()
  private readonly sessionIdByThreadId = new Map<string, string>()
  private readonly listeners = new Map<string, Set<(event: RuntimeEvent) => void>>()
  private unsubscribeManager: (() => void) | null = null

  constructor(private readonly options: CodexOptions = {}) {}

  async checkConnection(cwd = process.cwd()): Promise<RuntimeManifest> {
    const host = createAppServerHost({ command: this.command(), cwd, ...(this.options.env ? { env: this.options.env } : {}) })
    try { await host.ensureInitialized(); return this.getManifest() } finally { await host.dispose() }
  }

  async getManifest(): Promise<RuntimeManifest> {
    return {
      provider: this.provider, runtimeVersion: 'cody-web-core/0.6.3', protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION,
      streaming: true, resume: true, fork: false, interrupt: true, approvals: true, diffs: true, subagents: true,
      readPolicy: 'roots', writePolicy: 'roots', shellPolicy: 'allowlist', approval: 'runtime',
      workspaceInitialize: true, workspaceRepair: false, goals: true, plans: true, questions: true,
    }
  }

  async checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult> { return workspaceCheck(request.workspacePath) }

  async initializeWorkspace(request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult> {
    const context: RuntimeContext = {
      workspacePath: request.workspacePath,
      instructionBundle: resolveInstructionBundle({ workspacePath: request.workspacePath, platformInstructions: request.instruction }),
      effectivePolicy: resolveEffectivePolicy({ workspacePath: request.workspacePath, readableRoots: [request.workspacePath], writableRoots: [request.workspacePath], shell: 'allowlist', approval: 'none' }),
    }
    const conversation = await this.createConversation({ conversationId: `workspace-setup-${randomUUID()}`, context })
    const result = await this.sendTurn({ conversation, prompt: request.instruction, ...(request.onEvent ? { onEvent: request.onEvent } : {}) })
    return { status: 'initialized', message: result.finalText || 'Codex 已完成 Workspace 初始化。' }
  }

  async createConversation(request: CreateConversationRequest): Promise<ConversationHandle> {
    const manager = await this.ensureRuntime(request.context)
    const id = request.conversationId ?? `conversation-${randomUUID()}`
    const mode = this.modeFromContext(request.context)
    const binding = await manager.create(id, executionContext(request.context, mode))
    return this.attach(id, binding, request.context, mode)
  }

  async resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle> {
    const manager = await this.ensureRuntime(request.context)
    const id = request.conversationId ?? `conversation-${randomUUID()}`
    const mode = this.modeFromContext(request.context)
    const binding = { id, threadId: request.nativeId }
    await manager.resume(binding, executionContext(request.context, mode))
    return this.attach(id, binding, request.context, mode)
  }

  async readConversation(request: ReadConversationRequest): Promise<RuntimeEvent[]> {
    const session = this.require(request.conversation)
    return (await this.requireManager().read(session.handle.id)).map(event => toRuntimeEvent(event, session.handle.id))
  }

  async listNativeThreads(request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]> {
    await this.ensureRuntime(request.context)
    const summaries: NativeThreadSummary[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page += 1) {
      const result: { data?: unknown; nextCursor?: unknown } = await this.requireHost().call('thread/list', { archived: false, limit: 100, sortKey: 'updated_at', ...(cursor ? { cursor } : {}) })
      for (const item of Array.isArray(result.data) ? result.data : []) {
        const summary = threadSummary(item)
        if (summary) summaries.push(summary)
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null
      if (!cursor) break
    }
    return summaries
  }

  async getComposerOptions(context: RuntimeContext): Promise<RuntimeComposerOptions> {
    await this.ensureRuntime(context)
    const [models, modes] = await Promise.allSettled([this.requireHost().call('model/list', {}), this.requireHost().call('collaborationMode/list', {})])
    return { models: models.status === 'fulfilled' ? modelOptions(models.value) : [], collaborationModes: modes.status === 'fulfilled' ? collaborationOptions(modes.value) : [] }
  }

  async setPermission(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void> {
    const session = this.require(conversation)
    session.mode = mode
    this.requireManager().setContext(session.handle.id, executionContext(session.context, mode))
  }

  async sendCommand(request: SendTurnRequest): Promise<SendTurnResult> {
    const session = this.require(request.conversation)
    if (request.prompt.startsWith('/plan')) {
      if (request.prompt === '/plan' || request.prompt === '/plan on') session.planMode = !session.planMode
      else if (request.prompt === '/plan off' || request.prompt === '/plan reject') session.planMode = false
      await this.requireHost().call('thread/settings/update', { threadId: session.binding.threadId, collaborationMode: { mode: session.planMode ? 'plan' : 'default', settings: { model: session.model, reasoning_effort: session.reasoningEffort || null, developer_instructions: null } } })
    } else if (request.prompt.startsWith('/goal')) {
      const value = request.prompt.replace(/^\/goal\s*/iu, '').trim()
      if (!value || value === 'clear' || value === '清除') await this.requireHost().call('thread/goal/clear', { threadId: session.binding.threadId })
      else await this.requireHost().call('thread/goal/set', { threadId: session.binding.threadId, objective: value, status: 'active' })
    }
    return { conversation: request.conversation, finalText: '', events: [] }
  }

  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> {
    const session = this.require(request.conversation)
    if (request.settings?.model?.trim()) session.model = request.settings.model.trim()
    if (request.settings?.reasoningEffort) session.reasoningEffort = request.settings.reasoningEffort
    const events: RuntimeEvent[] = []
    const unsubscribe = this.listen(session.handle.id, event => { events.push(event); request.onEvent?.(event) })
    const turn: TurnInput = {
      input: buildTurnUserInput({ text: request.prompt, skills: request.settings?.skills }),
      ...(session.model ? { model: session.model } : {}),
      ...(session.reasoningEffort ? { effort: session.reasoningEffort } : {}),
      runtimeWorkspaceRoots: session.context.effectivePolicy.writableRoots,
      approvalPolicy: approvalPolicy(session.mode), sandboxPolicy: sandboxPolicy(session.context, session.mode),
      ...(session.planMode ? { collaborationMode: { mode: 'plan', settings: { model: session.model, reasoning_effort: session.reasoningEffort || null, developer_instructions: null } } } : {}),
    }
    try { await this.requireManager().run(session.handle.id, turn, request.mode === 'steer' ? 'steer' : 'queue') } finally { unsubscribe() }
    const state = reduceConversationEvents(createConversationState(session.binding.threadId), events)
    const finalText = [...state.messages].reverse().find(message => message.role === 'assistant')?.text ?? ''
    return { conversation: request.conversation, finalText, events }
  }

  async interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }> {
    const session = this.require(conversation)
    return { supported: await this.requireManager().interrupt(session.handle.id) }
  }

  async respondApproval(conversation: ConversationHandle, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    await this.requireManager().respondApproval(this.require(conversation).handle.id, approvalId, outcome === 'rejected' ? 'decline' : 'accept')
  }

  async respondQuestion(conversation: ConversationHandle, requestId: string, answer: unknown): Promise<void> {
    await this.requireManager().respondQuestion(this.require(conversation).handle.id, requestId, answer)
  }

  async close(): Promise<void> {
    this.unsubscribeManager?.(); this.unsubscribeManager = null
    await this.manager?.dispose(); await this.host?.dispose()
    this.manager = null; this.host = null; this.sessions.clear(); this.sessionIdByThreadId.clear(); this.listeners.clear()
  }

  private async ensureRuntime(context: RuntimeContext): Promise<CodexSessionManager> {
    if (this.manager) return this.manager
    this.host = createAppServerHost({ command: this.command(), cwd: context.workspacePath, ...(this.options.env ? { env: this.options.env } : {}), initializeParams: { clientInfo: { name: 'codywork', title: 'CodyWork', version: '0.6.3' }, capabilities: { experimentalApi: true, requestAttestation: false } } })
    const policy: ExecutionPolicyProvider = { evaluate: (operation, binding) => {
      const session = this.sessions.get(binding.id)
      if (!session) return { action: 'deny', reason: 'CodyWork session is not attached.' }
      const paths = referencedPaths(operation.params)
      if (paths.some(path => session.context.effectivePolicy.deniedRoots.some(root => isWithinRoot(root, path)))) return { action: 'deny', reason: 'Path is denied by CodyWork policy.' }
      if (operation.method.includes('fileChange') && paths.some(path => !session.context.effectivePolicy.writableRoots.some(root => isWithinRoot(root, path)))) return { action: 'deny', reason: 'File change is outside the Demand Worktree.' }
      if (session.mode === 'yolo') return { action: 'allow', reason: 'CodyWork YOLO mode inside the fixed sandbox.' }
      return { action: 'ask' }
    } }
    this.manager = new CodexSessionManager({ host: this.host, policy })
    this.unsubscribeManager = this.manager.subscribe(event => {
      const conversationId = this.sessionIdByThreadId.get(event.threadId)
      if (!conversationId) return
      const wrapped = toRuntimeEvent(event, conversationId)
      for (const listener of this.listeners.get(conversationId) ?? []) listener(wrapped)
    })
    return this.manager
  }

  private attach(id: string, binding: ThreadBinding, context: RuntimeContext, mode: RuntimePermissionMode): ConversationHandle {
    const handle = { id, provider: this.provider, nativeId: binding.threadId, createdAt: nowIso() }
    this.sessions.set(id, { handle, binding, context, mode, planMode: false, model: this.options.model ?? 'gpt-5.4', reasoningEffort: '' })
    this.sessionIdByThreadId.set(binding.threadId, id)
    return handle
  }

  private listen(conversationId: string, listener: (event: RuntimeEvent) => void): () => void {
    const listeners = this.listeners.get(conversationId) ?? new Set<(event: RuntimeEvent) => void>()
    listeners.add(listener); this.listeners.set(conversationId, listeners)
    return () => { listeners.delete(listener); if (listeners.size === 0) this.listeners.delete(conversationId) }
  }

  private require(conversation: ConversationHandle): ProductSession {
    const session = this.sessions.get(conversation.id)
    if (!session) throw new Error('Codex conversation runtime is not available')
    return session
  }

  private requireHost(): AppServerHost { if (!this.host) throw new Error('Codex App Server 尚未初始化'); return this.host }
  private requireManager(): CodexSessionManager { if (!this.manager) throw new Error('Codex Session Manager 尚未初始化'); return this.manager }
  private command(): string { return this.options.command?.trim() || 'codex app-server --stdio' }
  private modeFromContext(context: RuntimeContext): RuntimePermissionMode { return context.effectivePolicy.approval === 'none' ? 'yolo' : context.effectivePolicy.writableRoots.length ? 'workspace-write' : 'read-only' }
}
