import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { nowIso } from '../db/index.js'
import type {
  ConversationHandle,
  ConversationRuntimeAdapter,
  CreateConversationRequest,
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
import { resolveEffectivePolicy, resolveInstructionBundle } from './policy.js'

type JsonRpcMessage = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
type PendingApproval = { rpcId: string | number; conversationId: string; kind: 'approval' | 'question'; questions?: Array<{ id?: unknown }> }
type CodexOptions = { command?: string | undefined; model?: string | undefined; env?: NodeJS.ProcessEnv }

function splitCommand(command: string): string[] {
  const tokens: string[] = []
  const pattern = /[^\s"']+|"([^"]*)"|'([^']*)'/g
  for (const match of command.matchAll(pattern)) tokens.push(match[1] ?? match[2] ?? match[0])
  return tokens
}

function workspaceCheck(path: string): WorkspaceCheckResult {
  return { status: 'ready', present: [path], missing: [], message: 'Codex App Server uses the CodyWork Workspace' }
}

function threadModeOptions(context: RuntimeContext, mode: RuntimePermissionMode): Record<string, unknown> {
  const sandbox = mode === 'read-only' ? 'read-only' : 'workspace-write'
  const approvalPolicy = mode === 'yolo' ? 'never' : mode === 'read-only' ? 'never' : 'on-request'
  return { cwd: context.demandPath ?? context.workspacePath, runtimeWorkspaceRoots: context.effectivePolicy.readableRoots, sandbox, approvalPolicy }
}

function turnModeOptions(context: RuntimeContext, mode: RuntimePermissionMode, planMode: boolean, model: string): Record<string, unknown> {
  const approvalPolicy = mode === 'yolo' ? 'never' : mode === 'read-only' ? 'never' : 'on-request'
  const sandboxPolicy = mode === 'read-only'
    ? { type: 'readOnly', networkAccess: false }
    : { type: 'workspaceWrite', writableRoots: context.effectivePolicy.writableRoots, networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
  return { cwd: context.demandPath ?? context.workspacePath, runtimeWorkspaceRoots: context.effectivePolicy.readableRoots, sandboxPolicy, approvalPolicy, ...(planMode ? { collaborationMode: { mode: 'plan', settings: { model, reasoning_effort: null, developer_instructions: null } } } : {}) }
}

function textFromItem(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const value = item as { type?: unknown; text?: unknown; aggregatedOutput?: unknown }
  if (value.type === 'agentMessage' || value.type === 'plan' || value.type === 'reasoning') return typeof value.text === 'string' ? value.text : ''
  return typeof value.aggregatedOutput === 'string' ? value.aggregatedOutput : ''
}

function itemType(item: unknown): string {
  return item && typeof item === 'object' ? String((item as { type?: unknown }).type ?? '') : ''
}

class CodexProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>()
  private sequence = 1
  private buffer = ''

  private constructor(command: string, env: NodeJS.ProcessEnv, cwd: string) {
    const [file, ...args] = splitCommand(command)
    if (!file) throw new Error('Codex App Server 启动命令不能为空')
    this.child = spawn(file, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.on('data', chunk => this.consume(String(chunk)))
    this.child.on('error', error => this.rejectAll(error))
    this.child.on('exit', (code, signal) => this.rejectAll(new Error(`Codex App Server 已退出（${code ?? signal ?? 'unknown'}）`)))
    this.child.stderr.on('data', () => {})
  }

  static async start(command: string, env: NodeJS.ProcessEnv, cwd: string): Promise<CodexProcess> {
    const process = new CodexProcess(command, env, cwd)
    await process.request('initialize', {
      clientInfo: { name: 'codywork', title: 'CodyWork', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
    return process
  }

  on(listener: (message: JsonRpcMessage) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.sequence++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  respond(id: string | number, result: unknown): void { this.child.stdin.write(`${JSON.stringify({ id, result })}\n`) }

  close(): Promise<void> {
    this.child.stdin.end()
    return new Promise((resolve) => { const timer = setTimeout(() => { this.child.kill('SIGTERM'); resolve() }, 1000); this.child.once('exit', () => { clearTimeout(timer); resolve() }) })
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const index = this.buffer.indexOf('\n')
      if (index < 0) return
      const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line) as JsonRpcMessage
        if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
          const waiter = this.pending.get(message.id); if (!waiter) continue
          this.pending.delete(message.id)
          if (message.error) waiter.reject(new Error(message.error.message ?? 'Codex App Server 请求失败'))
          else waiter.resolve(message.result)
        } else for (const listener of this.listeners) listener(message)
      } catch { /* ignore malformed stderr-like lines on stdout */ }
    }
  }

  private rejectAll(error: Error): void { for (const waiter of this.pending.values()) waiter.reject(error); this.pending.clear() }
}

type CodexConversation = ConversationHandle & { process: CodexProcess; context: RuntimeContext; mode: RuntimePermissionMode; planMode: boolean; model: string; activeTurn: string | undefined; approvals: Map<string, PendingApproval> }

/** Codex App Server implementation of the CodyWork Runtime Adapter. */
export class CodexRuntimeAdapter implements ConversationRuntimeAdapter {
  readonly provider = 'codex'
  private readonly sessions = new Map<string, CodexConversation>()
  private readonly options: CodexOptions

  constructor(options: CodexOptions = {}) { this.options = options }

  async checkConnection(cwd = process.cwd()): Promise<RuntimeManifest> {
    const command = this.options.command?.trim() || 'codex app-server --stdio'
    const processHandle = await CodexProcess.start(command, { ...process.env, ...(this.options.env ?? {}) }, cwd)
    await processHandle.close()
    return this.getManifest()
  }

  async getManifest(): Promise<RuntimeManifest> {
    return { provider: this.provider, runtimeVersion: 'codex-app-server', protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION, streaming: true, resume: true, fork: false, interrupt: true, approvals: true, diffs: true, subagents: true, readPolicy: 'roots', writePolicy: 'roots', shellPolicy: 'allowlist', approval: 'runtime', workspaceInitialize: true, workspaceRepair: false, goals: true, plans: true, questions: true }
  }

  async checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult> { return workspaceCheck(request.workspacePath) }
  async initializeWorkspace(request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult> {
    const context: RuntimeContext = {
      workspacePath: request.workspacePath,
      instructionBundle: resolveInstructionBundle({ workspacePath: request.workspacePath, platformInstructions: request.instruction }),
      effectivePolicy: resolveEffectivePolicy({
        workspacePath: request.workspacePath,
        readableRoots: [request.workspacePath],
        writableRoots: [request.workspacePath],
        shell: 'allowlist',
        approval: 'none',
      }),
    }
    const conversation = await this.createConversation({ context })
    const result = await this.sendTurn({ conversation, prompt: request.instruction })
    return { status: 'initialized', message: result.finalText || 'Codex 已完成 Workspace 初始化。' }
  }

  async createConversation(request: CreateConversationRequest): Promise<ConversationHandle> {
    const process = await this.startProcess(request.context)
    const mode = this.modeFromContext(request.context)
    const result = await process.request('thread/start', { model: this.options.model ?? null, ...threadModeOptions(request.context, mode), baseInstructions: request.context.instructionBundle.systemInstructions, developerInstructions: this.policyInstructions(request.context) }) as { thread?: { id?: string; model?: string } }
    const nativeId = result.thread?.id
    if (!nativeId) { await process.close(); throw new Error('Codex App Server 没有返回 thread id') }
    const handle = { id: request.conversationId ?? `conversation-${randomUUID()}`, provider: this.provider, nativeId, createdAt: nowIso() }
    const model = this.options.model ?? result.thread?.model ?? 'gpt-5.4'
    this.attach({ ...handle, process, context: request.context, mode, planMode: false, model, activeTurn: undefined, approvals: new Map() })
    return handle
  }

  async resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle> {
    const process = await this.startProcess(request.context)
    const mode = this.modeFromContext(request.context)
    await process.request('thread/resume', { threadId: request.nativeId, model: this.options.model ?? null, ...threadModeOptions(request.context, mode), baseInstructions: request.context.instructionBundle.systemInstructions, developerInstructions: this.policyInstructions(request.context) })
    const handle = { id: request.conversationId ?? `conversation-${randomUUID()}`, provider: this.provider, nativeId: request.nativeId, createdAt: nowIso() }
    const model = this.options.model ?? 'gpt-5.4'
    this.attach({ ...handle, process, context: request.context, mode, planMode: false, model, activeTurn: undefined, approvals: new Map() })
    return handle
  }

  async setPermission(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void> {
    const session = this.require(conversation); session.mode = mode
    await session.process.request('thread/settings/update', { threadId: session.nativeId, cwd: session.context.demandPath ?? session.context.workspacePath, approvalPolicy: mode === 'yolo' ? 'never' : mode === 'read-only' ? 'never' : 'on-request', sandboxPolicy: mode === 'read-only' ? { type: 'readOnly', networkAccess: false } : { type: 'workspaceWrite', writableRoots: session.context.effectivePolicy.writableRoots, networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } })
  }

  async sendCommand(request: SendTurnRequest): Promise<SendTurnResult> {
    const session = this.require(request.conversation)
    if (request.prompt.startsWith('/plan')) {
      if (request.prompt === '/plan' || request.prompt === '/plan on') session.planMode = !session.planMode
      else if (request.prompt === '/plan off' || request.prompt === '/plan reject') session.planMode = false
      await session.process.request('thread/settings/update', { threadId: session.nativeId, collaborationMode: { mode: session.planMode ? 'plan' : 'default', settings: { model: session.model, reasoning_effort: null, developer_instructions: null } } })
      return { conversation: request.conversation, finalText: '', events: [] }
    }
    const value = request.prompt.replace(/^\/goal\s*/i, '').trim()
    if (request.prompt.startsWith('/goal')) {
      if (!value || value === 'clear' || value === '清除') await session.process.request('thread/goal/clear', { threadId: session.nativeId })
      else {
        const statusMap: Record<string, string> = { pause: 'paused', 暂停: 'paused', resume: 'active', 恢复: 'active', complete: 'complete', 完成: 'complete' }
        const status = statusMap[value]
        if (status) {
          const current = await session.process.request('thread/goal/get', { threadId: session.nativeId }) as { goal?: { objective?: string } }
          await session.process.request('thread/goal/set', { threadId: session.nativeId, objective: current.goal?.objective ?? '', status })
        } else await session.process.request('thread/goal/set', { threadId: session.nativeId, objective: value, status: 'active' })
      }
    }
    return { conversation: request.conversation, finalText: '', events: [] }
  }

  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> {
    const session = this.require(request.conversation)
    const turn = await session.process.request(request.mode === 'steer' && session.activeTurn ? 'turn/steer' : 'turn/start', request.mode === 'steer' && session.activeTurn
      ? { threadId: session.nativeId, expectedTurnId: session.activeTurn, input: [{ type: 'text', text: request.prompt, text_elements: [] }] }
      : { threadId: session.nativeId, input: [{ type: 'text', text: request.prompt, text_elements: [] }], ...turnModeOptions(session.context, session.mode, session.planMode, session.model) }) as { turn?: { id?: string } }
    const turnId = turn.turn?.id ?? `turn-${randomUUID()}`
    session.activeTurn = turnId
    const events: RuntimeEvent[] = []
    let finalText = ''
    const emit = (type: RuntimeEvent['type'], data: Record<string, unknown>, itemId?: string): void => { const event = { id: randomUUID(), type, conversationId: request.conversation.id, turnId, ...(itemId ? { itemId } : {}), provider: this.provider, timestamp: nowIso(), data }; events.push(event); request.onEvent?.(event) }
    const handler = (message: JsonRpcMessage): void => {
      if (message.id !== undefined && this.isApprovalRequest(message.method)) {
        const approvalId = String(message.params?.approvalId ?? message.id)
        session.approvals.set(approvalId, { rpcId: message.id, conversationId: session.id, kind: 'approval' })
        emit('approval.requested', { approvalId, requestId: message.id, reason: message.params?.reason ?? 'Codex 请求执行受保护操作。', method: message.method, params: message.params ?? {} })
      } else if (message.id !== undefined && message.method === 'item/tool/requestUserInput') {
        const requestId = String(message.id)
        session.approvals.set(requestId, { rpcId: message.id, conversationId: session.id, kind: 'question', questions: Array.isArray(message.params?.questions) ? message.params.questions as Array<{ id?: unknown }> : [] })
        emit('question.requested', { requestId, questions: message.params?.questions ?? [], params: message.params ?? {} })
      } else if (message.method === 'turn/started') emit('turn.started', message.params ?? {})
      else if (message.method === 'turn/completed') { emit('turn.completed', message.params ?? {}); session.activeTurn = undefined }
      else if (message.method === 'item/agentMessage/delta') { const text = String(message.params?.delta ?? ''); finalText += text; const itemId = String(message.params?.itemId ?? ''); emit('message.delta', { text, nativeEvent: message }, itemId) }
      else if (message.method === 'item/reasoning/summaryTextDelta' || message.method === 'item/reasoning/textDelta') {
        const text = String(message.params?.delta ?? '')
        if (text) emit('reasoning.delta', { text, nativeEvent: message }, String(message.params?.itemId ?? ''))
      }
      else if (message.method === 'item/plan/delta') emit('plan.updated', { text: String(message.params?.delta ?? ''), nativeEvent: message }, String(message.params?.itemId ?? ''))
      else if (message.method === 'turn/plan/updated') emit('plan.updated', message.params ?? {})
      else if (message.method === 'turn/diff/updated' || message.method === 'item/fileChange/patchUpdated') emit('diff.updated', message.params ?? {})
      else if (message.method === 'item/commandExecution/outputDelta' || message.method === 'command/exec/outputDelta' || message.method === 'process/outputDelta') emit('tool.completed', { output: String(message.params?.delta ?? ''), nativeEvent: message }, String(message.params?.itemId ?? ''))
      else if (message.method === 'item/fileChange/outputDelta') emit('file.changed', { text: String(message.params?.delta ?? ''), nativeEvent: message }, String(message.params?.itemId ?? ''))
      else if (message.method === 'item/started') this.itemEvent(emit, 'started', message.params?.item, message.params)
      else if (message.method === 'item/completed') this.itemEvent(emit, 'completed', message.params?.item, message.params)
      else if (message.method === 'thread/goal/updated') emit('goal.updated', message.params?.goal && typeof message.params.goal === 'object' ? message.params.goal as Record<string, unknown> : message.params ?? {})
      else if (message.method === 'thread/goal/cleared') emit('goal.updated', { status: 'cleared' })
      else if (message.method === 'serverRequest/resolved') emit('provider.extension', message.params ?? {})
      else if (message.method === 'process/exited') emit('runtime.disconnected', message.params ?? {})
      else if (message.method === 'error') { emit('turn.failed', { error: message.params?.error ?? message.params ?? 'Codex Runtime error' }); session.activeTurn = undefined }
    }
    const off = session.process.on(handler)
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Codex turn 超时')), 10 * 60 * 1000)
        const done = (message: JsonRpcMessage) => { if (message.method === 'turn/completed' || message.method === 'error') { clearTimeout(timer); off(); resolve() } }
        const remove = session.process.on(done)
        void remove
      })
    } finally { off() }
    return { conversation: request.conversation, finalText, events }
  }

  async interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }> {
    const session = this.require(conversation); if (!session.activeTurn) return { supported: false }
    await session.process.request('turn/interrupt', { threadId: session.nativeId, turnId: session.activeTurn }); return { supported: true }
  }

  async respondApproval(conversation: ConversationHandle, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const session = this.require(conversation); const pending = session.approvals.get(approvalId); if (!pending) throw new Error('Codex approval 不存在或已失效')
    session.process.respond(pending.rpcId, { decision: outcome === 'allowed-once' ? 'approved' : { denied: { rejection: 'CodyWork 用户拒绝了本次操作' } } }); session.approvals.delete(approvalId)
  }

  async respondQuestion(conversation: ConversationHandle, requestId: string, answer: unknown): Promise<void> {
    const session = this.require(conversation); const pending = session.approvals.get(requestId); if (!pending) throw new Error('Codex question 不存在或已失效')
    const questionId = pending.questions?.[0]?.id
    const key = typeof questionId === 'string' && questionId ? questionId : 'answer'
    session.process.respond(pending.rpcId, { answers: { [key]: { answers: [String(answer ?? '')] } } }); session.approvals.delete(requestId)
  }

  async close(): Promise<void> { const sessions = [...this.sessions.values()]; this.sessions.clear(); await Promise.allSettled(sessions.map(session => session.process.close())) }

  private async startProcess(context: RuntimeContext): Promise<CodexProcess> {
    const command = this.options.command?.trim() || 'codex app-server --stdio'
    return CodexProcess.start(command, { ...process.env, ...(this.options.env ?? {}) }, context.demandPath ?? context.workspacePath)
  }

  private attach(session: CodexConversation): void {
    this.sessions.set(session.id, session)
    session.process.on((message) => {
      if (!message.method || message.id === undefined) return
      if (this.isApprovalRequest(message.method)) {
        const approvalId = String(message.params?.approvalId ?? message.id); session.approvals.set(approvalId, { rpcId: message.id!, conversationId: session.id, kind: 'approval' })
      }
      if (message.method === 'item/tool/requestUserInput') { const requestId = String(message.id); session.approvals.set(requestId, { rpcId: message.id!, conversationId: session.id, kind: 'question', questions: Array.isArray(message.params?.questions) ? message.params.questions as Array<{ id?: unknown }> : [] }) }
    })
  }

  private isApprovalRequest(method: string | undefined): boolean {
    return method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval' || method === 'execCommandApproval' || method === 'item/permissions/requestApproval'
  }

  private itemEvent(emit: (type: RuntimeEvent['type'], data: Record<string, unknown>, itemId?: string) => void, phase: 'started' | 'completed', item: unknown, params?: Record<string, unknown>): void {
    const type = itemType(item); const id = item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : ''
    const data = { item, nativeEvent: params }
    if (type === 'agentMessage') { const text = textFromItem(item); if (text) emit('message.completed', { text, ...data }, id); return }
    if (type === 'fileChange') { emit(phase === 'completed' ? 'diff.updated' : 'file.changed', data, id); return }
    if (type === 'commandExecution' || type === 'mcpToolCall' || type === 'dynamicToolCall' || type === 'collabAgentToolCall') { emit(phase === 'completed' ? 'tool.completed' : 'tool.started', data, id); return }
    if (type === 'plan') { emit('plan.updated', data, id); return }
    if (type === 'reasoning') {
      const text = textFromItem(item)
      if (text) emit('reasoning.delta', { text, ...data }, id)
    }
  }

  private require(conversation: ConversationHandle): CodexConversation { const session = this.sessions.get(conversation.id); if (!session) throw new Error('Codex conversation runtime is not available'); return session }
  private modeFromContext(context: RuntimeContext): RuntimePermissionMode { return context.effectivePolicy.approval === 'none' ? 'yolo' : context.effectivePolicy.writableRoots.length ? 'workspace-write' : 'read-only' }
  private policyInstructions(context: RuntimeContext): string { return `Effective CSR policy. Readable roots: ${context.effectivePolicy.readableRoots.join(', ')}. Writable roots: ${context.effectivePolicy.writableRoots.join(', ')}. Do not access or modify paths outside these roots.` }
}
