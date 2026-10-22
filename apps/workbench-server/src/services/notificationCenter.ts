import type { WorkbenchDb } from '../db/index.js'
import { makeId, nowIso } from '../db/index.js'
import type { FeishuCard } from '@codycodeagent/cody-web-core/feishu'

export interface NotificationInput {
  workspaceId: string; sourceKey: string; title: string; summary: string; outcome: string
  conversationId: string; demandId?: string | null; card: FeishuCard
  accountId?: string; recipientEmail?: string; recipientOpenId?: string; feishuEnabled?: boolean
  existingOutboxId?: string
}
export type NotificationHooks = {
  resolve: (accountId: string, email: string) => Promise<{ openId: string; email: string }>
  queue: (accountId: string, openId: string, card: FeishuCard, dedupeKey: string) => Promise<{ id: string }>
}
type Row = { id: string; workspace_id: string; source_key: string; title: string; summary: string; outcome: string; conversation_id: string; demand_id: string | null; created_at: string; read_at: string | null; card_json: string; account_id: string; recipient_email: string; recipient_open_id: string; outbox_id: string | null; delivery_error: string; delivery_state: string; generation: number }
const IN_FLIGHT = ['pending', 'leased', 'sending', 'retry_wait', 'sent']

/** A result inbox, not a transcript or a second channel delivery state machine. */
export class NotificationCenter {
  private readonly sending = new Map<string, Promise<void>>()
  private closed = false
  constructor(private readonly database: WorkbenchDb, private readonly hooks: NotificationHooks) {
    database.db.exec(`CREATE TABLE IF NOT EXISTS workbench_notifications (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, outcome TEXT NOT NULL,
      conversation_id TEXT NOT NULL, demand_id TEXT, created_at TEXT NOT NULL, read_at TEXT,
      card_json TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', recipient_email TEXT NOT NULL DEFAULT '',
      outbox_id TEXT, delivery_error TEXT NOT NULL DEFAULT '', delivery_state TEXT NOT NULL DEFAULT 'local_only', generation INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workspace_id, source_key));
      CREATE INDEX IF NOT EXISTS workbench_notification_unread ON workbench_notifications(workspace_id, read_at);`)
    const columns = database.db.prepare('PRAGMA table_info(workbench_notifications)').all() as { name: string }[]
    if (!columns.some(column => column.name === 'recipient_open_id')) database.db.exec("ALTER TABLE workbench_notifications ADD COLUMN recipient_open_id TEXT NOT NULL DEFAULT ''")
  }
  private row(workspaceId: string, id: string): Row {
    const row = this.database.db.prepare('SELECT * FROM workbench_notifications WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as Row | undefined
    if (!row) throw new Error('通知不存在或不属于当前 Workspace')
    return row
  }
  private view(row: Row) {
    const outbox = row.outbox_id ? this.database.db.prepare('SELECT status,last_error FROM channel_outbox WHERE id = ?').get(row.outbox_id) as { status: string; last_error: string | null } | undefined : undefined
    const preparing = ['preparing', 'enqueueing', 'failed'].includes(row.delivery_state) && !IN_FLIGHT.includes(outbox?.status ?? '')
    return { id: row.id, workspaceId: row.workspace_id, title: row.title, summary: row.summary, outcome: row.outcome, conversationId: row.conversation_id, demandId: row.demand_id, createdAt: row.created_at, readAt: row.read_at, accountId: row.account_id, recipientEmail: row.recipient_email, deliveryStatus: preparing ? row.delivery_state : outbox?.status ?? row.delivery_state, deliveryError: preparing ? row.delivery_error : outbox?.last_error ?? row.delivery_error }
  }
  list(workspaceId: string, unreadOnly = false, before?: number) {
    const rows = this.database.db.prepare(`SELECT rowid AS seq,* FROM workbench_notifications WHERE workspace_id = ? AND (? = 0 OR read_at IS NULL) AND rowid < ? ORDER BY rowid DESC LIMIT 51`).all(workspaceId, unreadOnly ? 1 : 0, before ?? Number.MAX_SAFE_INTEGER) as (Row & { seq: number })[]
    const page = rows.slice(0, 50)
    return { items: page.map(row => this.view(row)), nextCursor: rows.length > 50 ? page.at(-1)!.seq : null, unreadCount: (this.database.db.prepare('SELECT count(*) AS n FROM workbench_notifications WHERE workspace_id = ? AND read_at IS NULL').get(workspaceId) as { n: number }).n }
  }
  findSource(workspaceId: string, sourceKey: string) {
    const row = this.database.db.prepare('SELECT * FROM workbench_notifications WHERE workspace_id = ? AND source_key = ?').get(workspaceId, sourceKey) as Row | undefined
    return row ? this.view(row) : null
  }
  markRead(workspaceId: string, id?: string, read = true) {
    if (id) this.row(workspaceId, id)
    this.database.db.prepare(`UPDATE workbench_notifications SET read_at = ${read ? 'COALESCE(read_at, ?)' : '?'} WHERE workspace_id = ?${id ? ' AND id = ?' : ''}`).run(read ? nowIso() : null, workspaceId, ...(id ? [id] : []))
    return { saved: true }
  }
  async publish(input: NotificationInput): Promise<{ id: string; notificationId: string }> {
    if (this.closed) throw new Error('通知服务正在关闭')
    const id = makeId('notification')
    const inserted = this.database.db.prepare(`INSERT OR IGNORE INTO workbench_notifications(id,workspace_id,source_key,title,summary,outcome,conversation_id,demand_id,created_at,card_json,account_id,recipient_email,recipient_open_id,delivery_state,outbox_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.workspaceId, input.sourceKey, input.title.slice(0, 200), input.summary.slice(0, 4000), input.outcome, input.conversationId, input.demandId ?? null, nowIso(), JSON.stringify(input.card), input.accountId ?? '', input.recipientEmail ?? '', input.recipientOpenId ?? '', input.feishuEnabled ? 'preparing' : input.existingOutboxId ? 'pending' : 'local_only', input.existingOutboxId ?? null)
    const row = this.database.db.prepare('SELECT * FROM workbench_notifications WHERE workspace_id = ? AND source_key = ?').get(input.workspaceId, input.sourceKey) as Row
    // Duplicate event/restart must never re-send or reset unread state.
    if (inserted.changes && input.feishuEnabled) await this.deliver(row, input.accountId ?? '', input.recipientEmail ?? '', input.recipientOpenId)
    const current = this.row(input.workspaceId, row.id)
    return { id: current.outbox_id ?? `local:${row.id}`, notificationId: row.id }
  }
  async retry(workspaceId: string, id: string, accountId: string, email: string) {
    if (this.closed) throw new Error('通知服务正在关闭')
    const row = this.row(workspaceId, id)
    const state = this.view(row).deliveryStatus
    if (this.sending.has(id)) { await this.sending.get(id); return this.view(this.row(workspaceId, id)) }
    if ([...IN_FLIGHT, 'preparing', 'enqueueing'].includes(state)) throw new Error('通知已发送或仍在投递中，不能重复补发')
    if (!accountId || !email) throw new Error('请选择机器人并填写接收人邮箱')
    await this.deliver(row, accountId, email)
    return this.view(this.row(workspaceId, id))
  }
  /** Imports a pre-inbox result's existing receipt without permitting a second send. */
  adoptReceipt(workspaceId: string, id: string, outboxId: string): void {
    this.row(workspaceId, id)
    this.database.db.prepare("UPDATE workbench_notifications SET outbox_id=?,delivery_state='pending' WHERE workspace_id=? AND id=? AND outbox_id IS NULL AND generation=0 AND delivery_state IN ('local_only','failed') AND EXISTS(SELECT id FROM channel_outbox WHERE id=?)").run(outboxId, workspaceId, id, outboxId)
  }
  async recover(): Promise<void> {
    const rows = this.database.db.prepare("SELECT * FROM workbench_notifications WHERE delivery_state IN ('preparing','enqueueing') ORDER BY rowid").all() as Row[]
    for (const row of rows) {
      if (this.closed) return
      await this.deliver(row, row.account_id, row.recipient_email, row.recipient_open_id, true)
    }
  }
  async close(): Promise<void> { this.closed = true; await Promise.allSettled(this.sending.values()) }
  private async deliver(row: Row, accountId: string, email: string, legacyOpenId?: string, recovering = false): Promise<void> {
    if (this.sending.has(row.id)) { await this.sending.get(row.id); return }
    const operation = (async () => {
      try {
        if (recovering && row.delivery_state === 'enqueueing') {
          const existing = this.database.db.prepare('SELECT id FROM channel_outbox WHERE account_id=? AND dedupe_key=?').get(accountId, `notification:${row.id}:${row.generation}`) as { id: string } | undefined
          if (existing) { this.database.db.prepare("UPDATE workbench_notifications SET outbox_id=?,delivery_state='pending' WHERE id=?").run(existing.id, row.id); return }
        }
        this.database.db.prepare("UPDATE workbench_notifications SET account_id=?,recipient_email=?,recipient_open_id=?,delivery_state=?,delivery_error='' WHERE id=?").run(accountId, email, legacyOpenId ?? '', recovering && row.delivery_state === 'enqueueing' ? 'enqueueing' : 'preparing', row.id)
        const recipient = email ? (await this.hooks.resolve(accountId, email)).openId : legacyOpenId
        if (this.closed) return // durable intent is recovered on next startup
        if (!accountId || !recipient) throw new Error('飞书目标未配置；结果已保存在通知中心，请填写邮箱后补发')
        const generation = recovering && row.delivery_state === 'enqueueing' ? row.generation : row.generation + 1
        this.database.db.exec('BEGIN IMMEDIATE')
        try {
          if (row.outbox_id) {
            const previous = this.database.db.prepare('SELECT status FROM channel_outbox WHERE id=?').get(row.outbox_id) as { status: string } | undefined
            if (previous && IN_FLIGHT.includes(previous.status)) throw new Error('原投递已发送或恢复投递，未创建重复通知')
            this.database.db.prepare("UPDATE channel_outbox SET status='superseded',last_error='已修正通知目标，由新投递替代',updated_at=? WHERE id=? AND status='dead_letter'").run(nowIso(), row.outbox_id)
          }
          this.database.db.prepare("UPDATE workbench_notifications SET generation=?,outbox_id=NULL,recipient_open_id=?,delivery_state='enqueueing' WHERE id=?").run(generation, recipient, row.id)
          this.database.db.exec('COMMIT')
        } catch (error) { this.database.db.exec('ROLLBACK'); throw error }
        const item = await this.hooks.queue(accountId, recipient, JSON.parse(row.card_json) as FeishuCard, `notification:${row.id}:${generation}`)
        this.database.db.prepare("UPDATE workbench_notifications SET account_id=?,recipient_email=?,outbox_id=?,generation=?,delivery_state='pending',delivery_error='' WHERE id=?").run(accountId, email, item.id, generation, row.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const previous = row.outbox_id ? this.database.db.prepare('SELECT status FROM channel_outbox WHERE id=?').get(row.outbox_id) as { status: string } | undefined : undefined
        if (previous && IN_FLIGHT.includes(previous.status)) this.database.db.prepare('UPDATE workbench_notifications SET account_id=?,recipient_email=? WHERE id=?').run(row.account_id, row.recipient_email, row.id)
        this.database.db.prepare("UPDATE workbench_notifications SET delivery_state='failed',delivery_error=? WHERE id=?").run(message.slice(0, 1000), row.id)
      }
    })()
    this.sending.set(row.id, operation)
    try { await operation } finally { this.sending.delete(row.id) }
  }
}
