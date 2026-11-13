import type { ConversationTransport } from '@codycodeagent/cody-web-core/client'
import { api, type BrowserTurnSettings, type Conversation, type ConversationEvent } from './api'
import { createConversationEventSocket, type ConversationSocketSnapshot } from './conversationSocket'

/** Same product gateway and native snapshot contract in single and parallel views. */
export function workbenchConversationTransport(workspaceId: string, conversation: Conversation, callbacks: {
  onState: (state: ConversationSocketSnapshot) => void
  onEvent?: (event: ConversationEvent) => void
}): ConversationTransport {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return {
    read: async () => (await api.conversationHistory(workspaceId, conversation.id)).events,
    snapshot: () => api.conversationHistory(workspaceId, conversation.id),
    submit: async command => {
      const input = command.input as { content: string; settings?: BrowserTurnSettings; imageIds?: string[] }
      const accepted = await api.sendMessage(workspaceId, conversation.id, command.clientCommandId, input.content, command.mode, input.settings, input.imageIds)
      return { clientCommandId: accepted.commandId }
    },
    interrupt: async () => { await api.interruptConversation(workspaceId, conversation.id) },
    subscribe: (_threadId, listener) => {
      const socket = createConversationEventSocket({
        url: `${protocol}://${window.location.host}/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversation.id)}/events`,
        onEvent(event) {
          const productEvent = event as ConversationEvent
          listener({ type: 'event', event: productEvent, ownerRevision: productEvent.ownerRevision })
          callbacks.onEvent?.(productEvent)
        },
        onConnection: listener,
        onState: callbacks.onState,
      })
      return () => socket.close()
    },
  }
}
