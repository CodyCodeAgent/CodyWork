import { randomUUID } from 'node:crypto'
import { nowIso } from '../../src/db/index.js'
import { WORKBENCH_RUNTIME_PROTOCOL_VERSION } from '../../src/runtime/protocol.js'
import type {
  ConversationHandle,
  ConversationRuntimeAdapter,
  CreateConversationRequest,
  ListNativeThreadsRequest,
  NativeThreadSummary,
  ReadConversationRequest,
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
} from '../../src/runtime/protocol.js'

/** Deterministic adapter available only to protocol and service tests. */
export class TestRuntimeAdapter implements ConversationRuntimeAdapter {
  readonly provider = 'test'
  private readonly conversations = new Map<string, ConversationHandle>()
  private readonly contexts = new Map<string, RuntimeContext>()
  private readonly history = new Map<string, RuntimeEvent[]>()

  async getManifest(): Promise<RuntimeManifest> {
    return { provider: this.provider, runtimeVersion: 'test-1.0.0', protocolVersion: WORKBENCH_RUNTIME_PROTOCOL_VERSION, streaming: true, resume: true, fork: false, interrupt: true, approvals: true, diffs: true, subagents: false, readPolicy: 'roots', writePolicy: 'roots', shellPolicy: 'disabled', approval: 'workbench', workspaceInitialize: false, workspaceRepair: false, goals: true, plans: true, questions: true }
  }

  async checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult> { return { status: 'ready', present: [request.workspacePath], missing: [], message: 'test runtime accepts the Workspace' } }
  async initializeWorkspace(_request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult> { return { status: 'unsupported', message: 'test runtime does not initialize Workspaces' } }

  async createConversation(request: CreateConversationRequest): Promise<ConversationHandle> {
    const id = request.conversationId ?? `conversation-${randomUUID()}`
    const conversation = { id, provider: this.provider, nativeId: id, createdAt: nowIso() }
    this.conversations.set(id, conversation); this.contexts.set(id, request.context)
    if (!this.history.has(conversation.nativeId)) this.history.set(conversation.nativeId, [])
    return conversation
  }

  async resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle> {
    const id = request.conversationId ?? request.nativeId
    const conversation = { id, provider: this.provider, nativeId: request.nativeId, createdAt: nowIso() }
    this.conversations.set(id, conversation); this.contexts.set(id, request.context)
    if (!this.history.has(conversation.nativeId)) this.history.set(conversation.nativeId, [])
    return conversation
  }

  async readConversation(request: ReadConversationRequest): Promise<RuntimeEvent[]> { return this.history.get(request.conversation.nativeId) ?? [] }

  async listNativeThreads(_request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]> {
    return [
      { nativeId: 'thread-existing-123', preview: 'Continue existing context', cwd: '/test/project', updatedAt: '2026-08-24T00:00:00.000Z', source: 'cli' },
      { nativeId: 'thread-unbound-456', preview: 'Implement demand picker', cwd: '/test/project', updatedAt: '2026-08-23T00:00:00.000Z', source: 'appServer' },
    ]
  }

  async setPermission(_conversation: ConversationHandle, _mode: RuntimePermissionMode): Promise<void> {}

  async sendTurn(request: SendTurnRequest): Promise<SendTurnResult> {
    if (!this.conversations.has(request.conversation.id)) throw new Error('conversation does not belong to this adapter')
    const turnId = `turn-${randomUUID()}`
    const events: RuntimeEvent[] = []
    const emit = (type: RuntimeEvent['type'], data: Record<string, unknown>): void => {
      const event: RuntimeEvent = { id: randomUUID(), type, conversationId: request.conversation.id, turnId, provider: this.provider, timestamp: nowIso(), data }
      events.push(event); request.onEvent?.(event)
    }
    emit('turn.started', { prompt: request.prompt })
    emit('item.started', { name: 'csr.policy.check', status: 'running' })
    const context = this.contexts.get(request.conversation.id)
    emit('message.delta', { text: `Test runtime received: ${request.prompt}\n\nCSR roots: ${context?.effectivePolicy.writableRoots.join(', ') || 'read-only'}` })
    emit('item.completed', { name: 'csr.policy.check', status: 'completed' })
    emit('turn.completed', { status: 'completed' })
    this.history.set(request.conversation.nativeId, events)
    return { conversation: request.conversation, finalText: `Test runtime received: ${request.prompt}`, events }
  }

  async interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }> { return { supported: this.conversations.has(conversation.id) } }
  async close(): Promise<void> { this.conversations.clear(); this.contexts.clear(); this.history.clear() }
}
