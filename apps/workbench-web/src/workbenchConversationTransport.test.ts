// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from './api'
import { api } from './api'
import { createConversationEventSocket } from './conversationSocket'
import { workbenchConversationTransport } from './workbenchConversationTransport'

vi.mock('./api', () => ({ api: { conversationHistory: vi.fn(), sendMessage: vi.fn(), interruptConversation: vi.fn() } }))
vi.mock('./conversationSocket', () => ({ createConversationEventSocket: vi.fn() }))
const conversation = (id: string) => ({ id, nativeId: `native-${id}` }) as Conversation
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.conversationHistory).mockResolvedValue({ events: [], watermark: 7 }); vi.mocked(api.sendMessage).mockImplementation(async (_w, id, commandId) => ({ accepted: true, commandId: `${id}-${commandId}` })) })
describe('shared Workbench conversation transport', () => {
  it('routes parallel history, send and stop through the exact workspace and real conversation binding', async () => {
    const a = workbenchConversationTransport('w1', conversation('a'), { onState: vi.fn() })
    const b = workbenchConversationTransport('w2', conversation('b'), { onState: vi.fn() })
    await a.snapshot?.('native-a'); await b.read('native-b')
    expect(api.conversationHistory).toHaveBeenNthCalledWith(1, 'w1', 'a')
    expect(api.conversationHistory).toHaveBeenNthCalledWith(2, 'w2', 'b')
    const command = { threadId: 'native-a', clientCommandId: 'command', mode: 'queue' as const, input: { content: 'hello', imageIds: ['image_a'], settings: { model: 'm1' } } }
    expect(await a.submit?.(command)).toEqual({ clientCommandId: 'a-command' })
    await b.interrupt?.('native-b')
    expect(api.sendMessage).toHaveBeenCalledExactlyOnceWith('w1', 'a', 'command', 'hello', 'queue', { model: 'm1' }, ['image_a'])
    expect(api.interruptConversation).toHaveBeenCalledExactlyOnceWith('w2', 'b')
  })
  it('keeps subscriptions independent and closes only the browser socket when a panel leaves', () => {
    const closeA = vi.fn(), closeB = vi.fn(), listenerA = vi.fn(), listenerB = vi.fn(), stateA = vi.fn(), stateB = vi.fn()
    vi.mocked(createConversationEventSocket).mockReturnValueOnce({ close: closeA }).mockReturnValueOnce({ close: closeB })
    const a = workbenchConversationTransport('w1', conversation('a'), { onState: stateA }).subscribe('native-a', listenerA)
    workbenchConversationTransport('w1', conversation('b'), { onState: stateB }).subscribe('native-b', listenerB)
    const [socketA, socketB] = vi.mocked(createConversationEventSocket).mock.calls.map(call => call[0])
    expect(socketA.url).toContain('/w1/conversations/a/events'); expect(socketB.url).toContain('/w1/conversations/b/events')
    socketA.onConnection({ type: 'connected' })
    expect(listenerA).toHaveBeenCalledWith({ type: 'connected' }); expect(listenerB).not.toHaveBeenCalled()
    a()
    expect(closeA).toHaveBeenCalledOnce(); expect(closeB).not.toHaveBeenCalled(); expect(api.interruptConversation).not.toHaveBeenCalled()
  })
})
