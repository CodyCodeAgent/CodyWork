import { describe, expect, it } from 'vitest'
import { buildMessages, buildTimeline, findPendingEvent } from './conversationState'

describe('conversation state', () => {
  it('reconciles streamed assistant deltas with durable history', () => {
    const events = [
      { id: 1, type: 'message.user', conversationId: 'c', provider: 'codex', data: { text: 'ship it' } },
      { id: 2, type: 'message.delta', conversationId: 'c', turnId: 't', itemId: 'a', provider: 'codex', data: { text: 'Hello ' } },
      { id: 3, type: 'message.delta', conversationId: 'c', turnId: 't', itemId: 'a', provider: 'codex', data: { text: 'world' } },
      { id: 4, type: 'message.completed', conversationId: 'c', turnId: 't', itemId: 'a', provider: 'codex', data: { text: 'Hello world' } },
    ]
    expect(buildMessages(events)).toEqual([
      expect.objectContaining({ role: 'user', text: 'ship it' }),
      expect.objectContaining({ role: 'assistant', text: 'Hello world' }),
    ])
  })

  it('builds a safe tool timeline and tracks approval lifecycle', () => {
    const events = [
      { id: 1, type: 'tool.started', conversationId: 'c', itemId: 'cmd', provider: 'codex', data: { name: 'npm test' } },
      { id: 2, type: 'approval.requested', conversationId: 'c', provider: 'codex', data: { approvalId: 'a1' } },
      { id: 3, type: 'approval.resolved', conversationId: 'c', provider: 'codex', data: { approvalId: 'a1' } },
    ]
    expect(buildTimeline(events)[0]).toEqual(expect.objectContaining({ kind: 'tool', tool: expect.objectContaining({ status: 'running' }) }))
    expect(findPendingEvent(events, 'approval.requested', 'approval.resolved')).toBeNull()
  })
})
