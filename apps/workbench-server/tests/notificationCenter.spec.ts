import { describe, it, expect, vi } from 'vitest'
import { WorkbenchDb } from '../src/db/index.js'
import { NotificationCenter, type NotificationInput } from '../src/services/notificationCenter.js'
import { ChannelStore } from '../src/services/channelStore.js'
import { feishuTextCard } from '@codycodeagent/cody-web-core/feishu'
function fixture() {
  const db = new WorkbenchDb(':memory:')
  db.db.exec("INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES('ws','Fixture','/tmp/notification-fixture','now','now'),('other','Other','/tmp/notification-other','now','now'); INSERT INTO channel_accounts(id,provider,name,app_id,secret_cipher,enabled,created_at,updated_at) VALUES('bot','feishu','Fixture','fixture','synthetic',1,'now','now')")
  const resolve = vi.fn(async (_account: string, email: string) => ({ email, openId: 'ou_scoped_to_bot' }))
  const store = new ChannelStore(db)
  const queue = vi.fn(async (accountId: string, targetId: string, card: unknown, dedupeKey: string) => store.enqueue({ id: dedupeKey, provider: 'feishu', accountId, targetId, kind: 'send_user_card', payload: { card }, dedupeKey, terminal: true }))
  const center = new NotificationCenter(db, { resolve, queue })
  const input: NotificationInput = { workspaceId: 'ws', sourceKey: 'result:1', title: 'Fixture task', summary: 'Finished', outcome: 'completed', conversationId: 'source', card: feishuTextCard('Fixture', 'Finished') }
  return { db, center, resolve, queue, input }
}
describe('workbench notification center', () => {
  it('persists local-only results without a bot, deduplicates and scopes read state', async () => {
    const { db, center, input, resolve, queue } = fixture()
    try {
      const a = await center.publish(input)
      await center.publish(input)
      expect(center.list('ws')).toMatchObject({ unreadCount: 1, items: [{ deliveryStatus: 'local_only', summary: 'Finished' }] })
      expect(center.list('other').items).toHaveLength(0)
      expect(() => center.markRead('other', a.notificationId)).toThrow('当前 Workspace')
      center.markRead('ws', a.notificationId)
      await center.publish(input)
      expect(center.list('ws', true).items).toHaveLength(0)
      expect(resolve).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled()
      expect(new NotificationCenter(db, { resolve, queue }).list('ws').unreadCount).toBe(0)
    } finally { db.close() }
  })
  it('keeps results and a visible failure when email lookup fails, then retries only delivery', async () => {
    const { db, center, input, resolve, queue } = fixture()
    try {
      resolve.mockRejectedValueOnce(new Error('邮箱不可见'))
      const published = await center.publish({ ...input, feishuEnabled: true, accountId: 'bot', recipientEmail: 'old@example.test' })
      expect(center.list('ws')).toMatchObject({ unreadCount: 1, items: [{ deliveryStatus: 'failed', deliveryError: '邮箱不可见' }] })
      expect(queue).not.toHaveBeenCalled()
      const retried = await center.retry('ws', published.notificationId, 'bot', 'new@example.test')
      expect(retried).toMatchObject({ deliveryStatus: 'pending', recipientEmail: 'new@example.test' })
      expect(queue.mock.calls[0]?.[1]).toBe('ou_scoped_to_bot')
      expect(center.list('ws').items).toHaveLength(1)
      await expect(center.retry('ws', published.notificationId, 'bot', 'new@example.test')).rejects.toThrow('仍在投递')
      expect(queue).toHaveBeenCalledTimes(1)
    } finally { db.close() }
  })
  it('joins real outbox status, blocks sent and retries failed receipts with a new immutable target', async () => {
    const { db, center, input, queue } = fixture()
    try {
      const published = await center.publish({ ...input, feishuEnabled: true, accountId: 'bot', recipientEmail: 'first@example.test' })
      db.db.prepare("UPDATE channel_outbox SET status='dead_letter',last_error='open_id cross app' WHERE id=?").run(published.id)
      expect(center.list('ws').items[0]).toMatchObject({ deliveryStatus: 'dead_letter', deliveryError: 'open_id cross app' })
      await center.retry('ws', published.notificationId, 'bot', 'second@example.test')
      expect(db.db.prepare('SELECT status FROM channel_outbox WHERE id=?').get(published.id)).toMatchObject({ status: 'superseded' })
      expect(() => new ChannelStore(db).retryOutbox('bot', published.id)).toThrow('不可重试')
      expect(queue).toHaveBeenCalledTimes(2)
      expect(queue.mock.calls[0]?.[3]).not.toBe(queue.mock.calls[1]?.[3])
      db.db.prepare("UPDATE channel_outbox SET status='sent' WHERE id=?").run(queue.mock.calls[1]?.[3])
      await expect(center.retry('ws', published.notificationId, 'bot', 'second@example.test')).rejects.toThrow('已发送')
    } finally { db.close() }
  })
  it('does not create a new delivery if the previous receipt was resumed during email resolution', async () => {
    const { db, center, input, resolve, queue } = fixture()
    try {
      const first = await center.publish({ ...input, feishuEnabled: true, accountId: 'bot', recipientEmail: 'first@example.test' })
      db.db.prepare("UPDATE channel_outbox SET status='dead_letter' WHERE id=?").run(first.id)
      let release!: () => void
      resolve.mockImplementationOnce(async (_id, email) => { await new Promise<void>(done => { release = done }); return { email, openId: 'ou_new' } })
      const retried = center.retry('ws', first.notificationId, 'bot', 'second@example.test')
      new ChannelStore(db).retryOutbox('bot', first.id)
      release(); await retried
      expect(queue).toHaveBeenCalledTimes(1)
      expect(center.list('ws').items[0]?.deliveryStatus).toBe('pending')
    } finally { db.close() }
  })
  it('recovers persisted send intent and adopts an already enqueued receipt without a duplicate', async () => {
    const { db, center, input, resolve, queue } = fixture()
    try {
      const local = await center.publish(input)
      db.db.prepare("UPDATE workbench_notifications SET delivery_state='preparing',account_id='bot',recipient_email='fixture@example.test' WHERE id=?").run(local.notificationId)
      expect(center.list('ws').items[0]?.deliveryStatus).toBe('preparing')
      await new NotificationCenter(db, { resolve, queue }).recover()
      expect(queue).toHaveBeenCalledTimes(1)
      // Simulate a crash after Outbox enqueue but before attaching its receipt.
      db.db.prepare("UPDATE workbench_notifications SET delivery_state='enqueueing',outbox_id=NULL WHERE id=?").run(local.notificationId)
      await new NotificationCenter(db, { resolve, queue }).recover()
      expect(queue).toHaveBeenCalledTimes(1)
      expect(center.list('ws').items[0]?.deliveryStatus).toBe('pending')
      expect(db.db.prepare('SELECT count(*) AS n FROM channel_outbox').get()).toMatchObject({ n: 1 })
    } finally { db.close() }
  })
  it('atomically imports a legacy receipt and repairs an orphaned older import before resend', async () => {
    const { db, center, input, queue } = fixture()
    try {
      await queue('bot', 'ou_old', input.card, 'legacy')
      db.db.prepare("UPDATE channel_outbox SET status='dead_letter' WHERE id='legacy'").run()
      const imported = await center.publish({ ...input, existingOutboxId: 'legacy' })
      expect(center.list('ws').items[0]?.deliveryStatus).toBe('dead_letter')
      // An older interrupted import had no pointer; old delivery is now sent.
      db.db.prepare("UPDATE workbench_notifications SET outbox_id=NULL,delivery_state='local_only' WHERE id=?").run(imported.notificationId)
      db.db.prepare("UPDATE channel_outbox SET status='sent' WHERE id='legacy'").run()
      center.adoptReceipt('ws', imported.notificationId, 'legacy')
      await expect(center.retry('ws', imported.notificationId, 'bot', 'new@example.test')).rejects.toThrow('已发送')
      expect(queue).toHaveBeenCalledTimes(1)
    } finally { db.close() }
  })
  it('serializes duplicate manual resends and paginates without dropping unread count', async () => {
    const { db, center, input, resolve, queue } = fixture()
    try {
      for (let i = 0; i < 55; i++) await center.publish({ ...input, sourceKey: `result:${i}` })
      const page = center.list('ws')
      expect(page.items).toHaveLength(50); expect(page.unreadCount).toBe(55)
      expect(center.list('ws', false, page.nextCursor!).items).toHaveLength(5)
      let release!: () => void
      resolve.mockImplementationOnce(async () => { await new Promise<void>(done => { release = done }); return { email: 'fixture@example.test', openId: 'ou_scoped_to_bot' } })
      const first = center.retry('ws', page.items[0]!.id, 'bot', 'fixture@example.test')
      const second = center.retry('ws', page.items[0]!.id, 'bot', 'fixture@example.test')
      release(); await Promise.all([first, second])
      expect(queue).toHaveBeenCalledTimes(1)
      center.markRead('ws'); expect(center.list('ws').unreadCount).toBe(0)
    } finally { db.close() }
  })
})
