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
  function createBindingFixture(db: WorkbenchDb, store: ChannelStore, accountId: string) {
    const now = new Date().toISOString()
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run('workspace-1', 'Workspace', '/tmp/channel-workspace', now, now)
    db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('demand-1', 'workspace-1', 'Demand', 'channel-test', 'channel-test', 'in_progress', now, now)
    db.db.prepare('INSERT INTO conversations (id, demand_id, workspace_id, native_id, title, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('conversation-1', 'demand-1', 'workspace-1', 'thread-1', 'Channel', 'idle', 'workspace-write', 'policy', 'instructions', now, now)
    const binding = store.createBinding({
      message: inbound(accountId), targetType: 'codywork-demand', workspaceId: 'workspace-1', demandId: 'demand-1', conversationId: 'conversation-1',
      threadId: 'thread-1', ownerIdentity: 'user-1',
    })
    expect(store.listBindings(accountId)).toMatchObject([{ id: binding.id, conversationId: 'conversation-1', conversationTitle: 'Channel' }])
    expect(store.listBindingsForDemand('workspace-1', 'demand-1')).toMatchObject([{ id: binding.id, conversationId: 'conversation-1', conversationTitle: 'Channel' }])
    return binding
  }

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

  it('persists Workspace search bindings without inventing a Demand target', () => {
    const db = new WorkbenchDb(':memory:')
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Search Bot', appId: 'cli_search', appSecret: 'secret' })
    const now = new Date().toISOString()
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run('workspace-search', 'Search', '/tmp/channel-search-workspace', now, now)
    db.db.prepare("INSERT INTO conversations (id, scope, demand_id, workspace_id, native_id, title, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at) VALUES (?, 'workspace', NULL, ?, ?, ?, 'idle', 'read-only', ?, ?, ?, ?)")
      .run('conversation-search', 'workspace-search', 'thread-search', 'Read-only search', 'policy', 'instructions', now, now)

    const created = store.createBinding({
      message: inbound(account.id), targetType: 'codywork-workspace', workspaceId: 'workspace-search', demandId: null,
      conversationId: 'conversation-search', threadId: 'thread-search', ownerIdentity: 'user-1',
    })
    expect(created).toMatchObject({ targetType: 'codywork-workspace', targetId: 'workspace-search', demandId: null, conversationId: 'conversation-search' })
    expect(() => store.createBinding({
      message: inbound(account.id, 'bad-event', 'bad-message'), targetType: 'codywork-workspace', workspaceId: 'workspace-search', demandId: 'fake-demand',
      conversationId: 'conversation-search', threadId: 'thread-search', ownerIdentity: 'user-1',
    })).toThrow('不能关联 Demand')
    db.close()
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
    await store.markSending(item.id)
    expect(store.getOutbox(item.id)).toMatchObject({ status: 'sending', attempts: 1 })
    await store.markSent(item.id, 'remote-1')
    expect(store.getOutbox(item.id)).toMatchObject({ status: 'sent', attempts: 1, remoteMessageId: 'remote-1' })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('reclaims an expired sending lease after a process interruption', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_recovery', appSecret: 'secret' })
    const now = new Date('2026-09-05T00:00:00.000Z')
    const item = await store.enqueue({ id: 'outbox-recovery', provider: 'feishu', accountId: account.id, kind: 'send_text', targetId: 'chat-1', payload: { text: 'recover me' }, dedupeKey: 'recover-key', terminal: true, availableAtIso: now.toISOString() })

    expect(await store.claim({ provider: 'feishu', accountId: account.id, limit: 1, leaseMs: 1_000, nowIso: now.toISOString() })).toHaveLength(1)
    await store.markSending(item.id)
    const reclaimed = await store.claim({ provider: 'feishu', accountId: account.id, limit: 1, leaseMs: 1_000, nowIso: new Date(now.getTime() + 2_000).toISOString() })

    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0]).toMatchObject({ id: item.id, status: 'leased', attempts: 2 })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('enforces the phase-one single-bot boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Primary Bot', appId: 'cli_primary', appSecret: 'secret' })

    expect(() => store.saveAccount(null, { name: 'Second Bot', appId: 'cli_second', appSecret: 'secret' })).toThrow('一期只支持一个')
    expect(store.saveAccount(account.id, { name: 'Renamed Bot', appId: 'cli_primary', appSecret: '' })).toMatchObject({ id: account.id, name: 'Renamed Bot' })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('records channel activity without overwriting transport state or its last error', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_runtime', appSecret: 'secret' })
    store.updateRuntime(account.id, { connectionState: 'reconnecting', error: 'socket closed' })
    store.updateRuntime(account.id, { delivery: true })

    expect(store.getAccount(account.id)).toMatchObject({ connectionState: 'reconnecting', lastError: 'socket closed' })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('persists honest reconnect diagnostics and retains the last disconnect after recovery', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_connection_diagnostics', appSecret: 'secret' })
    store.updateRuntime(account.id, {
      connectionState: 'reconnecting',
      connectionDiagnostic: {
        state: 'reconnecting', atIso: '2026-09-05T01:00:00.000Z', reconnectAttempts: 2,
        lastConnectAtIso: '2026-09-05T00:59:00.000Z', nextConnectAtIso: '2026-09-05T01:00:10.000Z',
        closeCode: null, closeReason: 'Feishu WebSocket 已关闭，SDK 正在自动重连',
      },
    })
    expect(store.getAccount(account.id)).toMatchObject({
      connectionState: 'reconnecting', reconnectAttempts: 2, nextReconnectAt: '2026-09-05T01:00:10.000Z',
      lastCloseCode: null, lastCloseReason: 'Feishu WebSocket 已关闭，SDK 正在自动重连',
      lastDisconnectedAt: '2026-09-05T01:00:00.000Z',
    })
    store.updateRuntime(account.id, {
      connectionState: 'connected',
      connectionDiagnostic: {
        state: 'connected', atIso: '2026-09-05T01:00:08.000Z', reconnectAttempts: 0,
        lastConnectAtIso: '2026-09-05T01:00:08.000Z', nextConnectAtIso: null, closeCode: null, closeReason: '',
      },
    })
    expect(store.getAccount(account.id)).toMatchObject({
      connectionState: 'connected', reconnectAttempts: 0, nextReconnectAt: null,
      lastCloseReason: 'Feishu WebSocket 已关闭，SDK 正在自动重连',
    })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('reports queued work and retryable deliveries, and can remove a binding by id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_diagnostics', appSecret: 'secret' })
    const bound = createBindingFixture(db, store, account.id)
    const claimed = store.claimInbound(inbound(account.id, 'queued-event'))
    store.updateInbox(claimed.item.id, 'ready', { bindingId: bound.id })
    const outbox = await store.enqueue({ id: 'outbox-failed', provider: 'feishu', accountId: account.id, kind: 'send_text', targetId: 'chat-1', payload: { text: 'retry me' }, dedupeKey: 'failed-key', terminal: true })
    await store.claim({ provider: 'feishu', accountId: account.id, limit: 1, leaseMs: 1_000, nowIso: new Date().toISOString() })
    await store.markSending(outbox.id)
    await store.markRetry(outbox.id, 'network unavailable', new Date(Date.now() + 1_000).toISOString())

    expect(store.listBindingsForConversation(bound.conversationId)).toMatchObject([{ id: bound.id }])
    expect(store.diagnostics(account.id)).toMatchObject({
      inbox: { queued: 1 },
      outbox: { pending: 1, failures: [{ id: outbox.id, status: 'retry_wait', lastError: 'network unavailable' }] },
    })
    expect(store.deleteBindingById(account.id, bound.id)).toMatchObject({ id: bound.id })
    expect(store.deleteBindingById(account.id, bound.id)).toBeNull()
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

  it('namespaces process-local request ids by binding and native turn', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, { name: 'Test Bot', appId: 'cli_request_identity', appSecret: 'secret' })
    const binding = createBindingFixture(db, store, account.id)
    const first = store.saveInteractiveRequest({
      accountId: account.id, bindingId: binding.id, requestKey: `${binding.id}:turn-1:approval:0`, requestId: '0', turnId: 'turn-1',
      kind: 'approval', requesterIdentity: 'user-1', request: { method: 'exec' },
    })
    store.updateInteractiveRequest(account.id, first.id, { status: 'allowed-once' })
    const afterRestart = store.saveInteractiveRequest({
      accountId: account.id, bindingId: binding.id, requestKey: `${binding.id}:turn-2:approval:0`, requestId: '0', turnId: 'turn-2',
      kind: 'approval', requesterIdentity: 'user-1', request: { method: 'exec' },
    })

    expect(afterRestart.id).not.toBe(first.id)
    expect(store.getInteractiveRequest(account.id, '0')).toMatchObject({ id: afterRestart.id, turnId: 'turn-2', status: 'pending' })
    expect(store.getInteractiveRequestByConversation('conversation-1', '0', 'turn-1')).toMatchObject({ id: first.id })
    expect(store.getInteractiveRequestByConversation('conversation-1', '0', 'turn-2')).toMatchObject({ id: afterRestart.id })
    expect(new Set(store.listInteractiveRequestsByConversation('conversation-1', '0').map(row => row.id))).toEqual(new Set([afterRestart.id, first.id]))
    expect(store.listPendingInteractiveRequestsForTurn('conversation-1', 'turn-2')).toMatchObject([{ id: afterRestart.id }])
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('persists one pending access request and grants only its exact requester', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, {
      name: 'Test Bot', appId: 'cli_access_request', appSecret: 'secret', allowAllUsers: false, allowedUserIds: ['ou_owner'],
    })
    const source = store.claimInbound({ ...inbound(account.id), sender: { id: 'ou_guest', type: 'user' } }).item
    const input = {
      accountId: account.id, requesterIdentity: 'ou_guest', administratorIdentity: 'ou_owner',
      sourceInboxId: source.id, sourceConversationId: 'chat-1', sourceScope: 'private' as const,
      sourceMessageId: source.message.messageId, createdAtIso: '2026-09-05T00:00:00.000Z', expiresAtIso: '2026-09-12T00:00:00.000Z',
    }
    const first = store.createAccessRequest(input)
    const duplicate = store.createAccessRequest({ ...input, sourceMessageId: 'another-message' })

    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, request: { id: first.request.id, status: 'pending' } })
    expect(store.resolveAccessRequest({
      accountId: account.id, id: first.request.id, actorIdentity: 'ou_owner', decision: 'approved', resolvedAtIso: '2026-09-06T00:00:00.000Z',
    })).toMatchObject({ changed: true, request: { status: 'approved', requesterIdentity: 'ou_guest' } })
    expect(store.listAccounts()).toMatchObject([{ allowAllUsers: false, allowedUserIds: ['ou_owner', 'ou_guest'] }])
    expect(store.resolveAccessRequest({
      accountId: account.id, id: first.request.id, actorIdentity: 'ou_owner', decision: 'approved', resolvedAtIso: '2026-09-06T00:00:01.000Z',
    })).toMatchObject({ changed: false, request: { status: 'approved' } })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('expires access requests and never grants from a late approval', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-channel-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    const store = new ChannelStore(db)
    const account = store.saveAccount(null, {
      name: 'Test Bot', appId: 'cli_access_expiry', appSecret: 'secret', allowAllUsers: false, allowedUserIds: ['ou_owner'],
    })
    const source = store.claimInbound({ ...inbound(account.id), sender: { id: 'ou_guest', type: 'user' } }).item
    const request = store.createAccessRequest({
      accountId: account.id, requesterIdentity: 'ou_guest', administratorIdentity: 'ou_owner', sourceInboxId: source.id,
      sourceConversationId: 'chat-1', sourceScope: 'private', sourceMessageId: source.message.messageId,
      createdAtIso: '2026-09-05T00:00:00.000Z', expiresAtIso: '2026-09-12T00:00:00.000Z',
    }).request

    expect(store.resolveAccessRequest({
      accountId: account.id, id: request.id, actorIdentity: 'ou_owner', decision: 'approved', resolvedAtIso: '2026-09-13T00:00:00.000Z',
    })).toMatchObject({ changed: true, request: { status: 'expired' } })
    expect(store.listAccounts()).toMatchObject([{ allowAllUsers: false, allowedUserIds: ['ou_owner'] }])
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
})
