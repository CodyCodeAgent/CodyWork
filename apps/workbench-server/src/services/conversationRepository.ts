import type { ConversationRow } from '../db/index.js'
import { nowIso, type WorkbenchDb } from '../db/index.js'

/**
 * SQLite metadata for a CodyWork conversation. Native Codex Thread history is
 * deliberately absent: this repository stores product metadata and audit only.
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

  listNativeIds(): string[] {
    const rows = this.database.db.prepare('SELECT native_id FROM conversations').all() as Array<{ native_id: string }>
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

  getByNativeId(nativeId: string): ConversationRow | null {
    return (this.database.db.prepare('SELECT * FROM conversations WHERE native_id = ?')
      .get(nativeId) as ConversationRow | undefined) ?? null
  }

  insert(row: ConversationRow): void {
    this.database.db.prepare('INSERT INTO conversations (id, scope, demand_id, workspace_id, native_id, title, created_via, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        row.id, row.scope, row.demand_id, row.workspace_id, row.native_id,
        row.title, row.created_via, row.status, row.permission_mode,
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

  demandCount(workspaceId: string, demandId: string | null): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM conversations WHERE workspace_id = ? AND scope = 'demand' AND demand_id = ?")
      .get(workspaceId, demandId) as { count: number }
    return row.count
  }

  delete(workspaceId: string, conversationId: string): boolean {
    return this.database.db.prepare('DELETE FROM conversations WHERE id = ? AND workspace_id = ?')
      .run(conversationId, workspaceId).changes > 0
  }

  audit(conversationId: string, action: string, data: unknown): void {
    this.database.db.prepare('INSERT INTO conversation_audits (conversation_id, action, data_json, created_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, action, JSON.stringify(data), nowIso())
  }
}
