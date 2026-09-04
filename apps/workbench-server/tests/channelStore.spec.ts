import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { WorkbenchDb } from '../src/db/index.js'
import { ChannelStore } from '../src/services/channelStore.js'
import type { ChannelInboundMessage } from '@codycodeagent/cody-web-core/channel'

function inbound(accountId: string, eventId = 'event-1', messageId = `message-${eventId}`): ChannelInboundMessage {
  return {
    provider: 'feishu', accountId, eventId, messageId,
    conversation: { id: 'chat-1', scope: 'private', rootId: 'root-1' }, sender: { id: 'user-1', type: 'user' },
    text: 'hello', attachments: [], addressedToAgent: true, mentionsOtherRecipient: false, createdAtIso: new Date().toISOString(),
  }
}

describe('CodyWork channel persistence', () => {
  it('encrypts credentials and defaults to disabled, deny-by-default access', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const path = join(root, 'workspace.db')
    const db = new WorkbenchDb(path)
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_test', appSecret: 'super-secret' })
    expect(account).toMatchObject({ enabled: false, allowAllUsers: false, allowedUserIds: [], allowedConversationIds: [] })
    expect(store.getAccount(account.id).appSecret).toBe('super-secret')
    db.close()
    expect(readFileSync(path).includes(Buffer.from('super-secret'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('deduplicates inbound events and preserves outbox delivery state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_test', appSecret: 'secret' })
    const first = store.claimInbound(inbound(account.id))
    const duplicate = store.claimInbound(inbound(account.id))
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, item: { id: first.item.id } })

    const item = await store.enqueue({ id: 'outbox-1', provider: 'feishu', accountId: first.item.message.accountId, kind: 'send_text', targetId: 'chat-1', payload: { text: 'done' }, dedupeKey: 'stable-key', terminal: true })
    const duplicateOutbox = await store.enqueue({ id: 'outbox-2', provider: 'feishu', accountId: account.id, kind: 'send_text', targetId: 'chat-1', payload: { text: 'done' }, dedupeKey: 'stable-key', terminal: true })
    expect(duplicateOutbox.id).toBe(item.id)
    const claimed = await store.claim({ provider: 'feishu', accountId: first.item.message.accountId, limit: 10, leaseMs: 1_000, nowIso: new Date().toISOString() })
    expect(claimed).toHaveLength(1)
    await store.markSent(item.id, 'remote-1')
    expect(store.getOutbox(item.id)).toMatchObject({ status: 'sent', attempts: 1, remoteMessageId: 'remote-1' })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('deduplicates the same Feishu message even when it is redelivered with a different event id', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_message_dedupe', appSecret: 'secret' })
    const first = store.claimInbound(inbound(account.id, 'event-1', 'message-shared'))
    const duplicate = store.claimInbound(inbound(account.id, 'event-2', 'message-shared'))
    expect(duplicate).toMatchObject({ created: false, item: { id: first.item.id, message: { eventId: 'event-1' } } })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('deduplicates the same Feishu event even when its message id changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_event_dedupe', appSecret: 'secret' })
    const first = store.claimInbound(inbound(account.id, 'event-shared', 'message-1'))
    const duplicate = store.claimInbound(inbound(account.id, 'event-shared', 'message-2'))
    expect(duplicate).toMatchObject({ created: false, item: { id: first.item.id, message: { messageId: 'message-1' } } })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('claims each Feishu card action once and completes it with compare-and-set semantics', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_action_dedupe', appSecret: 'secret' })
    const first = store.claimAction(account.id, 'action-event-1', { action: 'channel.pick_workspace' })
    const duplicate = store.claimAction(account.id, 'action-event-1', { action: 'channel.pick_workspace' })
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ id: first.id, created: false, status: 'action_processing' })
    expect(store.finishAction(first.id, 'action_completed')).toBe(true)
    expect(store.finishAction(first.id, 'action_failed', 'late failure')).toBe(false)
    expect(store.claimAction(account.id, 'action-event-1', {})).toMatchObject({ created: false, status: 'action_completed' })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
})
