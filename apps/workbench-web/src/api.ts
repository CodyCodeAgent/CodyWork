export interface Workspace {
  id: string
  name: string
  path: string
  created_at: string
}

export interface RepoStatus {
  name: string
  branch: string
  dirty: boolean
  lastCommit: string
}

export interface Repo {
  id: string
  workspace_id: string
  name: string
  created_at: string
  status: RepoStatus | null
}

export interface Demand {
  id: string
  workspace_id: string
  name: string
  slug: string
  status: string
  created_at: string
}

export interface Worktree {
  repo: string
  branch: string
  dirty: boolean
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json.data as T
}

export const api = {
  listWorkspaces: () => request<Workspace[]>('GET', '/api/workspaces'),
  createWorkspace: (name: string, path: string, repos: string[] = []) =>
    request<Workspace>('POST', '/api/workspaces', { name, path, repos }),
  deleteWorkspace: (id: string) => request<{ ok: boolean }>('DELETE', `/api/workspaces/${id}`),
  listRepos: (wsId: string) => request<Repo[]>('GET', `/api/workspaces/${wsId}/repos`),
  addRepo: (wsId: string, url: string) => request<{ ok: boolean; name?: string; error?: string }>('POST', `/api/workspaces/${wsId}/repos`, { url }),
  removeRepo: (wsId: string, name: string) => request<{ ok: boolean }>('DELETE', `/api/workspaces/${wsId}/repos/${name}`),
  listDemands: (wsId: string) => request<Demand[]>('GET', `/api/workspaces/${wsId}/demands`),
  createDemand: (wsId: string, name: string) => request<{ id: string; slug: string; status: string }>('POST', `/api/workspaces/${wsId}/demands`, { name }),
  getDemand: (id: string) => request<Demand & { worktrees: Worktree[] }>('GET', `/api/demands/${id}`),
  setDemandStatus: (id: string, status: string) => request<{ ok: boolean; status: string }>('PUT', `/api/demands/${id}/status`, { status }),
  generateSdd: (demandId: string, step: string) => request<{ step: string; content: string }>('POST', `/api/demands/${demandId}/sdd/${step}`),
  compound: (demandId: string) => request<{ report: string }>('POST', `/api/demands/${demandId}/compound`),
  getChat: (demandId: string) => request<{ messages: { role: string; content: string }[] }>('GET', `/api/demands/${demandId}/chat`),
  sendChat: (demandId: string, message: string) => request<{ messages: { role: string; content: string }[] }>('POST', `/api/demands/${demandId}/chat`, { message }),
  createWorktrees: (demandId: string, repos: string[]) => request<{ results: { ok: boolean; path?: string; error?: string }[] }>('POST', `/api/demands/${demandId}/worktrees`, { repos }),
  listDocs: (wsId: string) => request<{ files: string[] }>('GET', `/api/workspaces/${wsId}/docs`),
  readDoc: (wsId: string, path: string) => request<{ path: string; content: string }>('GET', `/api/workspaces/${wsId}/docs/${path}`),
  writeDoc: (wsId: string, path: string, content: string) => request<{ ok: boolean }>('PUT', `/api/workspaces/${wsId}/docs/${path}`, { content }),
  search: (wsId: string, q: string) => request<{ query: string; hits: { path: string; snippet: string }[]; total: number }>('GET', `/api/workspaces/${wsId}/search?q=${encodeURIComponent(q)}`),
  rebuildSearch: (wsId: string) => request<{ indexed: number }>('POST', `/api/workspaces/${wsId}/search/rebuild`),
  troubleshoot: (wsId: string, question: string) => request<{ answer: string }>('POST', `/api/workspaces/${wsId}/troubleshoot`, { question }),
}
