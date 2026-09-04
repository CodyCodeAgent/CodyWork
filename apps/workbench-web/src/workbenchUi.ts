import type { AvailableNativeThread, Conversation, DashboardSnapshot, Demand, WorkspaceSkill } from './api'
import type { ConversationState } from '@codycodeagent/cody-web-core/conversation'

export type HistoryMode = 'push' | 'replace' | 'none'
export type WorkbenchStaticPage = 'dashboard' | 'demands' | 'knowledge' | 'skills' | 'settings'
export type WorkbenchSettingsSection = 'overview' | 'runtime' | 'quick-actions'
export interface WorkbenchRoute { workspaceId: string | null; demandId: string | null; page: WorkbenchStaticPage; settingsSection: WorkbenchSettingsSection }
export interface ThreadProject { cwd: string; name: string; count: number; relatedToDemand: boolean }

export function skillSourceLabel(source: WorkspaceSkill['source'] | ComposerSkillSource): string {
  if (source === 'workspace' || source === 'repo') return 'Workspace'
  if (source === 'user') return 'Codex 全局'
  if (source === 'system') return 'Codex 内置'
  return '管理员'
}

type ComposerSkillSource = 'repo' | 'user' | 'system' | 'admin'
type NamedSkill = { id: string; name: string }

export function sameNameSkills<T extends NamedSkill>(skills: T[], selected: NamedSkill): T[] {
  const name = selected.name.trim().toLocaleLowerCase()
  if (!name) return []
  return skills.filter(skill => skill.id !== selected.id && skill.name.trim().toLocaleLowerCase() === name)
}

export function skillIdentityDescription<T extends NamedSkill>(skills: T[], selected: NamedSkill): string {
  return sameNameSkills(skills, selected).length ? '同名 Skill 按完整路径精确区分' : ''
}

export function filterSkills(skills: WorkspaceSkill[], query: string): WorkspaceSkill[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return skills
  return skills.filter(skill => [
    skill.name,
    skill.displayName,
    skill.description,
    skill.path,
    skillSourceLabel(skill.source),
  ].join(' ').toLowerCase().includes(needle))
}

export function skillSearchSummary(total: number, filtered: number, query: string): string {
  return query.trim() ? `匹配 ${filtered} / ${total}` : `${total}`
}

export function conversationStatusLabel(status: Conversation['status']): string {
  if (status === 'idle') return '就绪'
  if (status === 'running') return '执行中'
  if (status === 'awaiting_approval') return '待确认'
  if (status === 'failed') return '失败'
  if (status === 'disconnected') return '已断开'
  return '已完成'
}

export function canDeleteConversation(conversation: Conversation, total: number): boolean {
  return total > 1 && conversation.status !== 'running' && conversation.status !== 'awaiting_approval'
}

export function deleteConversationTitle(conversation: Conversation, total: number): string {
  if (conversation.status === 'running' || conversation.status === 'awaiting_approval') return '执行中或待确认的会话不能删除'
  return total <= 1 ? '每个 Demand 至少保留一个会话' : '删除会话'
}

export function demandStatusLabel(status: Demand['status']): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'blocked') return '阻塞'
  return status === 'completed' ? '完成' : '待开始'
}

export function projectName(cwd: string): string {
  if (cwd === '未记录项目路径') return cwd
  return cwd.split('/').filter(Boolean).at(-1) || cwd
}

export function threadTitle(thread: AvailableNativeThread): string {
  const title = thread.preview.replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, 100) : `未命名 Thread · ${thread.nativeId.slice(0, 8)}`
}

export function formatThreadTime(value: string, now = Date.now()): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.round((now - time) / 60_000))
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1_440) return `${Math.round(minutes / 60)} 小时前`
  return `${Math.round(minutes / 1_440)} 天前`
}

export function groupThreadProjects(threads: AvailableNativeThread[], demandPaths: string[]): ThreadProject[] {
  const projects = new Map<string, ThreadProject>()
  for (const thread of threads) {
    const cwd = thread.cwd?.trim() || '未记录项目路径'
    const existing = projects.get(cwd)
    const relatedToDemand = demandPaths.some(path => path === cwd || path.startsWith(`${cwd}/`) || cwd.startsWith(`${path}/`))
    projects.set(cwd, existing
      ? { ...existing, count: existing.count + 1, relatedToDemand: existing.relatedToDemand || relatedToDemand }
      : { cwd, name: projectName(cwd), count: 1, relatedToDemand })
  }
  return [...projects.values()].sort((left, right) =>
    Number(right.relatedToDemand) - Number(left.relatedToDemand)
    || right.count - left.count
    || left.name.localeCompare(right.name),
  )
}

export function filterNativeThreads(threads: AvailableNativeThread[], project: string, query: string): AvailableNativeThread[] {
  const projectThreads = project
    ? threads.filter(thread => (thread.cwd?.trim() || '未记录项目路径') === project)
    : threads
  const needle = query.trim().toLowerCase()
  return needle
    ? projectThreads.filter(thread => `${thread.preview} ${thread.cwd ?? ''} ${thread.nativeId}`.toLowerCase().includes(needle))
    : projectThreads
}

export function dashboardCacheLabel(cache: DashboardSnapshot['cache'] | undefined): string {
  if (!cache) return ''
  if (cache.state === 'refreshing') return cache.generatedAt ? '后台刷新中' : '首次统计中'
  if (cache.state === 'empty') return '等待首次统计'
  if (cache.lastError) return '刷新失败，可重试'
  return `更新于 ${cache.ageSeconds ?? 0}s 前`
}

export function dashboardNeedsRefresh(cache: DashboardSnapshot['cache'] | undefined): boolean {
  return Boolean(cache && cache.state !== 'fresh')
}

export function parseWorkbenchRoute(search: string): WorkbenchRoute {
  const params = new URLSearchParams(search)
  const view = params.get('view')
  const page: WorkbenchStaticPage = view === 'demands' || view === 'knowledge' || view === 'skills' || view === 'settings' ? view : 'dashboard'
  const section = params.get('settings')
  const settingsSection: WorkbenchSettingsSection = section === 'runtime' || section === 'quick-actions' ? section : 'overview'
  return { workspaceId: params.get('workspace'), demandId: params.get('demand'), page, settingsSection }
}

export function matchDemandRoute(demands: Demand[], id: string): Demand | undefined {
  return demands.find(demand => demand.id === id || demand.worktreeKey === id || demand.branchName === id)
}

export function workbenchUrl(current: string, workspaceId: string | null, demandId: string | null, route?: { page?: WorkbenchStaticPage; settingsSection?: WorkbenchSettingsSection }): URL {
  const url = new URL(current)
  if (workspaceId) url.searchParams.set('workspace', workspaceId)
  else url.searchParams.delete('workspace')
  if (demandId) {
    url.searchParams.set('demand', demandId)
    url.searchParams.delete('view')
    url.searchParams.delete('settings')
  } else {
    url.searchParams.delete('demand')
    if (route?.page && route.page !== 'dashboard') url.searchParams.set('view', route.page)
    else url.searchParams.delete('view')
    if (route?.page === 'settings' && route.settingsSection && route.settingsSection !== 'overview') url.searchParams.set('settings', route.settingsSection)
    else url.searchParams.delete('settings')
  }
  return url
}

export function conversationStatusFromState(metadataStatus: Conversation['status'], state: ConversationState | null): Conversation['status'] {
  if (!state) return metadataStatus
  if (state.pendingRequests.length > 0) return 'awaiting_approval'
  const active = state.activeTurnId ? state.turns[state.activeTurnId] : undefined
  if (active) return active.lifecycle === 'disconnected' ? 'disconnected' : 'running'
  const latest = Object.values(state.turns).at(-1)
  if (!latest) return metadataStatus
  if (latest.lifecycle === 'running' || latest.lifecycle === 'retrying') return 'running'
  if (latest.lifecycle === 'completed') return 'completed'
  if (latest.lifecycle === 'failed') return 'failed'
  if (latest.lifecycle === 'disconnected') return 'disconnected'
  if (latest.lifecycle === 'interrupted') return 'idle'
  return metadataStatus
}
