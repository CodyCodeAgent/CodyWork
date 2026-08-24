import {
  mergeMessages,
  upsertLiveDelta,
  type ConversationMessage,
  type ConversationTool,
} from '@codycodeagent/cody-web-core/conversation'
import type { ConversationEvent } from './api'

export type TimelineEntry =
  | { id: string; kind: 'tool'; tool: ConversationTool }
  | { id: string; kind: 'reasoning'; text: string }

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function status(value: unknown): string { return typeof value === 'string' ? value : typeof record(value).type === 'string' ? String(record(value).type) : '' }
function compact(value: unknown): string { try { return value == null ? '' : JSON.stringify(value, null, 2) } catch { return String(value) } }

export function buildMessages(events: ConversationEvent[]): ConversationMessage[] {
  let rows: ConversationMessage[] = []
  for (const event of events) {
    const text = typeof event.data.text === 'string' ? event.data.text : ''
    if (event.type === 'message.user') {
      rows = mergeMessages(rows, [{ id: `user:${event.id}`, turnId: event.turnId, role: 'user', text }], { preserveMissing: true })
    }
    if (event.type === 'message.delta') {
      rows = upsertLiveDelta(rows, {
        messageId: `live:${event.itemId ?? event.turnId ?? 'agent'}`,
        turnId: event.turnId,
        textDelta: text,
        messageType: 'agentMessage.live',
      })
    }
    if (event.type === 'message.completed' && text) {
      rows = mergeMessages(rows, [{ id: `agent:${event.itemId ?? event.id}`, turnId: event.turnId, role: 'assistant', text }], { preserveMissing: true })
    }
    if (event.type === 'plan.updated' && text) {
      rows = upsertLiveDelta(rows, {
        messageId: `plan:${event.itemId ?? event.turnId ?? 'current'}`,
        turnId: event.turnId,
        textDelta: text,
        messageType: 'plan.live',
      })
    }
  }
  return rows
}

export function buildTimeline(events: ConversationEvent[]): TimelineEntry[] {
  return events.flatMap<TimelineEntry>((event) => {
    if (event.type === 'reasoning.delta') {
      const text = String(event.data.text ?? '')
      return text ? [{ id: `reasoning:${event.itemId ?? event.id}`, kind: 'reasoning', text }] : []
    }
    if (!['tool.started', 'tool.completed', 'file.changed', 'diff.updated'].includes(event.type)) return []
    const item = record(event.data.item)
    const type = String(item.type ?? '')
    const command = typeof item.command === 'string' ? item.command : ''
    const changes = Array.isArray(item.changes) ? item.changes.map(record) : []
    const mcpServer = typeof item.server === 'string' ? item.server : ''
    const mcpTool = typeof item.tool === 'string' ? item.tool : ''
    const output = typeof event.data.output === 'string' ? event.data.output : typeof event.data.text === 'string' ? event.data.text : typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : type === 'fileChange' ? changes.map(change => typeof change.diff === 'string' ? change.diff : '').filter(Boolean).join('\n\n') : type === 'mcpToolCall' ? compact(item.error ?? item.result ?? item.arguments) : ''
    const title = type === 'commandExecution' ? '命令执行' : type === 'fileChange' ? '文件变更' : type === 'mcpToolCall' ? 'MCP 工具' : type === 'collabAgentToolCall' ? '协作 Agent' : String(event.data.name ?? event.data.path ?? (event.type.includes('file') ? '文件变更' : 'Agent 工具'))
    const summary = type === 'commandExecution' ? command : type === 'fileChange' ? `${String(changes.length)} 个文件变更` : type === 'mcpToolCall' ? [mcpServer, mcpTool].filter(Boolean).join('.') : String(event.data.summary ?? event.type)
    const tool: ConversationTool = {
      kind: type === 'mcpToolCall' ? 'mcp' : type === 'fileChange' || event.type.includes('file') || event.type.includes('diff') ? 'fileChange' : type === 'collabAgentToolCall' ? 'collabAgent' : 'command',
      title,
      status: event.type.endsWith('started') ? 'running' : status(item.status) || 'completed',
      summary,
      details: type === 'commandExecution' ? [`cwd: ${String(item.cwd ?? 'unknown')}`, `status: ${status(item.status) || 'unknown'}`] : type === 'mcpToolCall' ? [`server: ${mcpServer || 'unknown'}`, `tool: ${mcpTool || 'unknown'}`] : [],
      ...(output ? { output } : {}),
    }
    return [{ id: `tool:${event.itemId ?? event.id}`, kind: 'tool', tool }]
  })
}

export function findPendingEvent(events: ConversationEvent[], requestType: string, resolvedType: string): ConversationEvent | null {
  let result: ConversationEvent | null = null
  for (const event of events) {
    if (event.type === requestType) result = event
    if (event.type === resolvedType) result = null
  }
  return result
}
