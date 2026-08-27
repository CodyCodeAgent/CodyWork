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
function hasFailure(value: unknown): boolean { return /fail|error|cancel|reject|denied/iu.test(typeof value === 'string' ? value : compact(value)) }
function appendOutput(previous: string | undefined, next: string): string | undefined {
  if (!next) return previous
  if (!previous || previous.includes(next)) return previous || next
  return `${previous}\n${next}`
}

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
  const tools = new Map<string, TimelineEntry>()
  const timeline: TimelineEntry[] = []

  for (const event of events) {
    if (event.type === 'reasoning.delta') {
      const text = String(event.data.text ?? '')
      if (text) timeline.push({ id: `reasoning:${event.itemId ?? event.id}`, kind: 'reasoning', text })
      continue
    }
    if (!['tool.started', 'tool.completed', 'file.changed', 'diff.updated'].includes(event.type)) continue
    const item = record(event.data.item)
    const type = String(item.type ?? '')
    const command = typeof item.command === 'string' ? item.command : ''
    const changes = Array.isArray(item.changes) ? item.changes.map(record) : []
    const mcpServer = typeof item.server === 'string' ? item.server : ''
    const mcpTool = typeof item.tool === 'string' ? item.tool : ''
    const output = typeof event.data.output === 'string' ? event.data.output : typeof event.data.text === 'string' ? event.data.text : typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : type === 'fileChange' ? changes.map(change => typeof change.diff === 'string' ? change.diff : '').filter(Boolean).join('\n\n') : type === 'mcpToolCall' ? compact(item.error ?? item.result ?? item.arguments) : ''
    const key = `tool:${event.itemId ?? event.id}`
    const existing = tools.get(key)

    // Output deltas intentionally carry only the native item id.  They enrich a
    // previously shown command instead of becoming a series of empty “Agent 工具”
    // cards.  If the corresponding item was never meaningful, keep it hidden.
    if (!type && existing?.kind === 'tool') {
      const mergedOutput = appendOutput(existing.tool.output, output)
      existing.tool = { ...existing.tool, ...(mergedOutput ? { output: mergedOutput } : {}) }
      continue
    }

    const title = type === 'commandExecution' ? '命令执行' : type === 'fileChange' ? '文件变更' : type === 'mcpToolCall' ? 'MCP 工具' : type === 'collabAgentToolCall' ? '协作 Agent' : String(event.data.name ?? event.data.path ?? (event.type.includes('file') ? '文件变更' : 'Agent 工具'))
    const summary = type === 'commandExecution' ? command : type === 'fileChange' ? `${String(changes.length)} 个文件变更` : type === 'mcpToolCall' ? [mcpServer, mcpTool].filter(Boolean).join('.') : String(event.data.summary ?? event.type)
    const failure = hasFailure(item.error) || hasFailure(event.data.error) || hasFailure(item.status)
    const meaningful = failure
      || (type === 'commandExecution' && Boolean(command || output))
      || (type === 'fileChange' && Boolean(changes.length || output))
      || (type === 'mcpToolCall' && Boolean(mcpServer || mcpTool || output))
      || (type === 'collabAgentToolCall' && Boolean(output || event.data.name || event.data.summary))

    // Lifecycle-only records (started/completed without a command, result,
    // failure, or file change) are internal App Server noise.  The live status
    // chip already communicates that Codex is working, so don't spend vertical
    // space on empty cards.
    if (!meaningful) continue

    const toolStatus = event.type.endsWith('started') ? 'running' : failure ? (status(item.status) || 'failed') : 'completed'
    const tool: ConversationTool = {
      kind: type === 'mcpToolCall' ? 'mcp' : type === 'fileChange' || event.type.includes('file') || event.type.includes('diff') ? 'fileChange' : type === 'collabAgentToolCall' ? 'collabAgent' : 'command',
      title,
      status: toolStatus,
      summary,
      details: type === 'commandExecution' ? [`cwd: ${String(item.cwd ?? 'unknown')}`, `status: ${toolStatus}`] : type === 'mcpToolCall' ? [`server: ${mcpServer || 'unknown'}`, `tool: ${mcpTool || 'unknown'}`] : [],
      ...(output ? { output } : {}),
    }
    if (existing?.kind === 'tool') {
      const mergedOutput = appendOutput(existing.tool.output, tool.output ?? '')
      existing.tool = { ...existing.tool, ...tool, ...(mergedOutput ? { output: mergedOutput } : {}) }
      continue
    }
    const entry: TimelineEntry = { id: key, kind: 'tool', tool }
    tools.set(key, entry)
    timeline.push(entry)
  }
  return timeline
}

export function findPendingEvent(events: ConversationEvent[], requestType: string, resolvedType: string): ConversationEvent | null {
  let result: ConversationEvent | null = null
  for (const event of events) {
    if (event.type === requestType) result = event
    if (event.type === resolvedType) result = null
  }
  return result
}
