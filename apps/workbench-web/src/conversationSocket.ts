import {
  conversationBrowserTransportStateFromEvent,
  createReconnectingConversationSocket,
  initialConversationBrowserTransportState,
  type ConversationBrowserTransportState,
  type ConversationSubscriptionEvent,
} from '@codycodeagent/cody-web-core/client'
import type { CodexEvent } from '@codycodeagent/cody-web-core/conversation'

/** Core owns transport lifecycle semantics; CodyWork only renders this state. */
export type ConversationSocketSnapshot = ConversationBrowserTransportState

export type ConversationEventSocket = { close(): void }

type SocketLike = Pick<WebSocket, 'addEventListener' | 'close' | 'send' | 'readyState'>

type Options = {
  url: string
  onEvent: (event: CodexEvent) => void
  onConnection: (event: Exclude<ConversationSubscriptionEvent, { type: 'event' }>) => void
  onState: (state: ConversationSocketSnapshot) => void
  createSocket?: (url: string) => SocketLike
  minDelayMs?: number
  maxDelayMs?: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  random?: () => number
}

export function conversationCloseReason(code: number, reason: string): string {
  const explicit = reason.trim()
  if (explicit) return explicit
  if (code === 1000) return '正常关闭'
  if (code === 1001) return '服务端正在退出或页面离开'
  if (code === 1006) return '连接异常中断（未收到关闭帧）'
  if (code === 4000) return '实时连接心跳超时'
  return '服务端未提供关闭原因'
}

/** CodyWork only adapts product frames and presentation. Reconnect, heartbeat,
 * backoff and close authority are shared with CodyWeb through Core. */
export function createConversationEventSocket(options: Options): ConversationEventSocket {
  let transportState = initialConversationBrowserTransportState()
  options.onState(transportState)
  return createReconnectingConversationSocket({
    url: options.url,
    ...(options.createSocket ? { createSocket: options.createSocket as (url: string) => WebSocket } : {}),
    ...(options.minDelayMs ? { minDelayMs: options.minDelayMs } : {}),
    ...(options.maxDelayMs ? { maxDelayMs: options.maxDelayMs } : {}),
    ...(options.heartbeatIntervalMs ? { heartbeatIntervalMs: options.heartbeatIntervalMs } : {}),
    ...(options.heartbeatTimeoutMs ? { heartbeatTimeoutMs: options.heartbeatTimeoutMs } : {}),
    ...(options.random ? { random: options.random } : {}),
    parse(data) {
      try {
        const payload = JSON.parse(String(data)) as { type?: string; event?: CodexEvent }
        return payload.type === 'event' && payload.event
          ? { type: 'event', event: payload.event }
          : null
      } catch {
        return null
      }
    },
    listener(event) {
      if (event.type === 'event') {
        options.onEvent(event.event)
        return
      }
      options.onConnection(event)
      transportState = conversationBrowserTransportStateFromEvent(transportState, event)
      options.onState({
        ...transportState,
        closeReason: event.type === 'disconnected'
          ? conversationCloseReason(transportState.closeCode ?? 1006, transportState.closeReason)
          : '',
      })
    },
  })
}
