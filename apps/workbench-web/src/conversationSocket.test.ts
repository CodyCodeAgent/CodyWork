import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationCloseReason, createConversationEventSocket, type ConversationSocketSnapshot } from './conversationSocket'

class FakeSocket {
  static instances: FakeSocket[] = []
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>()
  closed = false
  readyState = 1
  sent: string[] = []

  constructor() { FakeSocket.instances.push(this) }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback as (event: unknown) => void])
  }

  close(): void { this.closed = true }
  send(value: string): void { this.sent.push(value) }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

afterEach(() => { vi.useRealTimers(); FakeSocket.instances = [] })

describe('conversation WebSocket transport', () => {
  it('keeps retryable browser closes in reconnecting state without fabricating Runtime events', () => {
    vi.useFakeTimers()
    const states: ConversationSocketSnapshot[] = []
    const events: string[] = []
    const transport = createConversationEventSocket({
      url: 'ws://example.test/events',
      createSocket: () => new FakeSocket() as unknown as WebSocket,
      random: () => 0.5,
      onState: state => states.push(state),
      onEvent: event => events.push(event.type),
      onConnection: () => undefined,
    })

    const first = FakeSocket.instances[0]!
    first.emit('open')
    first.emit('message', { data: JSON.stringify({ type: 'event', event: { id: 'one', type: 'turn.started', threadId: 'thread', turnId: 'turn', atIso: '', data: {} } }) })
    first.emit('close', { code: 1006, reason: '' })

    expect(events).toEqual(['turn.started'])
    expect(states.at(-1)).toMatchObject({ status: 'connecting', closeCode: 1006, closeReason: '连接异常中断（未收到关闭帧）', reconnectAttempt: 1, retryInMs: 500, willReconnect: true })
    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(2)

    transport.close()
    FakeSocket.instances[1]!.emit('close', { code: 1000, reason: 'closed' })
    vi.runAllTimers()
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('keeps two tab transports independent', () => {
    vi.useFakeTimers()
    const left = createConversationEventSocket({ url: 'ws://example.test/events', createSocket: () => new FakeSocket() as unknown as WebSocket, onState: () => undefined, onEvent: () => undefined, onConnection: () => undefined })
    const rightStates: ConversationSocketSnapshot[] = []
    const right = createConversationEventSocket({ url: 'ws://example.test/events', createSocket: () => new FakeSocket() as unknown as WebSocket, onState: state => rightStates.push(state), onEvent: () => undefined, onConnection: () => undefined })
    const rightSocket = FakeSocket.instances[1]!
    rightSocket.emit('open')

    left.close()
    expect(rightSocket.closed).toBe(false)
    expect(rightStates.at(-1)?.status).toBe('open')
    right.close()
  })

  it('does not retry a conversation that the server has explicitly removed', () => {
    vi.useFakeTimers()
    const states: ConversationSocketSnapshot[] = []
    createConversationEventSocket({
      url: 'ws://example.test/events',
      createSocket: () => new FakeSocket() as unknown as WebSocket,
      onState: state => states.push(state),
      onEvent: () => undefined,
      onConnection: () => undefined,
    })

    FakeSocket.instances[0]!.emit('close', { code: 4404, reason: 'conversation deleted' })
    vi.runAllTimers()

    expect(FakeSocket.instances).toHaveLength(1)
    expect(states.at(-1)).toMatchObject({ status: 'closed', closeCode: 4404, willReconnect: false })
  })

  it('formats standard and explicit close reasons', () => {
    expect(conversationCloseReason(1000, '')).toBe('正常关闭')
    expect(conversationCloseReason(1012, 'service restart')).toBe('service restart')
  })
})
