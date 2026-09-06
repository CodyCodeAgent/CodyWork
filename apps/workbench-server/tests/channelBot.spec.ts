import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChannelInboundMessage, ChannelInboxItem } from '@codycodeagent/cody-web-core/channel'
import { WorkbenchDb } from '../src/db/index.js'
import { codyWorkConversationUrl, feishuProjectionBody } from '../src/services/channelBot.js'
import { projectionCard } from '../src/services/channelFeishuRenderer.js'
import { ChannelAccessService } from '../src/services/channelAccessService.js'
import { ChannelAccountManager } from '../src/services/channelAccountManager.js'
import { ChannelProjectionService } from '../src/services/channelProjection.js'
import { ChannelRouter } from '../src/services/channelRouter.js'
import { ChannelStore, type ChannelAccountSecret, type CodyWorkChannelBinding } from '../src/services/channelStore.js'
import { ConversationEventHub } from '../src/services/conversationEventHub.js'
import { ChannelRepositories } from '../src/services/channelRepositories.js'

function binding(id: string): CodyWorkChannelBinding {
  return {
    id, provider: 'feishu', accountId: 'account-1', conversationKey: `feishu:account-1:private:${id}:`,
    targetType: 'codywork-demand', targetId: 'demand-1', threadId: 'thread-1', ownerIdentity: `owner-${id}`,
    createdAtIso: '2026-09-05T00:00:00.000Z', updatedAtIso: '2026-09-05T00:00:00.000Z',
    workspaceId: 'workspace-1', demandId: 'demand-1', conversationId: 'conversation-1', channelConversationId: `chat-${id}`,
    channelScope: 'private', channelRootId: '', permissionMode: 'workspace-write', notificationPolicy: 'mirror-requests',
  }
}

function message(text = 'hello', eventId = 'event-1'): ChannelInboundMessage {
  return {
    provider: 'feishu', accountId: 'account-1', eventId, messageId: `message-${eventId}`,
    conversation: { id: 'chat-1', scope: 'private' }, sender: { id: 'owner-binding-1', type: 'user' },
    text, attachments: [], addressedToAgent: true, mentionsOtherRecipient: false, createdAtIso: '2026-09-05T00:00:00.000Z',
  }
}

function inbox(id: string, value: ChannelInboundMessage): ChannelInboxItem {
  return { id, message: value, conversationKey: 'feishu:account-1:private:chat-1:', status: 'received', createdAtIso: value.createdAtIso, updatedAtIso: value.createdAtIso }
}

function routerHarness(input: { message?: ChannelInboundMessage; account?: Record<string, unknown>; binding?: CodyWorkChannelBinding | null; profile?: Record<string, unknown> | null } = {}) {
  const inbound = input.message ?? message()
  const claimed = inbox('inbox-1', inbound)
  const account = { id: 'account-1', enabled: true, allowAllUsers: true, allowedUserIds: [], allowedConversationIds: [], groupMentionMode: 'always', ...input.account }
  const store = {
    getGroupProfile: vi.fn(() => input.profile ?? null), claimInbound: vi.fn((value: ChannelInboundMessage) => ({ item: { ...claimed, message: value }, created: true })),
    listAccounts: vi.fn(() => [account]), updateRuntime: vi.fn(), findBinding: vi.fn(() => input.binding ?? null),
    updateInbox: vi.fn((_id: string, status: string) => ({ ...claimed, status })), audit: vi.fn(),
    claimAction: vi.fn(() => ({ id: 'action-1', created: true, status: 'action_received' })), finishAction: vi.fn(),
  }
  const access = { request: vi.fn(), handleAction: vi.fn() }
  const requests = { handleApprovalAction: vi.fn(), handleQuestionAction: vi.fn() }
  const bindings = { requestWorkspace: vi.fn(), bindConfiguredTopic: vi.fn(), bindConfiguredReply: vi.fn(), handleAction: vi.fn() }
  const hooks = {
    enqueue: vi.fn(async () => ({ id: 'outbox-1' })), submitInbox: vi.fn(), observe: vi.fn(), detachBindingObservation: vi.fn(),
    openUrl: vi.fn(() => ''), accountState: vi.fn(() => 'connected'), retryOutbox: vi.fn(), fail: vi.fn(),
  }
  const router = new ChannelRouter(new ChannelRepositories(store as never), {} as never, access as never, requests as never, bindings as never, hooks as never)
  return { router, inbound, claimed, account, store, access, bindings, hooks }
}

function findActionValue(value: unknown, action: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const child of value) { const found = findActionValue(child, action); if (found) return found }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.action === action) return row
  for (const child of Object.values(row)) { const found = findActionValue(child, action); if (found) return found }
  return null
}

describe('CodyWork channel architecture and lifecycle', () => {
  it('keeps ChannelBot as a small composition root', async () => {
    const source = await readFile(new URL('../src/services/channelBot.ts', import.meta.url), 'utf8')
    expect(source.split('\n').length).toBeLessThan(350)
    for (const dependency of ['ChannelAccountManager', 'ChannelRouter', 'ChannelBindingService', 'ChannelCommandAdapter', 'ChannelProjectionService', 'ChannelRequestBridge']) expect(source).toContain(`new ${dependency}`)
    expect(source).not.toContain('private async onMessage(')
    expect(source).not.toContain('private onConversationEvent(')
  })

  it('injects repository ports instead of the broad SQL store into workflow components', async () => {
    for (const file of ['channelAccountManager.ts', 'channelAccessService.ts', 'channelBindingService.ts', 'channelCommandAdapter.ts', 'channelProjection.ts', 'channelRequestBridge.ts', 'channelRouter.ts']) {
      const source = await readFile(new URL(`../src/services/${file}`, import.meta.url), 'utf8')
      expect(source, file).not.toContain('private readonly store: ChannelStore')
      expect(source, file).toContain('ChannelRepositoryPorts')
    }
  })

  it('keeps conversation metadata, policy resolution and Feishu rendering outside orchestration facades', async () => {
    const conversations = await readFile(new URL('../src/services/conversations.ts', import.meta.url), 'utf8')
    const channelBot = await readFile(new URL('../src/services/channelBot.ts', import.meta.url), 'utf8')
    const projection = await readFile(new URL('../src/services/channelProjection.ts', import.meta.url), 'utf8')
    expect(conversations).not.toContain('.db.prepare(')
    expect(conversations).toContain('new ConversationRepository(db)')
    expect(conversations).toContain('new ConversationContextResolver(db)')
    expect(channelBot).not.toContain('private readonly store: ChannelStore')
    expect(projection).not.toContain('function projectionCard(')
    expect(projection).toContain("from './channelFeishuRenderer.js'")
  })

  it('routes Feishu control actions through the shared origin-aware conversation gateway', async () => {
    for (const file of ['channelRequestBridge.ts', 'channelRouter.ts']) {
      const source = await readFile(new URL(`../src/services/${file}`, import.meta.url), 'utf8')
      expect(source, file).toContain('.executeAction({')
      expect(source, file).not.toMatch(/\.conversations\.(approve|answer|interrupt)\(/u)
    }
  })

  it('builds a scoped browser link and sanitizes assistant image Markdown', () => {
    expect(codyWorkConversationUrl('http://10.37.222.12:3001/old?debug=1', binding('binding-1'))).toBe('http://10.37.222.12:3001/?workspace=workspace-1&demand=demand-1&conversation=conversation-1')
    expect(codyWorkConversationUrl('javascript:alert(1)', binding('binding-1'))).toBe('')
    expect(feishuProjectionBody({ threadId: 'thread-1', turnId: 'turn-1', status: 'completed', terminal: true, revision: 1, assistantText: 'Done\n\n![OK](/safe/a.png)', assistantImages: ['/safe/a.png'], error: '' })).toBe('Done\n\n🖼️ OK')
  })

  it('does not render a waiting message after an empty turn has completed', () => {
    const card = projectionCard({
      threadId: 'thread-1', turnId: 'turn-1', status: 'completed', terminal: true,
      revision: 1, assistantText: '', assistantImages: [], error: '',
    }, 'finish silently')
    expect(JSON.stringify(card)).toContain('本次回复已完成，Codex 未返回可显示的文本。')
    expect(JSON.stringify(card)).not.toContain('正在等待 Codex 输出')
  })

  it('routes unauthorized private traffic to access approval, not Codex', async () => {
    const incoming = message()
    incoming.sender.id = 'ou_guest'
    const test = routerHarness({ message: incoming, account: { allowAllUsers: false, allowedUserIds: ['ou_owner'] } })
    await test.router.onMessage(incoming)
    expect(test.access.request).toHaveBeenCalledWith(test.account, incoming, test.claimed.id)
    expect(test.hooks.submitInbox).not.toHaveBeenCalled()
  })

  it('normalizes a configured group root to topic identity before Inbox claim', async () => {
    const incoming = message()
    incoming.conversation = { id: 'group-1', scope: 'group' }
    const test = routerHarness({ message: incoming, account: { enabled: false }, profile: { conversationMode: 'topic' } })
    await test.router.onMessage(incoming)
    expect(test.store.claimInbound).toHaveBeenCalledWith(expect.objectContaining({ conversation: { id: 'group-1', scope: 'topic', rootId: incoming.messageId } }))
  })

  it('deduplicates card actions before executing side effects', async () => {
    const test = routerHarness()
    test.store.claimAction.mockReturnValueOnce({ id: 'action-1', created: true, status: 'action_received' }).mockReturnValueOnce({ id: 'action-1', created: false, status: 'action_completed' })
    const action = { eventId: 'event-1', actorId: 'user-1', remoteMessageId: 'message-1', value: { action: 'channel.retry_outbox', outboxId: 'outbox-1' } }
    await test.router.onAction('account-1', action)
    await test.router.onAction('account-1', action)
    expect(test.hooks.retryOutbox).toHaveBeenCalledTimes(1)
    expect(test.store.finishAction).toHaveBeenCalledTimes(1)
  })

  it('grants a signed access request only through the administrator action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codywork-access-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    try {
      const store = new ChannelStore(db)
      const account = store.saveAccount(null, { name: 'Bot', appId: 'cli_access', appSecret: 'secret', allowAllUsers: false, allowedUserIds: ['ou_owner'] })
      const incoming = message('grant', 'access')
      incoming.accountId = account.id
      incoming.sender.id = 'ou_guest'
      const source = store.claimInbound(incoming).item
      const deliveries: any[] = []
      const access = new ChannelAccessService(new ChannelRepositories(store), async (_accountId, delivery) => {
        deliveries.push(delivery)
        return { id: `outbox-${deliveries.length}`, remoteMessageId: delivery.kind === 'send_user_card' ? 'admin-card' : undefined } as never
      }, vi.fn(), () => new Date('2026-09-05T00:00:00.000Z'))
      await access.request(account, incoming, source.id)
      const token = String(findActionValue(deliveries[0].payload.card, 'channel.access_approve')?.accessRequestToken ?? '')
      await expect(access.handleAction(account.id, { value: { action: 'channel.access_approve', accessRequestToken: `${token}x` }, actorId: 'ou_owner', remoteMessageId: 'admin-card', eventId: 'bad' })).rejects.toThrow('校验失败')
      await access.handleAction(account.id, { value: { action: 'channel.access_approve', accessRequestToken: token }, actorId: 'ou_owner', remoteMessageId: 'admin-card', eventId: 'ok' })
      expect(store.listAccounts()).toMatchObject([{ allowedUserIds: ['ou_owner', 'ou_guest'] }])
    } finally { db.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('rolls an account update back when the replacement provider cannot reconnect', async () => {
    const previous: ChannelAccountSecret = {
      id: 'account-1', provider: 'feishu', name: 'Stable', appId: 'cli_stable', appSecret: 'secret', appSecretConfigured: true, domain: 'feishu', enabled: true,
      allowAllUsers: false, allowedUserIds: ['user-1'], allowedConversationIds: [], groupMentionMode: 'always', privateConversationMode: 'chat', botOpenId: '', botName: '',
      connectionState: 'connected', lastError: '', lastCloseCode: null, lastCloseReason: '', lastDisconnectedAt: null, reconnectAttempts: 0, nextReconnectAt: null,
      connectedAt: null, lastEventAt: null, lastDeliveryAt: null, createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    }
    let current = previous
    const store = { validateAccountInput: vi.fn(), getAccount: () => current, saveAccount: (_id: string, value: any) => (current = { ...previous, ...value }), restoreAccount: vi.fn((value: ChannelAccountSecret) => { current = value }), listAccounts: () => [current], audit: vi.fn() }
    const manager = new ChannelAccountManager(new ChannelRepositories(store as never), {} as never) as any
    manager.probeAccount = vi.fn(); manager.stopAccount = vi.fn(); manager.startAccount = vi.fn().mockRejectedValueOnce(new Error('candidate connection failed')).mockResolvedValueOnce(undefined)
    await expect(manager.save(previous.id, { name: 'Broken', appId: 'cli_broken', appSecret: 'broken', enabled: true })).rejects.toThrow('candidate connection failed')
    expect(store.restoreAccount).toHaveBeenCalledWith(previous)
  })

  it('validates and delivers local images inside the account transport boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codywork-image-'))
    const path = join(root, 'result.png')
    await writeFile(path, 'synthetic-image')
    try {
      const manager = new ChannelAccountManager(new ChannelRepositories({ updateRuntime: vi.fn(), audit: vi.fn() } as never), { validateLocalImage: vi.fn(async () => true) } as never) as any
      const provider = { uploadImage: vi.fn(async () => 'image-key'), replyImage: vi.fn(async () => 'remote-image'), sendImage: vi.fn(), getState: () => 'connected' }
      const result = await manager.deliver(provider, 'account-1', { id: 'outbox-1', provider: 'feishu', accountId: 'account-1', kind: 'send_local_image', targetId: 'chat-1', payload: { path, root, replyMessageId: 'source', replyInThread: true }, dedupeKey: 'image', status: 'leased', attempts: 1, availableAtIso: '2026-09-05T00:00:00.000Z' })
      expect(provider.uploadImage).toHaveBeenCalledWith(Buffer.from('synthetic-image'))
      expect(result).toEqual({ remoteMessageId: 'remote-image' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('serializes card projection revisions for the same turn', async () => {
    vi.useFakeTimers()
    try {
      const projection = new ChannelProjectionService({} as never, new ChannelRepositories({} as never), { events: new ConversationEventHub() } as never, {} as never, {} as never, { fail: vi.fn() } as never) as any
      let finish: (() => void) | undefined
      projection.render = vi.fn().mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve })).mockResolvedValueOnce(undefined)
      projection.scheduleRender(binding('binding-1'), 'turn-1', true)
      await vi.advanceTimersByTimeAsync(0)
      projection.scheduleRender(binding('binding-1'), 'turn-1', true)
      await vi.advanceTimersByTimeAsync(0)
      expect(projection.render).toHaveBeenCalledTimes(1)
      finish?.(); await vi.runAllTimersAsync()
      expect(projection.render).toHaveBeenCalledTimes(2)
      projection.close()
    } finally { vi.useRealTimers() }
  })
})
