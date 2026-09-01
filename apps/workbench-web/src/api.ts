import type { CodexEvent } from '@codycodeagent/cody-web-core/conversation'

export interface WorkspaceSummary {
  entries: string[]
  isGit: boolean
  isRecognized: boolean
  check: {
    status: 'ready' | 'empty' | 'incomplete' | 'unsupported'
    present: string[]
    missing: string[]
    message: string
  }
  runtime: { status: 'ready'; cwd: string; note: string }
}

export interface Workspace {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
  active: boolean
}

export type WorkspaceSource =
  | { type: 'folder'; path: string }
  | { type: 'git'; url: string; destination: string }

export interface WorkspaceSetupJob {
  id: string
  status: 'running' | 'completed' | 'failed'
  stage: 'preflight' | 'agent' | 'verify' | 'register' | 'completed' | 'failed'
  progress: number
  title: string
  prompt: string
  response: string
  events: Array<{ type: string; timestamp: string; text: string }>
  workspace?: Workspace
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface DirectoryListing {
  roots: Array<{ name: string; path: string }>
  current: string
  parent: string | null
  directories: Array<{ name: string; path: string }>
}

export interface DashboardSnapshot {
  generatedAt: string
  demands: { total: number; inProgress: number; completed: number; blocked: number }
  repositories: { total: number; normal: number; dirty: number; pullFailed: number }
  codeChanges: { additions: number; deletions: number; filesChanged: number }
  knowledge: { documents: number; lastUpdatedAt: string | null }
  skills: { available: number; disabled: number; loadFailed: number }
  cache: {
    state: 'fresh' | 'stale' | 'refreshing' | 'empty'
    generatedAt: string | null
    ageSeconds: number | null
    lastError: string | null
  }
}

export type SkillStatus = 'available' | 'disabled' | 'load_failed'
export interface WorkspaceSkill {
  id: string
  name: string
  description: string
  path: string
  source: 'workspace' | 'user'
  status: SkillStatus
  modelInvocable: boolean
  content: string
  updatedAt: string
}

export interface SkillInstallEvent {
  type: string
  timestamp?: string
  data: Record<string, unknown>
}
export interface SkillInstallStatus {
  id: string
  workspaceId: string
  source: string
  status: 'running' | 'completed' | 'failed'
  message?: string
  events: SkillInstallEvent[]
  installed?: Array<{ id: string; name: string; path: string; status: string }>
  startedAt: string
  finishedAt?: string
}

export interface KnowledgeDocument {
  id: string
  name: string
  relativePath: string
  path: string
  extension: string
  size: number
  updatedAt: string
  content?: string
}

export interface Repository {
  id: string
  name: string
  path: string
  originUrl: string | null
  defaultRef: string | null
  syncStatus: 'ok' | 'pull_failed'
  dirty: boolean
}

export interface Demand {
  id: string
  name: string
  branchName: string
  worktreeKey: string
  path: string
  status: 'in_progress' | 'completed' | 'blocked'
  createdAt: string
  updatedAt: string
  repositories: { id: string; name: string; worktreePath: string }[]
}

export interface ExistingWorktreeImportResult {
  imported: Array<{ id: string; name: string; branchName: string; worktreeKey: string; repositories: number }>
  skipped: Array<{ worktreeKey: string; reason: string }>
}

export type ConversationPermissionMode = 'read-only' | 'workspace-write' | 'yolo'
export type ConversationStatus = 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'disconnected'

export interface Conversation {
  id: string
  demandId: string
  nativeId: string
  title: string
  status: ConversationStatus
  permissionMode: ConversationPermissionMode
  policyHash: string
  instructionHash: string
  createdAt: string
  updatedAt: string
}

export interface ConversationEvent extends CodexEvent {
  conversationId: string
  timestamp?: string
}

export interface AvailableNativeThread {
  nativeId: string
  preview: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
  source?: string
  bound: boolean
}

export interface ComposerOptions {
  models: string[]
  skills: Array<{ id: string; name: string; label: string; description: string }>
  collaborationModes: Array<{ name: string; mode: 'default' | 'plan'; label: string; model?: string; reasoningEffort?: string }>
}

export interface RuntimeSettings {
  command: string
  updatedAt: string
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, cache: 'no-store' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await fetch(path, init)
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; data?: T; error?: string }
  if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `请求失败（${response.status}）`)
  return payload.data as T
}

export const api = {
  testRuntime: () => request<{ runtimeVersion: string; protocolVersion: string }>('POST', '/api/runtime/test'),
  runtimeSettings: () => request<RuntimeSettings>('GET', '/api/settings/runtime'),
  updateRuntimeSettings: (patch: { command?: string }) =>
    request<RuntimeSettings>('PATCH', '/api/settings/runtime', patch),
  listWorkspaces: () => request<Workspace[]>('GET', '/api/workspaces'),
  listDirectories: (path?: string) => request<DirectoryListing>('GET', `/api/filesystem/directories${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  createWorkspace: (source: WorkspaceSource, name?: string) =>
    request<{ workspace: Workspace; summary: WorkspaceSummary; action: 'adopted' | 'initialize'; initialization: { status: 'initialized' | 'unsupported'; message: string }; created: boolean }>('POST', '/api/workspaces', { source, name }),
  startWorkspaceSetup: (source: WorkspaceSource, name?: string) =>
    request<WorkspaceSetupJob>('POST', '/api/workspace-setup', { source, name }),
  workspaceSetupStatus: (jobId: string) => request<WorkspaceSetupJob>('GET', `/api/workspace-setup/${encodeURIComponent(jobId)}`),
  getWorkspace: (id: string) => request<{ workspace: Workspace; summary: WorkspaceSummary }>('GET', `/api/workspaces/${id}`),
  openWorkspace: (id: string) => request<{ workspace: Workspace; summary: WorkspaceSummary }>('POST', `/api/workspaces/${id}/open`),
  deleteWorkspace: (id: string) => request<{ deleted: true }>('DELETE', `/api/workspaces/${id}`),
  dashboard: (id: string) => request<DashboardSnapshot>('GET', `/api/workspaces/${id}/dashboard`),
  refreshDashboard: (id: string) => request<DashboardSnapshot>('POST', `/api/workspaces/${id}/dashboard/refresh`),
  listSkills: (id: string) => request<WorkspaceSkill[]>('GET', `/api/workspaces/${id}/skills`),
  getSkill: (id: string, skillId: string) => request<WorkspaceSkill>('GET', `/api/workspaces/${id}/skills/${encodeURIComponent(skillId)}`),
  installSkill: (id: string, source: string) => request<{ jobId: string; source: string }>('POST', `/api/workspaces/${id}/skills`, { source }),
  skillInstallStatus: (id: string, jobId: string) => request<SkillInstallStatus>('GET', `/api/workspaces/${id}/skills/install/${encodeURIComponent(jobId)}`),
  listKnowledge: (id: string) => request<KnowledgeDocument[]>('GET', `/api/workspaces/${id}/knowledge`),
  getKnowledge: (id: string, documentId: string) => request<KnowledgeDocument>('GET', `/api/workspaces/${id}/knowledge/${encodeURIComponent(documentId)}`),
  listRepositories: (id: string) => request<Repository[]>('GET', `/api/workspaces/${id}/repositories`),
  addRepository: (id: string, input: { source: 'git' | 'folder'; url?: string; path?: string; name?: string }) =>
    request<Repository>('POST', `/api/workspaces/${id}/repositories`, input),
  listDemands: (id: string) => request<Demand[]>('GET', `/api/workspaces/${id}/demands`),
  importExistingWorktrees: (id: string) => request<ExistingWorktreeImportResult>('POST', `/api/workspaces/${id}/worktrees/import`),
  createDemand: (id: string, input: { name: string; branchName?: string; repositoryIds: string[] }) =>
    request<{ demand: { id: string; name: string; branch_name: string; worktree_key: string; status: Demand['status'] }; repositories: Demand['repositories'] }>('POST', `/api/workspaces/${id}/demands`, input),
  getDemand: (workspaceId: string, demandId: string) => request<Demand>('GET', `/api/workspaces/${workspaceId}/demands/${demandId}`),
  addRepositoryToDemand: (workspaceId: string, demandId: string, repositoryId: string) =>
    request<Demand>('POST', `/api/workspaces/${workspaceId}/demands/${demandId}/repositories`, { repositoryId }),
  listConversations: (workspaceId: string, demandId: string) =>
    request<Conversation[]>('GET', `/api/workspaces/${workspaceId}/demands/${demandId}/conversations`),
  listAvailableNativeThreads: (workspaceId: string, demandId: string) =>
    request<AvailableNativeThread[]>('GET', `/api/workspaces/${workspaceId}/demands/${demandId}/available-threads`),
  composerOptions: (workspaceId: string, demandId: string) =>
    request<ComposerOptions>('GET', `/api/workspaces/${workspaceId}/demands/${demandId}/composer-options`),
  createConversation: (workspaceId: string, demandId: string, title?: string) =>
    request<Conversation>('POST', `/api/workspaces/${workspaceId}/demands/${demandId}/conversations`, title ? { title } : {}),
  bindConversation: (workspaceId: string, demandId: string, input: { nativeId: string; title?: string }) =>
    request<Conversation>('POST', `/api/workspaces/${workspaceId}/demands/${demandId}/conversations/bind`, input),
  conversationHistory: (workspaceId: string, conversationId: string) =>
    request<{ events: ConversationEvent[]; watermark: number }>('GET', `/api/workspaces/${workspaceId}/conversations/${conversationId}/history`),
  sendMessage: (workspaceId: string, conversationId: string, clientCommandId: string, content: string, mode: 'queue' | 'steer' = 'queue', settings?: { model?: string; reasoningEffort?: string; collaborationMode?: 'default' | 'plan'; skills?: string[] }) =>
    request<{ accepted: true; commandId: string }>('POST', `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`, { clientCommandId, content, mode, ...(settings ?? {}) }),
  interruptConversation: (workspaceId: string, conversationId: string) =>
    request<{ supported: boolean }>('POST', `/api/workspaces/${workspaceId}/conversations/${conversationId}/interrupt`),
  setConversationPermission: (workspaceId: string, conversationId: string, mode: ConversationPermissionMode) =>
    request<Conversation>('POST', `/api/workspaces/${workspaceId}/conversations/${conversationId}/permission`, { mode }),
  renameConversation: (workspaceId: string, conversationId: string, title: string) =>
    request<Conversation>('PATCH', `/api/workspaces/${workspaceId}/conversations/${conversationId}`, { title }),
  deleteConversation: (workspaceId: string, conversationId: string) =>
    request<{ deleted: true }>('DELETE', `/api/workspaces/${workspaceId}/conversations/${conversationId}`),
  resolveApproval: (workspaceId: string, conversationId: string, approvalId: string, outcome: 'allowed-once' | 'rejected') =>
    request<{ resolved: true }>('POST', `/api/workspaces/${workspaceId}/conversations/${conversationId}/approvals/${encodeURIComponent(approvalId)}`, { outcome }),
  answerQuestion: (workspaceId: string, conversationId: string, requestId: string, answer: unknown) =>
    request<{ resolved: true }>('POST', `/api/workspaces/${workspaceId}/conversations/${conversationId}/questions/${encodeURIComponent(requestId)}`, { answer }),
}
