import type { ConversationEvent } from './conversations.js'

export type ConversationEventListener = (event: ConversationEvent) => void

/**
 * One canonical process-local event fan-out for every server-side consumer.
 * Consumers project transport-specific URLs/cards at their own edge.
 */
export class ConversationEventHub {
  private readonly listeners = new Map<string, Set<ConversationEventListener>>()
  private readonly globalListeners = new Set<ConversationEventListener>()

  subscribe(input: { conversationId?: string }, listener: ConversationEventListener): () => void {
    if (!input.conversationId) {
      this.globalListeners.add(listener)
      return () => { this.globalListeners.delete(listener) }
    }
    const listeners = this.listeners.get(input.conversationId) ?? new Set<ConversationEventListener>()
    listeners.add(listener)
    this.listeners.set(input.conversationId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(input.conversationId!)
    }
  }

  publish(event: ConversationEvent): void {
    for (const listener of this.listeners.get(event.conversationId) ?? []) this.notify(listener, event)
    for (const listener of this.globalListeners) this.notify(listener, event)
  }

  clear(conversationId: string): void {
    this.listeners.delete(conversationId)
  }

  private notify(listener: ConversationEventListener, event: ConversationEvent): void {
    try { listener(event) }
    catch (error) {
      console.error(`[codywork] conversation event listener failed for ${event.conversationId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
