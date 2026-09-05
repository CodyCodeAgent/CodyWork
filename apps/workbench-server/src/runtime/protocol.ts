import type { CodexEvent, CodexEventType } from '@codycodeagent/cody-web-core/conversation'

/** CodyWork product policy and metadata around the shared Codex runtime. */

export const WORKBENCH_RUNTIME_PROTOCOL_VERSION = '1.0'

export type RuntimeShellPolicy = 'disabled' | 'allowlist' | 'full'
export type RuntimeApprovalMode = 'runtime' | 'workbench' | 'none'
export type RuntimePermissionMode = 'read-only' | 'workspace-write' | 'yolo'
export type RuntimeCollaborationMode = 'default' | 'plan'

export interface CodexRuntimeInfo {
  runtimeVersion: string
  protocolVersion: string
}

export interface RuntimeInstructionSource {
  kind: 'platform' | 'charter' | 'workspace' | 'repository' | 'demand' | 'knowledge' | 'skill'
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
  /** Empty means file reads are unrestricted; write access is always governed separately. */
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
  nativeId: string
  createdAt: string
}

export type RuntimeEventType = CodexEventType

export interface RuntimeEvent extends CodexEvent {
  conversationId: string
  timestamp: string
}

export interface CreateConversationRequest {
  conversationId?: string
  context: RuntimeContext
}

/** A lightweight native Codex thread record suitable for a picker. */
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
  /** Server-resolved local image paths. The browser never supplies these. */
  localImages?: Array<{ path: string }>
  /** Stable product command id. This is an outbox identity, never a native Turn id. */
  clientCommandId?: string
  mode?: 'queue' | 'steer'
  settings?: {
    model?: string
    reasoningEffort?: ReasoningEffort
    /** Turn-scoped collaboration mode. It is never mirrored into CodyWork storage. */
    collaborationMode?: RuntimeCollaborationMode
    /** Provider-native structured skill inputs; never concatenate these into user text. */
    skills?: Array<{ name: string; path: string }>
  }
  onEvent?: (event: RuntimeEvent) => void
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type RuntimeSkillScope = 'user' | 'repo' | 'system' | 'admin'

/** Provider-authoritative Skill metadata. The path is the stable identity used
 * by every CodyWork surface and by native structured Turn inputs. */
export interface RuntimeSkillCatalogEntry {
  id: string
  name: string
  label: string
  description: string
  path: string
  scope: RuntimeSkillScope
  enabled: boolean
}

export interface RuntimeSkillCatalogRequest {
  workspacePath: string
  demandPath?: string
  forceReload?: boolean
}

export interface RuntimeComposerOptions {
  models: string[]
  /** Provider-authoritative skills. `id` is the opaque value returned by the Composer. */
  skills: RuntimeSkillCatalogEntry[]
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

export interface SubmitTurnResult {
  clientCommandId: string
  started: Promise<{ threadId: string; turnId: string }>
  completed: Promise<SendTurnResult>
}

export interface ReadConversationRequest {
  conversationId: string
  nativeId: string
  context: RuntimeContext
}

/** A Core-owned durable history snapshot and the realtime watermark that
 * bounds it. Products must apply only events newer than this watermark. */
export interface RuntimeConversationSnapshot {
  events: RuntimeEvent[]
  watermark: number
}

/** CodyWork's product port to the shared Codex runtime. */
export interface CodyWorkRuntime {
  getInfo(): Promise<CodexRuntimeInfo>
  checkWorkspace(request: WorkspaceCheckRequest): Promise<WorkspaceCheckResult>
  initializeWorkspace(request: WorkspaceInitializationRequest): Promise<WorkspaceInitializationResult>
  createConversation(request: CreateConversationRequest): Promise<ConversationHandle>
  /** Renames the native Codex Thread owned by this conversation. */
  renameConversation(conversation: ConversationHandle, title: string): Promise<void>
  /** Accepts an outbox command immediately; Core owns queueing and native Turn binding. */
  submitTurn(request: SendTurnRequest): SubmitTurnResult
  sendTurn(request: SendTurnRequest): Promise<SendTurnResult>
  interrupt(conversation: ConversationHandle): Promise<{ supported: boolean }>
  /** Releases a short-lived product binding without stopping the shared App Server owner. */
  releaseConversation?(conversation: ConversationHandle): void
  close(): Promise<void>
  /** Bounded runtime diagnostics suitable for an authenticated product surface. */
  diagnostics?(): unknown
  resumeConversation(request: CreateConversationRequest & { nativeId: string }): Promise<ConversationHandle>
  /** Lists resumable native Codex threads without attaching one to a Demand. */
  listNativeThreads(request: ListNativeThreadsRequest): Promise<NativeThreadSummary[]>
  /** Discover runtime-supported Composer options without making the UI guess a protocol version. */
  getComposerOptions(context: RuntimeContext): Promise<RuntimeComposerOptions>
  /** The single provider-authoritative Skill catalog used by management,
   * quick actions and the Composer. */
  listSkillCatalog(request: RuntimeSkillCatalogRequest): Promise<RuntimeSkillCatalogEntry[]>
  /** Resolve opaque Composer skill ids to native structured inputs. */
  resolveSkills(context: RuntimeContext, skillIds: string[]): Promise<Array<{ name: string; path: string }>>
  /** Reads a Core-owned durable snapshot. CodyWork deliberately does not
   * mirror conversation history in SQLite or maintain its own cursor. */
  readConversationSnapshot(request: ReadConversationRequest): Promise<RuntimeConversationSnapshot>
  /** Authoritative owner-process state. Products may guard actions with this
   * snapshot but must never persist or independently advance it. */
  sessionSnapshot?(conversation: ConversationHandle): import('@codycodeagent/cody-web-core/session').CodexSessionSnapshot | null
  /** One product stream per attached conversation. Submission callbacks are
   * not a second broadcast channel. */
  subscribeConversation?(conversation: ConversationHandle, listener: (event: RuntimeEvent) => void): () => void
  /** Refreshes an attached conversation's Demand-scoped execution context. */
  updateContext(conversation: ConversationHandle, context: RuntimeContext): Promise<void>
  setPermission(conversation: ConversationHandle, mode: RuntimePermissionMode): Promise<void>
  respondApproval(conversation: ConversationHandle, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>
  respondQuestion(conversation: ConversationHandle, requestId: string, answer: unknown): Promise<void>
}
