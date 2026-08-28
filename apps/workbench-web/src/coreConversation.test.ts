import { describe, expect, it } from 'vitest'
import {
  createConversationState,
  reduceConversationEvent,
  type CodexEvent,
} from '@codycodeagent/cody-web-core/conversation'
import { conversationEntriesFromState } from '@codycodeagent/cody-web-core/vue'

function event(
  id: string,
  type: CodexEvent['type'],
  data: Record<string, unknown>,
  itemId?: string,
): CodexEvent {
  return {
    id,
    type,
    threadId: 'thread-1',
    turnId: 'turn-1',
    ...(itemId ? { itemId } : {}),
    atIso: `2026-08-28T00:00:0${id.length}.000Z`,
    data,
  }
}

describe('CodyWork shared conversation integration', () => {
  it('uses the Core reducer for streamed assistant messages and terminal state', () => {
    let state = createConversationState('thread-1')
    state = reduceConversationEvent(state, event('start', 'turn.started', {}))
    state = reduceConversationEvent(state, event('a', 'assistant.delta', { text: '共享' }, 'assistant-1'))
    state = reduceConversationEvent(state, event('b', 'assistant.delta', { text: '回复' }, 'assistant-1'))
    state = reduceConversationEvent(state, event('done', 'turn.completed', {}))

    expect(state.activeTurnId).toBe('')
    expect(state.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', text: '共享回复' }),
    ]))
  })

  it('uses the shared Vue presentation rules to group file changes', () => {
    let state = createConversationState('thread-1')
    for (const [id, path] of [['one', 'src/a.ts'], ['two', 'src/b.ts']] as const) {
      state = reduceConversationEvent(state, event(id, 'tool.completed', {
        tool: {
          kind: 'fileChange',
          title: '文件变更',
          status: 'completed',
          summary: path,
          details: [path],
        },
      }, id))
    }

    const fileEntries = conversationEntriesFromState(state).filter((entry) => entry.kind === 'tool')
    expect(fileEntries).toHaveLength(1)
    expect(fileEntries[0]).toMatchObject({
      kind: 'tool',
      tool: { title: '文件变更 · 2 个文件', details: ['src/a.ts', 'src/b.ts'] },
    })
  })
})
