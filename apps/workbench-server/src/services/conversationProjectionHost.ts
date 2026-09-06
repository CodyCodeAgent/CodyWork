import {
  createConversationState,
  reduceConversationEvent,
  reduceConversationEvents,
  type ConversationState,
} from '@codycodeagent/cody-web-core/conversation'
import type { RuntimeConversationSnapshot } from '../runtime/protocol.js'
import type { ConversationEvent } from './conversations.js'
import type { ConversationEventHub } from './conversationEventHub.js'

type ProjectionEntry = {
  state: ConversationState
  ready: boolean
  watermark: number
  seenIds: Set<string>
  seenOrder: string[]
  buffered: ConversationEvent[]
  initialization: Promise<ProjectionAttachment> | null
}

export type ProjectionAttachment = {
  state: ConversationState
  snapshotEvents: ConversationEvent[]
  initialized: boolean
}

/**
 * The sole server-side reducer for transport projections. Native history and
 * Core owner events remain authoritative; this host only joins snapshot + live
 * events once and exposes the resulting view to channel adapters.
 */
export class ConversationProjectionHost {
  private readonly entries = new Map<string, ProjectionEntry>()
  private readonly unsubscribe: () => void

  constructor(
    events: ConversationEventHub,
    private readonly onEvent: (conversationId: string, event: ConversationEvent, state: ConversationState) => void,
  ) {
    this.unsubscribe = events.subscribe({}, event => this.receive(event))
  }

  async attach(input: {
    conversationId: string
    threadId: string
    emptyHistory?: boolean
    readSnapshot: () => Promise<RuntimeConversationSnapshot>
  }): Promise<ProjectionAttachment> {
    const existing = this.entries.get(input.conversationId)
    if (existing?.ready) return { state: existing.state, snapshotEvents: [], initialized: false }
    if (existing?.initialization) return existing.initialization

    const entry: ProjectionEntry = existing ?? {
      state: createConversationState(input.threadId), ready: false, watermark: 0, seenIds: new Set(), seenOrder: [], buffered: [], initialization: null,
    }
    this.entries.set(input.conversationId, entry)
    const initialization = this.initialize(entry, input)
    entry.initialization = initialization
    try { return await initialization }
    finally {
      if (entry.initialization === initialization) entry.initialization = null
    }
  }

  async refresh(input: {
    conversationId: string
    threadId: string
    readSnapshot: () => Promise<RuntimeConversationSnapshot>
  }): Promise<ProjectionAttachment> {
    this.entries.delete(input.conversationId)
    return this.attach(input)
  }

  state(conversationId: string): ConversationState | null {
    return this.entries.get(conversationId)?.state ?? null
  }

  has(conversationId: string): boolean { return this.entries.get(conversationId)?.ready === true }
  isInitializing(conversationId: string): boolean { return Boolean(this.entries.get(conversationId)?.initialization) }
  bufferedCount(conversationId: string): number { return this.entries.get(conversationId)?.buffered.length ?? 0 }

  detach(conversationId: string): void {
    this.entries.delete(conversationId)
  }

  close(): void {
    this.unsubscribe()
    this.entries.clear()
  }

  private async initialize(
    entry: ProjectionEntry,
    input: { conversationId: string; threadId: string; emptyHistory?: boolean; readSnapshot: () => Promise<RuntimeConversationSnapshot> },
  ): Promise<ProjectionAttachment> {
    const snapshot = input.emptyHistory ? { events: [] as ConversationEvent[], watermark: 0 } : await input.readSnapshot()
    const events = snapshot.events as ConversationEvent[]
    entry.state = reduceConversationEvents(createConversationState(input.threadId), events)
    entry.watermark = snapshot.watermark
    for (const event of events) this.remember(entry, event.id)
    entry.ready = true
    for (const event of entry.buffered.splice(0)) {
      this.apply(input.conversationId, entry, event)
    }
    return { state: entry.state, snapshotEvents: events, initialized: true }
  }

  private receive(event: ConversationEvent): void {
    const entry = this.entries.get(event.conversationId)
    if (!entry) return
    if (!entry.ready) {
      entry.buffered.push(event)
      if (entry.buffered.length > 2_000) entry.buffered.splice(0, entry.buffered.length - 2_000)
      return
    }
    this.apply(event.conversationId, entry, event)
  }

  private apply(conversationId: string, entry: ProjectionEntry, event: ConversationEvent): void {
    const ownerRevision = typeof event.ownerRevision === 'number' ? event.ownerRevision : null
    if (ownerRevision !== null ? ownerRevision <= entry.watermark : entry.seenIds.has(event.id)) return
    entry.state = reduceConversationEvent(entry.state, event)
    if (ownerRevision !== null) entry.watermark = ownerRevision
    this.remember(entry, event.id)
    this.onEvent(conversationId, event, entry.state)
  }

  private remember(entry: ProjectionEntry, eventId: string): void {
    if (!eventId || entry.seenIds.has(eventId)) return
    entry.seenIds.add(eventId)
    entry.seenOrder.push(eventId)
    if (entry.seenOrder.length <= 4_096) return
    for (const expired of entry.seenOrder.splice(0, entry.seenOrder.length - 4_096)) entry.seenIds.delete(expired)
  }
}
