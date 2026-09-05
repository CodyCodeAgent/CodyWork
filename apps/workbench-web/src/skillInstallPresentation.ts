import type { SkillInstallEvent, SkillInstallStatus } from './api'

export interface SkillInstallLogEntry {
  id: string
  type: string
  label: string
  text: string
  timestamp: string
  tone: 'neutral' | 'active' | 'success' | 'danger'
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function streamedText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function eventLabel(event: SkillInstallEvent): string {
  if (event.type === 'reasoning.delta' || event.type === 'reasoning.break') return 'Agent 思考'
  if (event.type === 'assistant.delta' || event.type === 'assistant.completed') return 'Agent 回复'
  if (event.type === 'plan.delta' || event.type === 'plan.replaced') return '执行计划'
  if (event.type.startsWith('tool.') || event.type === 'fileChange.updated') {
    return stringValue(record(event.data.tool)?.title) || (event.type === 'fileChange.updated' ? '文件变更' : '工具执行')
  }
  if (event.type === 'turn.started') return '开始执行'
  if (event.type === 'turn.completed') return '执行完成'
  if (event.type === 'turn.interrupted') return '执行已暂停'
  if (event.type === 'turn.failed' || event.type === 'turn.disconnected') return '执行失败'
  if (event.type === 'turn.activity') return stringValue(event.data.label) || 'Agent 活动'
  return event.type
}

function eventText(event: SkillInstallEvent): string {
  const tool = record(event.data.tool)
  if (tool) {
    const parts = [stringValue(tool.summary)]
    if (Array.isArray(tool.details)) parts.push(...tool.details.filter((value): value is string => typeof value === 'string'))
    parts.push(stringValue(tool.output))
    return parts.filter(Boolean).join('\n')
  }
  const streaming = event.type.endsWith('.delta') || event.type === 'tool.updated'
  const text = (streaming ? streamedText(event.data.text) : stringValue(event.data.text))
    || (streaming ? streamedText(event.data.delta) : stringValue(event.data.delta))
    || stringValue(event.data.error)
    || stringValue(event.data.message)
    || stringValue(event.data.label)
    || stringValue(event.data.status)
  return text || eventLabel(event)
}

function eventTone(type: string): SkillInstallLogEntry['tone'] {
  if (type === 'turn.failed' || type === 'turn.disconnected') return 'danger'
  if (type === 'turn.completed' || type === 'tool.completed') return 'success'
  if (type.endsWith('.delta') || type === 'turn.activity' || type === 'tool.updated') return 'active'
  return 'neutral'
}

function canMerge(previous: SkillInstallLogEntry | undefined, event: SkillInstallEvent): boolean {
  return Boolean(previous && previous.type === event.type && (
    event.type === 'assistant.delta'
    || event.type === 'reasoning.delta'
    || event.type === 'plan.delta'
    || event.type === 'tool.updated'
  ))
}

export function presentSkillInstallEvents(events: SkillInstallEvent[]): SkillInstallLogEntry[] {
  const rows: SkillInstallLogEntry[] = []
  events.forEach((event, index) => {
    const text = eventText(event)
    const previous = rows.at(-1)
    if (canMerge(previous, event)) {
      previous!.text = `${previous!.text}${text}`.slice(-24_000)
      previous!.timestamp = event.timestamp ?? previous!.timestamp
      return
    }
    rows.push({
      id: `${event.timestamp ?? 'event'}-${event.itemId ?? event.turnId ?? String(index)}-${String(index)}`,
      type: event.type,
      label: eventLabel(event),
      text,
      timestamp: event.timestamp ?? '',
      tone: eventTone(event.type),
    })
  })
  return rows
}

export function skillInstallStatusLabel(status: SkillInstallStatus['status']): string {
  if (status === 'running') return '执行中'
  if (status === 'pausing') return '暂停中'
  if (status === 'paused') return '已暂停'
  if (status === 'completed') return '已完成'
  return '失败'
}

export function skillInstallIsActive(status: SkillInstallStatus['status']): boolean {
  return status === 'running' || status === 'pausing'
}

export function formatSkillInstallDuration(startedAt: string, finishedAt: string | undefined, now = Date.now()): string {
  const start = Date.parse(startedAt)
  const end = finishedAt ? Date.parse(finishedAt) : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '计时中'
  const seconds = Math.max(0, Math.floor((end - start) / 1_000))
  if (seconds < 60) return `${String(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes)} 分 ${String(seconds % 60)} 秒`
}
