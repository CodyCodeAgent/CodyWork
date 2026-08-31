import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import {
  CODY_WEB_CORE_VERSION,
  createAppServerHost,
  type AppServerHost,
} from '@codycodeagent/cody-web-core/runtime'
import {
  buildTurnUserInput,
  CodexSessionCatalog,
  CodexSessionManager,
  CodexThreadCommands,
  type ExecutionContext,
  type ExecutionPolicyProvider,
  type CodexSessionSnapshot,
  type ThreadBinding,
  type TurnInput,
} from '@codycodeagent/cody-web-core/session'
import {
  createConversationState,
  reduceConversationEvents,
  type CodexEvent,
} from '@codycodeagent/cody-web-core/conversation'
import { asRecord } from '@codycodeagent/cody-web-core/protocol'
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
  RuntimeEvent,
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

type CodexOptions = { command?: string; model?: string; env?: NodeJS.ProcessEnv; appServerCwd?: string }
type ProductSession = {
  handle: ConversationHandle
  binding: ThreadBinding
  context: RuntimeContext
  mode: RuntimePermissionMode
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
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: true }
  return {
    type: 'workspaceWrite', writableRoots: context.effectivePolicy.writableRoots,
    networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true,
  }
}

function policyInstructions(context: RuntimeContext): string {
  return `Effective CodyWork policy. Readable roots: ${context.effectivePolicy.readableRoots.join(', ')}. Writable roots: ${context.effectivePolicy.writableRoots.join(', ')}. Never access or modify paths outside these roots.`
}

function executionContext(context: RuntimeContext, mode: RuntimePermissionMode, bootstrapCwd: string): ExecutionContext {
  const executionCwd = realpathSync.native(context.demandPath ?? context.workspacePath)
  return {
    thread: {
      // Codex discovers Skills when a native Thread is created/resumed. Do not
      // point that bootstrap phase at a Workspace: a large Workspace skill
      // catalog would be implicitly injected even when the user referenced no
      // `$Skill`. The actual Turn below always receives the Demand Worktree.
      cwd: bootstrapCwd, approvalPolicy: approvalPolicy(mode), sandbox: mode === 'read-only' ? 'read-only' : 'workspace-write',
      runtimeWorkspaceRoots: context.effectivePolicy.writableRoots,
      baseInstructions: context.instructionBundle.systemInstructions, developerInstructions: policyInstructions(context),
      experimentalRawEvents: false, ephemeral: false,
    },
    turn: {
      cwd: executionCwd,
      runtimeWorkspaceRoots: context.effectivePolicy.writableRoots,
      approvalPolicy: approvalPolicy(mode),
      sandboxPolicy: sandboxPolicy(context, mode),
    },
  }
}

function toRuntimeEvent(event: CodexEvent, conversationId: string): RuntimeEvent {
  return { ...event, conversationId, timestamp: event.atIso }
}

function referencedPaths(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return /path|cwd|root|file/iu.test(key) && value.startsWith('/') ? [value] : []
  if (Array.isArray(value)) return value.flatMap(item => referencedPaths(item, key))
  const row = asRecord(value)
  return row ? Object.entries(row).flatMap(([childKey, child]) => referencedPaths(child, childKey)) : []
}

/** Thin CodyWork product adapter over the shared Codex runtime/session core. */
export class CodyWorkCodexRuntime implements CodyWorkRuntime {
  private host: AppServerHost | null = null
  private catalog: CodexSessionCatalog | null = null
  private manager: CodexSessionManager | null = null
  private readonly sessions = new Map<string, ProductSession>()
  private readonly sessionIdByThreadId = new Map<string, string>()
  private readonly listeners = new Map<string, Set<(event: RuntimeEvent) => void>>()
  private unsubscribeManager: (() => void) | null = null

  constructor(private readonly options: CodexOptions = {}) {}

  async checkConnection(cwd = process.cwd()): Promise<CodexRuntimeInfo> {
    const host = createAppServerHost({ command: this.command(), cwd, ...(this.options.env ? { env: this.options.env } : {}) })
    try { await host.ensureInitialized(); return this.getInfo() } finally { await host.dispose() }
  }

  async getInfo(): Promise<CodexRuntimeInfo> {
    return { runtimeVersion: `cody-web-core/${CODY_WEB_CORE_VERSION}`, protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION }
  }

  diagnostics() { return this.host?.diagnostics() ?? null }

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
    const binding = await manager.create(id, executionContext(request.context, mode, this.runtimeOwnerCwd()))
    return this.attach(id, binding, request.context, mode)
  }

  async resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle> {
    const manager = await this.ensureRuntime(request.context)
    const id = request.conversationId ?? `conversation-${randomUUID()}`
    const mode = this.modeFromContext(request.context)
    const binding = { id, threadId: request.nativeId }
    await manager.resume(binding, executionContext(request.context, mode, this.runtimeOwnerCwd()))
    return this.attach(id, binding, request.context, mode)
  }

  async renameConversation(conversation: ConversationHandle, title: string): Promise<void> {
    const session = this.require(conversation)
    await new CodexThreadCommands(this.requireHost()).renameThread(session.binding.threadId, title)
  }

  async readConversation(request: ReadConversationRequest): Promise<RuntimeEvent[]> {
    await this.ensureRuntime(request.context)
    return (await this.requireCatalog().readThread(request.nativeId)).map(event => toRuntimeEvent(event, request.conversationId))
  }

  sessionSnapshot(conversation: ConversationHandle): CodexSessionSnapshot | null {
    return this.manager?.snapshot(conversation.id) ?? null
  }

  pendingConversationEvents(conversation: ConversationHandle): RuntimeEvent[] {
    const session = this.sessions.get(conversation.id)
    if (!session || !this.manager) return []
    return this.manager.listPendingEvents(conversation.id).map(event => toRuntimeEvent(event, conversation.id))
  }

  subscribeConversation(conversation: ConversationHandle, listener: (event: RuntimeEvent) => void): () => void {
    this.require(conversation)
    return this.listen(conversation.id, listener)
  }

  async listNativeThreads(request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]> {
    await this.ensureRuntime(request.context)
    return (await this.requireCatalog().listThreads()).map(thread => ({
      nativeId: thread.threadId,
      preview: thread.preview,
      ...(thread.cwd ? { cwd: thread.cwd } : {}),
      ...(thread.createdAtIso ? { createdAt: thread.createdAtIso } : {}),
      ...(thread.updatedAtIso ? { updatedAt: thread.updatedAtIso } : {}),
      ...(thread.source ? { source: thread.source } : {}),
    }))
  }

  async getComposerOptions(context: RuntimeContext): Promise<RuntimeComposerOptions> {
    await this.ensureRuntime(context)
    const cwd = context.demandPath ?? context.workspacePath
    const skillCwds = [...new Set([cwd, context.workspacePath].filter(Boolean))]
    const [models, modes, skills] = await Promise.allSettled([
      this.requireCatalog().listModels(),
      this.requireCatalog().listCollaborationModes(),
      this.requireCatalog().listSkills(skillCwds),
    ])
    return {
      models: models.status === 'fulfilled' ? [...new Set(models.value.map(model => model.id || model.model).filter(Boolean))] : [],
      skills: skills.status === 'fulfilled' ? skills.value.filter(skill => skill.enabled).map(skill => ({
        id: skill.path,
        name: skill.name,
        label: skill.displayName || skill.name,
        description: skill.description,
      })) : [],
      collaborationModes: modes.status === 'fulfilled' ? modes.value.flatMap(mode => {
        if (!mode.name) return []
        return [{
          name: mode.name,
          mode: mode.mode === 'plan' ? 'plan' as const : 'default' as const,
          label: mode.name,
          ...(mode.model ? { model: mode.model } : {}),
          ...(mode.reasoningEffort ? { reasoningEffort: mode.reasoningEffort as ReasoningEffort } : {}),
        }]
      }) : [],
    }
  }

  async resolveSkills(context: RuntimeContext, skillIds: string[]): Promise<Array<{ name: string; path: string }>> {
    if (skillIds.length === 0) return []
    await this.ensureRuntime(context)
    const cwd = context.demandPath ?? context.workspacePath
    const available = await this.requireCatalog().listSkills([...new Set([cwd, context.workspacePath].filter(Boolean))])
    const enabledByPath = new Map(available.filter(skill => skill.enabled).map(skill => [skill.path, skill]))
    return skillIds.map(id => {
      const skill = enabledByPath.get(id)
      if (!skill) throw new Error(`Skill 不存在、已禁用或不适用于当前上下文：${id}`)
      return { name: skill.name, path: skill.path }
    })
  }

  async setPermission(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void> {
    const session = this.require(conversation)
    session.mode = mode
    this.requireManager().setContext(session.handle.id, executionContext(session.context, mode, this.runtimeOwnerCwd()))
  }

  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> {
    return this.submitTurn(request).completed
  }

  submitTurn(request: SendTurnRequest): import('./protocol.js').SubmitTurnResult {
    const session = this.require(request.conversation)
    if (request.settings?.model?.trim()) session.model = request.settings.model.trim()
    if (request.settings?.reasoningEffort) session.reasoningEffort = request.settings.reasoningEffort
    const events: RuntimeEvent[] = []
    const buffered: RuntimeEvent[] = []
    let nativeTurnId = ''
    const collect = (event: RuntimeEvent): void => {
      if (!nativeTurnId) { buffered.push(event); return }
      if (event.turnId !== nativeTurnId) return
      events.push(event)
      request.onEvent?.(event)
    }
    const unsubscribe = this.listen(session.handle.id, collect)
    const turn: TurnInput = {
      input: buildTurnUserInput({ text: request.prompt, skills: request.settings?.skills }),
      ...(session.model ? { model: session.model } : {}),
      ...(session.reasoningEffort ? { effort: session.reasoningEffort } : {}),
      runtimeWorkspaceRoots: session.context.effectivePolicy.writableRoots,
      approvalPolicy: approvalPolicy(session.mode), sandboxPolicy: sandboxPolicy(session.context, session.mode),
      ...(request.settings?.collaborationMode ? { collaborationMode: { mode: request.settings.collaborationMode, settings: { model: session.model || null, reasoning_effort: session.reasoningEffort || null, developer_instructions: null } } } : {}),
    }
    const submission = this.requireManager().submit(
      session.handle.id,
      turn,
      request.mode === 'steer' ? 'steer' : 'queue',
      request.clientCommandId,
    )
    const started = submission.started.then(handle => {
      nativeTurnId = handle.turnId
      for (const event of buffered.splice(0)) collect(event)
      return handle
    })
    const completed = submission.completed.then(async () => {
      await started
      const state = reduceConversationEvents(createConversationState(session.binding.threadId), events)
      const finalText = [...state.messages].reverse().find(message => message.role === 'assistant')?.text ?? ''
      return { conversation: request.conversation, finalText, events }
    }).finally(unsubscribe)
    return { clientCommandId: submission.clientCommandId, started, completed }
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
    this.manager = null; this.catalog = null; this.host = null; this.sessions.clear(); this.sessionIdByThreadId.clear(); this.listeners.clear()
  }

  private async ensureRuntime(context: RuntimeContext): Promise<CodexSessionManager> {
    if (!this.manager) {
      // The App Server process is product-owned and shared across demands.
      // Starting it in the first Workspace makes Codex auto-discover every
      // workspace skill before the user has referenced one. Keep the process
      // in CodyWork's neutral runtime directory; each thread/turn still gets
      // its Demand Worktree cwd and policy explicitly.
      this.host = createAppServerHost({ command: this.command(), cwd: this.runtimeOwnerCwd(), ...(this.options.env ? { env: this.options.env } : {}), initializeParams: { clientInfo: { name: 'codywork', title: 'CodyWork', version: '0.6.3' }, capabilities: { experimentalApi: true, requestAttestation: false } } })
      this.catalog = new CodexSessionCatalog(this.host)
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
    }
    // Catalog reads are valid only after the App Server handshake. Keep the
    // manager allocated across a failed handshake so the next request can retry
    // the shared host's de-duplicated initialization promise.
    await this.requireHost().ensureInitialized()
    return this.manager
  }

  private attach(id: string, binding: ThreadBinding, context: RuntimeContext, mode: RuntimePermissionMode): ConversationHandle {
    const handle = { id, nativeId: binding.threadId, createdAt: nowIso() }
    this.sessions.set(id, { handle, binding, context, mode, model: this.options.model ?? '', reasoningEffort: '' })
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

  private requireCatalog(): CodexSessionCatalog { if (!this.catalog) throw new Error('Codex Session Catalog 尚未初始化'); return this.catalog }
  private requireHost(): AppServerHost { if (!this.host) throw new Error('Codex App Server 尚未初始化'); return this.host }
  private requireManager(): CodexSessionManager { if (!this.manager) throw new Error('Codex Session Manager 尚未初始化'); return this.manager }
  private command(): string { return this.options.command?.trim() || 'codex app-server --stdio' }
  private runtimeOwnerCwd(): string { return realpathSync.native(this.options.appServerCwd ?? process.cwd()) }
  private modeFromContext(context: RuntimeContext): RuntimePermissionMode { return context.effectivePolicy.approval === 'none' ? 'yolo' : context.effectivePolicy.writableRoots.length ? 'workspace-write' : 'read-only' }
}
