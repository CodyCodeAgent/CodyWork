import type { CodexEvent, CodexEventType } from '@codycodeagent/cody-web-core/conversation'

/** CodyWork product policy and metadata around the shared Codex runtime. */

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
  onEvent?: (event: RuntimeEvent) => void
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

export type RuntimeEventType = CodexEventType

export interface RuntimeEvent extends CodexEvent {
  conversationId: string
  provider: string
  timestamp: string
}

export interface CreateConversationRequest {
  conversationId?: string
  context: RuntimeContext
}

/** A lightweight provider-native thread record suitable for a picker. */
export interface NativeThreadSummary {
  nativeId: string
  preview: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
  source?: string
}

export interface ListNativeThreadsRequest {
  context: RuntimeContext
}

export interface SendTurnRequest {
  conversation: ConversationHandle
  prompt: string
  mode?: 'queue' | 'steer'
  settings?: {
    model?: string
    reasoningEffort?: ReasoningEffort
    /** Provider-native structured skill inputs; never concatenate these into user text. */
    skills?: Array<{ name: string; path: string }>
  }
  onEvent?: (event: RuntimeEvent) => void
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface RuntimeComposerOptions {
  models: string[]
  collaborationModes: Array<{
    name: string
    mode: 'default' | 'plan'
    label: string
    model?: string
    reasoningEffort?: ReasoningEffort | ''
  }>
}

export interface SendTurnResult {
  conversation: ConversationHandle
  finalText: string
  events: RuntimeEvent[]
}

export interface ReadConversationRequest {
  conversation: ConversationHandle
  context: RuntimeContext
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
  /** Lists resumable provider-native threads without attaching one to a Demand. */
  listNativeThreads?(request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]>
  /** Discover provider-supported Composer options without making the UI guess a protocol version. */
  getComposerOptions?(context: RuntimeContext): Promise<RuntimeComposerOptions>
  /** Reads provider-native durable history. CodyWork deliberately does not mirror this in SQLite. */
  readConversation?(request: ReadConversationRequest): Promise<RuntimeEvent[]>
  /** Send a provider-native slash command without adding CodyWork policy prompt text. */
  sendCommand?(request: SendTurnRequest): Promise<SendTurnResult>
  setPermission?(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void>
  respondApproval?(conversation: ConversationHandle, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>
  respondQuestion?(conversation: ConversationHandle, requestId: string, answer: unknown): Promise<void>
}
