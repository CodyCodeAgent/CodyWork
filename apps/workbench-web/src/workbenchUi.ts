import type { AvailableNativeThread, Conversation, DashboardSnapshot, Demand } from './api'

export type HistoryMode = 'push' | 'replace' | 'none'
export interface WorkbenchRoute { workspaceId: string | null; demandId: string | null }
export interface ThreadProject { cwd: string; name: string; count: number; relatedToDemand: boolean }
export interface CollaborationModeOption { value: string; label: string }

export function collaborationModeOptions(modes: Array<{ name: string; label: string }>): CollaborationModeOption[] {
  return [
    { value: 'default', label: 'Default' },
    ...modes.filter(mode => mode.name !== 'default').map(mode => ({ value: mode.name, label: mode.label })),
  ]
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
  return { workspaceId: params.get('workspace'), demandId: params.get('demand') }
}

export function matchDemandRoute(demands: Demand[], id: string): Demand | undefined {
  return demands.find(demand => demand.id === id || demand.worktreeKey === id || demand.branchName === id)
}

export function workbenchUrl(current: string, workspaceId: string | null, demandId: string | null): URL {
  const url = new URL(current)
  if (workspaceId) url.searchParams.set('workspace', workspaceId)
  else url.searchParams.delete('workspace')
  if (demandId) url.searchParams.set('demand', demandId)
  else url.searchParams.delete('demand')
  return url
}

export function conversationStatusAfterEvent(current: Conversation['status'], eventType: string): Conversation['status'] {
  if (eventType === 'turn.started') return 'running'
  if (eventType === 'approval.requested' || eventType === 'question.requested') return 'awaiting_approval'
  if (eventType === 'turn.failed') return 'failed'
  if (eventType === 'turn.interrupted') return 'idle'
  if (eventType === 'turn.completed') return 'completed'
  return current
}
