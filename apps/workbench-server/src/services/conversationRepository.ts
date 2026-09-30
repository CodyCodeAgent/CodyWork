import type { ConversationRow, ConversationRuntimeType } from '../db/index.js'
import { nowIso, type WorkbenchDb } from '../db/index.js'
import type { RuntimeEvent } from '../runtime/protocol.js'

export interface TraeConversationCacheInfo {
  eventCount: number
  byteLength: number
  lastUpdatedAt: string | null
  compactedAt: string | null
  nativeEventsAfter: string | null
}

/**
 * SQLite metadata for a CodyWork conversation. Native Codex Thread history is
 * deliberately absent: the sole exception is Trae's product-event replay
 * cache, required because ACP session restore does not replay UI events.
 */
export class ConversationRepository {
  constructor(private readonly database: WorkbenchDb) {}

  listDemand(workspaceId: string, demandId: string): ConversationRow[] {
    return this.database.db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND scope = 'demand' AND demand_id = ? ORDER BY updated_at DESC, created_at DESC")
      .all(workspaceId, demandId) as unknown as ConversationRow[]
  }

  listWorkspace(workspaceId: string): ConversationRow[] {
    return this.database.db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND scope = 'workspace' ORDER BY updated_at DESC, created_at DESC")
      .all(workspaceId) as unknown as ConversationRow[]
  }

  listDemandRows(workspaceId: string, demandId: string): ConversationRow[] {
    return this.database.db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND demand_id = ?')
      .all(workspaceId, demandId) as unknown as ConversationRow[]
  }

  listNativeIds(runtimeType: ConversationRuntimeType): string[] {
    const rows = this.database.db.prepare('SELECT native_id FROM conversations WHERE runtime_type = ?').all(runtimeType) as Array<{ native_id: string }>
    return rows.map(row => row.native_id)
  }

  get(workspaceId: string, conversationId: string): ConversationRow | null {
    return (this.database.db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, conversationId) as ConversationRow | undefined) ?? null
  }

  getById(conversationId: string): ConversationRow | null {
    return (this.database.db.prepare('SELECT * FROM conversations WHERE id = ?')
      .get(conversationId) as ConversationRow | undefined) ?? null
  }

  getByNativeId(runtimeType: ConversationRuntimeType, nativeId: string): ConversationRow | null {
    return (this.database.db.prepare('SELECT * FROM conversations WHERE runtime_type = ? AND native_id = ?')
      .get(runtimeType, nativeId) as ConversationRow | undefined) ?? null
  }

  insert(row: ConversationRow): void {
    this.database.db.prepare('INSERT INTO conversations (id, scope, demand_id, workspace_id, native_id, runtime_type, title, created_via, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        row.id, row.scope, row.demand_id, row.workspace_id, row.native_id,
        row.runtime_type, row.title, row.created_via, row.status, row.permission_mode,
        row.policy_hash, row.instruction_hash, row.created_at, row.updated_at,
      )
  }

  updateContext(conversationId: string, policyHash: string, instructionHash: string, updatedAt = nowIso()): void {
    this.database.db.prepare('UPDATE conversations SET policy_hash = ?, instruction_hash = ?, updated_at = ? WHERE id = ?')
      .run(policyHash, instructionHash, updatedAt, conversationId)
  }

  touch(conversationId: string, updatedAt = nowIso()): void {
    this.database.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(updatedAt, conversationId)
  }

  updateStatus(conversationId: string, status: ConversationRow['status'], updatedAt = nowIso()): void {
    this.database.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, conversationId)
  }

  updatePermission(conversationId: string, mode: ConversationRow['permission_mode'], updatedAt = nowIso()): void {
    this.database.db.prepare('UPDATE conversations SET permission_mode = ?, updated_at = ? WHERE id = ?')
      .run(mode, updatedAt, conversationId)
  }

  updateTitle(conversationId: string, title: string, updatedAt = nowIso()): void {
    this.database.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, updatedAt, conversationId)
  }

  /** Rebinds a product conversation after a provider declares its old native
   * session unavailable. This never changes the owning runtime type. */
  replaceNativeId(conversationId: string, nativeId: string, updatedAt = nowIso()): void {
    this.database.db.prepare('UPDATE conversations SET native_id = ?, updated_at = ? WHERE id = ?')
      .run(nativeId, updatedAt, conversationId)
  }

  demandCount(workspaceId: string, demandId: string | null): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM conversations WHERE workspace_id = ? AND scope = 'demand' AND demand_id = ?")
      .get(workspaceId, demandId) as { count: number }
    return row.count
  }

  delete(workspaceId: string, conversationId: string): boolean {
    return this.database.db.prepare('DELETE FROM conversations WHERE id = ? AND workspace_id = ?')
      .run(conversationId, workspaceId).changes > 0
  }

  appendTraeEvent(conversationId: string, event: RuntimeEvent): void {
    // An event can arrive through a runtime subscription while a submit
    // callback is still unwinding. The provider event id makes this write
    // safely idempotent without dropping a distinct event from another turn.
    this.database.db.prepare('INSERT OR IGNORE INTO trae_conversation_events (conversation_id, event_id, event_json, created_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, event.id, JSON.stringify(event), event.timestamp || nowIso())
  }

  listTraeEvents(conversationId: string): RuntimeEvent[] {
    const rows = this.database.db.prepare('SELECT event_json FROM trae_conversation_events WHERE conversation_id = ? ORDER BY id ASC')
      .all(conversationId) as Array<{ event_json: string }>
    const events: RuntimeEvent[] = []
    for (const row of rows) {
      try {
        const event: unknown = JSON.parse(row.event_json)
        if (!isRuntimeEvent(event)) continue
        events.push(event)
      } catch {
        // A malformed old cache row must not make an otherwise valid
        // conversation impossible to open.
      }
    }
    return events
  }

  traeCacheInfo(conversationId: string): TraeConversationCacheInfo {
    const events = this.database.db.prepare('SELECT COUNT(*) AS event_count, COALESCE(SUM(length(CAST(event_json AS BLOB))), 0) AS byte_length, MAX(created_at) AS last_updated_at FROM trae_conversation_events WHERE conversation_id = ?')
      .get(conversationId) as { event_count: number; byte_length: number; last_updated_at: string | null }
    const state = this.database.db.prepare('SELECT native_events_after, compacted_at FROM trae_conversation_cache_state WHERE conversation_id = ?')
      .get(conversationId) as { native_events_after: string | null; compacted_at: string | null } | undefined
    return {
      eventCount: events.event_count,
      byteLength: events.byte_length,
      lastUpdatedAt: events.last_updated_at,
      compactedAt: state?.compacted_at ?? null,
      nativeEventsAfter: state?.native_events_after ?? null,
    }
  }

  replaceTraeEvents(conversationId: string, events: RuntimeEvent[], nativeEventsAfter: string | null, compactedAt: string | null): void {
    const updatedAt = nowIso()
    this.database.db.exec('BEGIN IMMEDIATE')
    try {
      this.database.db.prepare('DELETE FROM trae_conversation_events WHERE conversation_id = ?').run(conversationId)
      const insert = this.database.db.prepare('INSERT INTO trae_conversation_events (conversation_id, event_id, event_json, created_at) VALUES (?, ?, ?, ?)')
      for (const event of events) insert.run(conversationId, event.id, JSON.stringify(event), event.timestamp || updatedAt)
      this.database.db.prepare('INSERT INTO trae_conversation_cache_state (conversation_id, native_events_after, compacted_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET native_events_after = excluded.native_events_after, compacted_at = excluded.compacted_at, updated_at = excluded.updated_at')
        .run(conversationId, nativeEventsAfter, compactedAt, updatedAt)
      this.database.db.exec('COMMIT')
    } catch (error) {
      if (this.database.db.isTransaction) this.database.db.exec('ROLLBACK')
      throw error
    }
  }

  audit(conversationId: string, action: string, data: unknown): void {
    this.database.db.prepare('INSERT INTO conversation_audits (conversation_id, action, data_json, created_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, action, JSON.stringify(data), nowIso())
  }
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { conversationId?: unknown }).conversationId === 'string'
    && typeof (value as { timestamp?: unknown }).timestamp === 'string'
    && typeof (value as { data?: unknown }).data === 'object'
    && (value as { data?: unknown }).data !== null
}
