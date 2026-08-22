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
    const output = typeof event.data.output === 'string' ? event.data.output : typeof event.data.text === 'string' ? event.data.text : ''
    const tool: ConversationTool = {
      kind: event.type.includes('file') || event.type.includes('diff') ? 'fileChange' : 'command',
      title: String(event.data.name ?? event.data.path ?? (event.type.includes('file') ? '文件变更' : 'Agent 工具')),
      status: event.type.endsWith('started') ? 'running' : 'completed',
      summary: String(event.data.summary ?? event.type),
      details: [],
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
