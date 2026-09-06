import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/runtime/protocol.js'
import { ConversationEventHub } from '../src/services/conversationEventHub.js'
import { ConversationProjectionHost } from '../src/services/conversationProjectionHost.js'

function event(id: string, type: RuntimeEvent['type'], ownerRevision: number, data: Record<string, unknown> = {}): RuntimeEvent {
  const atIso = '2026-09-06T00:00:00.000Z'
  return {
    id, type, conversationId: 'conversation-1', threadId: 'thread-1', turnId: 'turn-1',
    ownerRevision, timestamp: atIso, atIso, data,
  }
}

describe('ConversationProjectionHost', () => {
  it('joins one owner snapshot with buffered live events without replaying the watermark', async () => {
    const events = new ConversationEventHub()
    const applied: string[] = []
    const host = new ConversationProjectionHost(events, (_conversationId, incoming) => applied.push(incoming.id))
    let resolveSnapshot!: (value: { events: RuntimeEvent[]; watermark: number }) => void
    const snapshot = new Promise<{ events: RuntimeEvent[]; watermark: number }>(resolve => { resolveSnapshot = resolve })
    const attachment = host.attach({
      conversationId: 'conversation-1', threadId: 'thread-1', readSnapshot: () => snapshot,
    })

    events.publish(event('already-in-snapshot', 'turn.started', 4))
    events.publish(event('new-live-event', 'assistant.delta', 6, { text: 'new' }))
    resolveSnapshot({ events: [event('already-in-snapshot', 'turn.started', 4)], watermark: 5 })

    const result = await attachment
    expect(result.initialized).toBe(true)
    expect(applied).toEqual(['new-live-event'])
    expect(result.state.turns['turn-1']?.lifecycle).toBe('running')
    expect(host.bufferedCount('conversation-1')).toBe(0)
    host.close()
  })

  it('reduces one live event once for every attached transport projection', async () => {
    const events = new ConversationEventHub()
    const applied: string[] = []
    const host = new ConversationProjectionHost(events, (_conversationId, incoming) => applied.push(incoming.id))
    await host.attach({
      conversationId: 'conversation-1', threadId: 'thread-1',
      readSnapshot: async () => ({ events: [], watermark: 0 }),
    })

    events.publish(event('live-1', 'turn.started', 1))
    events.publish(event('live-1-duplicate-revision', 'turn.started', 1))

    expect(applied).toEqual(['live-1'])
    expect(host.state('conversation-1')?.turns['turn-1']?.lifecycle).toBe('running')
    host.close()
  })
})
