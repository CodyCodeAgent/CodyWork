import { randomUUID } from 'node:crypto'
import { nowIso } from '../../src/db/index.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION } from '../../src/runtime/protocol.js'
import type {
  ConversationHandle,
  CodyWorkRuntime,
  CreateConversationRequest,
  ListNativeThreadsRequest,
  NativeThreadSummary,
  ReadConversationRequest,
  RuntimeContext,
  RuntimeEvent,
  RuntimePermissionMode,
  SendTurnRequest,
  SendTurnResult,
  SubmitTurnResult,
  WorkspaceCheckRequest,
  WorkspaceCheckResult,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResult,
} from '../../src/runtime/protocol.js'

/** Deterministic adapter available only to protocol and service tests. */
export class TestRuntimeAdapter implements CodyWorkRuntime {
  private readonly conversations = new Map<string, ConversationHandle>()
  private readonly contexts = new Map<string, RuntimeContext>()
  private readonly history = new Map<string, RuntimeEvent[]>()

  async getInfo() { return { runtimeVersion: 'test-1.0.0', protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION } }

  async checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult> { return { status: 'ready', present: [request.workspacePath], missing: [], message: 'test runtime accepts the Workspace' } }
  async initializeWorkspace(_request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult> { return { status: 'unsupported', message: 'test runtime does not initialize Workspaces' } }

  async createConversation(request: CreateConversationRequest): Promise<ConversationHandle> {
    const id = request.conversationId ?? `conversation-${randomUUID()}`
    const conversation = { id, nativeId: id, createdAt: nowIso() }
    this.conversations.set(id, conversation); this.contexts.set(id, request.context)
    if (!this.history.has(conversation.nativeId)) this.history.set(conversation.nativeId, [])
    return conversation
  }

  async resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle> {
    const id = request.conversationId ?? request.nativeId
    const conversation = { id, nativeId: request.nativeId, createdAt: nowIso() }
    this.conversations.set(id, conversation); this.contexts.set(id, request.context)
    if (!this.history.has(conversation.nativeId)) this.history.set(conversation.nativeId, [])
    return conversation
  }

  async readConversationSnapshot(request: ReadConversationRequest): Promise<{ events: RuntimeEvent[]; watermark: number }> {
    return { events: this.history.get(request.nativeId) ?? [], watermark: 0 }
  }

  async listNativeThreads(_request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]> {
    return [
      { nativeId: 'thread-existing-123', preview: 'Continue existing context', cwd: '/test/project', updatedAt: '2026-08-24T00:00:00.000Z', source: 'cli' },
      { nativeId: 'thread-unbound-456', preview: 'Implement demand picker', cwd: '/test/project', updatedAt: '2026-08-23T00:00:00.000Z', source: 'appServer' },
    ]
  }

  async setPermission(_conversation: ConversationHandle, _mode: RuntimePermissionMode): Promise<void> {}
  async renameConversation(conversation: ConversationHandle, _title: string): Promise<void> {
    if (!this.conversations.has(conversation.id)) throw new Error('conversation does not belong to this adapter')
  }
  async resolveSkills(context: RuntimeContext, skillIds: string[]): Promise<Array<{ name: string; path: string }>> {
    const byPath = new Map(context.instructionBundle.skills.map(skill => [skill.path, skill]))
    return skillIds.map(id => {
      const skill = byPath.get(id)
      if (!skill) throw new Error(`Skill 不存在、已禁用或不适用于当前上下文：${id}`)
      return { name: skill.name, path: skill.path }
    })
  }

  submitTurn(request: SendTurnRequest): SubmitTurnResult {
    if (!this.conversations.has(request.conversation.id)) throw new Error('conversation does not belong to this adapter')
    const clientCommandId = request.clientCommandId ?? `command-${randomUUID()}`
    const turnId = `turn-${randomUUID()}`
    const events: RuntimeEvent[] = []
    const emit = (type: RuntimeEvent['type'], data: Record<string, unknown>, options: { native?: boolean; turnId?: string } = {}): void => {
      const timestamp = nowIso()
      const event: RuntimeEvent = {
        id: randomUUID(), type, conversationId: request.conversation.id, threadId: request.conversation.nativeId,
        ...(options.turnId === '' ? {} : { turnId: options.turnId ?? turnId }),
        timestamp, atIso: timestamp, data,
      }
      if (options.native !== false) events.push(event)
      request.onEvent?.(event)
    }
    emit('command.queued', { clientCommandId, text: request.prompt }, { native: false, turnId: '' })
    emit('command.bound', { clientCommandId, nativeTurnId: turnId }, { native: false })
    const completed = Promise.resolve().then(() => {
      emit('user.completed', { text: request.prompt })
      emit('turn.started', { prompt: request.prompt })
      emit('tool.started', { tool: { kind: 'command', title: 'Policy check', status: 'running', summary: 'csr.policy.check', details: [] } })
      const context = this.contexts.get(request.conversation.id)
      emit('assistant.delta', { text: `Test runtime received: ${request.prompt}\n\nCSR roots: ${context?.effectivePolicy.writableRoots.join(', ') || 'read-only'}` })
      emit('tool.completed', { tool: { kind: 'command', title: 'Policy check', status: 'completed', summary: 'csr.policy.check', details: [] } })
      emit('turn.completed', { status: 'completed' })
      this.history.set(request.conversation.nativeId, events)
      return { conversation: request.conversation, finalText: `Test runtime received: ${request.prompt}`, events }
    })
    return { clientCommandId, started: Promise.resolve({ threadId: request.conversation.nativeId, turnId }), completed }
  }

  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> {
    return this.submitTurn(request).completed
  }

  async interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }> { return { supported: this.conversations.has(conversation.id) } }
  async close(): Promise<void> { this.conversations.clear(); this.contexts.clear(); this.history.clear() }
}
