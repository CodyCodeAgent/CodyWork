/**
 * Vendor-neutral contract between CodyWork and an Agent Runtime.
 *
 * Codex App Server is the only shipping adapter. Product code depends on
 * these types and standard events so the boundary stays explicit.
 */

export const WORKBENCH_RUNTIME_PROTOCOL_VERSION = '1.0'

export type RuntimePolicyRootMode = 'workspace' | 'roots' | 'brokered'
export type RuntimeShellPolicy = 'disabled' | 'allowlist' | 'full'
export type RuntimeApprovalMode = 'runtime' | 'workbench' | 'none'
export type RuntimePermissionMode = 'read-only' | 'workspace-write' | 'yolo'

export interface RuntimeManifest {
  provider: string
  runtimeVersion: string
  protocolVersion: string
  streaming: boolean
  resume: boolean
  fork: boolean
  interrupt: boolean
  approvals: boolean
  diffs: boolean
  subagents: boolean
  readPolicy: RuntimePolicyRootMode
  writePolicy: RuntimePolicyRootMode
  shellPolicy: RuntimeShellPolicy
  approval: RuntimeApprovalMode
  workspaceInitialize: boolean
  workspaceRepair: boolean
  goals?: boolean
  plans?: boolean
  questions?: boolean
}

export interface RuntimeInstructionSource {
  kind: 'platform' | 'charter' | 'workspace' | 'repository' | 'demand' | 'skill'
  path?: string
  label: string
  sha256: string
  content: string
}

export interface InstructionBundle {
  systemInstructions: string
  sources: RuntimeInstructionSource[]
  skills: { name: string; path: string; sha256: string }[]
  sha256: string
}

export interface EffectivePolicy {
  readableRoots: string[]
  writableRoots: string[]
  deniedRoots: string[]
  shell: RuntimeShellPolicy
  approval: RuntimeApprovalMode
  hash: string
}

export interface RuntimeContext {
  workspacePath: string
  demandPath?: string
  instructionBundle: InstructionBundle
  effectivePolicy: EffectivePolicy
}

export interface WorkspaceCheckRequest {
  workspacePath: string
}

export interface WorkspaceCheckResult {
  status: 'ready' | 'empty' | 'unsupported' | 'error'
  present: string[]
  missing: string[]
  message: string
}

export interface WorkspaceInitializationRequest extends WorkspaceCheckRequest {
  instruction: string
}

export interface WorkspaceInitializationResult {
  status: 'initialized' | 'unsupported' | 'error'
  message: string
}

export interface ConversationHandle {
  id: string
  provider: string
  nativeId: string
  createdAt: string
}

export type RuntimeEventType =
  | 'conversation.created'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'message.delta'
  | 'message.user'
  | 'message.completed'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.completed'
  | 'item.started'
  | 'item.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'question.requested'
  | 'question.resolved'
  | 'goal.updated'
  | 'plan.updated'
  | 'file.changed'
  | 'diff.updated'
  | 'runtime.disconnected'
  | 'provider.extension'

export interface RuntimeEvent {
  id: string
  type: RuntimeEventType
  conversationId: string
  turnId?: string
  itemId?: string
  provider: string
  timestamp: string
  data: Record<string, unknown>
}

export interface CreateConversationRequest {
  conversationId?: string
  context: RuntimeContext
}

export interface SendTurnRequest {
  conversation: ConversationHandle
  prompt: string
  mode?: 'queue' | 'steer'
  onEvent?: (event: RuntimeEvent) => void
}

export interface SendTurnResult {
  conversation: ConversationHandle
  finalText: string
  events: RuntimeEvent[]
}

export interface RuntimeAdapter {
  readonly provider: string
  getManifest(): Promise<RuntimeManifest>
  checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult>
  initializeWorkspace(request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult>
  createConversation(request: CreateConversationRequest): Promise<ConversationHandle>
  sendTurn(request: SendTurnRequest): Promise<SendTurnResult>
  interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }>
  close(): Promise<void>
}

/** Optional long-lived capabilities used by the CodyWork conversation facade. */
export interface ConversationRuntimeAdapter extends RuntimeAdapter {
  resumeConversation?(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle>
  /** Send a provider-native slash command without adding CodyWork policy prompt text. */
  sendCommand?(request: SendTurnRequest): Promise<SendTurnResult>
  setPermission?(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void>
  respondApproval?(conversation: ConversationHandle, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>
  respondQuestion?(conversation: ConversationHandle, requestId: string, answer: unknown): Promise<void>
}
