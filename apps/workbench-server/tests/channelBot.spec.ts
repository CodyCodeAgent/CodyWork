import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationState } from '@codycodeagent/cody-web-core/conversation'
import type { ChannelInboundMessage, ChannelInboxItem } from '@codycodeagent/cody-web-core/channel'
import type { ConversationEvent } from '../src/services/conversations.js'
import { CodyWorkChannelService, codyWorkConversationUrl, feishuProjectionBody } from '../src/services/channelBot.js'
import { ChannelStore, type ChannelAccountSecret, type CodyWorkChannelBinding } from '../src/services/channelStore.js'
import { WorkbenchDb } from '../src/db/index.js'

function binding(id: string, conversationId = 'conversation-1'): CodyWorkChannelBinding {
  return {
    id, provider: 'feishu', accountId: 'account-1', conversationKey: `feishu:account-1:private:${id}:`,
    targetType: 'codywork-demand', targetId: 'demand-1', threadId: 'thread-1', ownerIdentity: `owner-${id}`,
    createdAtIso: '2026-09-05T00:00:00.000Z', updatedAtIso: '2026-09-05T00:00:00.000Z',
    workspaceId: 'workspace-1', demandId: 'demand-1', conversationId, channelConversationId: `chat-${id}`,
    channelScope: 'private', channelRootId: '',
  }
}

function message(text: string, eventId: string): ChannelInboundMessage {
  return {
    provider: 'feishu', accountId: 'account-1', eventId, messageId: `message-${eventId}`,
    conversation: { id: 'chat-1', scope: 'private' }, sender: { id: 'owner-binding-1', type: 'user' },
    text, attachments: [], addressedToAgent: true, mentionsOtherRecipient: false, createdAtIso: '2026-09-05T00:00:00.000Z',
  }
}

function inbox(id: string, text: string, bindingId?: string): ChannelInboxItem {
  return {
    id, message: message(text, id), conversationKey: 'feishu:account-1:private:chat-1:', status: 'received',
    ...(bindingId ? { bindingId } : {}), createdAtIso: '2026-09-05T00:00:00.000Z', updatedAtIso: '2026-09-05T00:00:00.000Z',
  }
}

function event(type: ConversationEvent['type'], input: Partial<ConversationEvent> = {}): ConversationEvent {
  return {
    id: `event-${type}`, type, conversationId: 'conversation-1', threadId: 'thread-1', timestamp: '2026-09-05T00:00:00.000Z',
    atIso: '2026-09-05T00:00:00.000Z', data: {}, ...input,
  }
}

function bareService(): any {
  const service = Object.create(CodyWorkChannelService.prototype)
  Object.assign(service, {
    observed: new Map(), observationInitializations: new Map(), pendingConversationEvents: new Map(), renderTimers: new Map(), renderInFlight: new Map(), flushInFlight: new Map(), reconciliationInFlight: new Set(), reconnectTimers: new Map(), runtimes: new Map(),
  })
  return service
}

function findActionValue(value: unknown, action: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findActionValue(child, action)
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.action === action) return row
  for (const child of Object.values(row)) {
    const found = findActionValue(child, action)
    if (found) return found
  }
  return null
}

describe('CodyWork channel lifecycle', () => {
  it('builds an exact authenticated-browser deep link without inheriting unrelated query state', () => {
    expect(codyWorkConversationUrl('http://10.37.222.12:3001/old?debug=1', binding('binding-1'))).toBe(
      'http://10.37.222.12:3001/?workspace=workspace-1&demand=demand-1&conversation=conversation-1',
    )
    expect(codyWorkConversationUrl('javascript:alert(1)', binding('binding-1'))).toBe('')
    expect(codyWorkConversationUrl('http://10.37.222.12:3001/old?debug=1', {
      ...binding('workspace-binding'), targetType: 'codywork-workspace', targetId: 'workspace-1', demandId: null,
    })).toBe('http://10.37.222.12:3001/?workspace=workspace-1&conversation=conversation-1')
  })

  it('removes local Markdown image syntax from Feishu cards while retaining a readable placeholder', () => {
    expect(feishuProjectionBody({
      threadId: 'thread-1', turnId: 'turn-1', status: 'completed', terminal: true, revision: 1,
      assistantText: 'Done\n\n![CHANNEL IMAGE OK](/safe/image.png)', assistantImages: ['/safe/image.png'], error: '',
    })).toBe('Done\n\n🖼️ CHANNEL IMAGE OK')
  })

  it('uploads a durable local image delivery and replies inside its source topic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codywork-channel-'))
    const path = join(root, 'result.png')
    await writeFile(path, 'synthetic-image')
    try {
      const service = bareService()
      service.store = { updateRuntime: vi.fn(), audit: vi.fn() }
      service.isAllowedChannelImage = vi.fn(async () => true)
      const provider = {
        uploadImage: vi.fn(async () => 'image-key'),
        replyImage: vi.fn(async () => 'remote-image'),
        sendImage: vi.fn(), getState: () => 'connected',
      }

      const result = await service.deliver(provider, 'account-1', {
        id: 'outbox-1', provider: 'feishu', accountId: 'account-1', kind: 'send_local_image', targetId: 'chat-1',
        payload: { path, root, replyMessageId: 'source-message', replyInThread: true }, dedupeKey: 'image-1',
        status: 'leased', attempts: 1, availableAtIso: '2026-09-05T00:00:00.000Z',
      })

      expect(provider.uploadImage).toHaveBeenCalledWith(Buffer.from('synthetic-image'))
      expect(provider.replyImage).toHaveBeenCalledWith('source-message', 'image-key', true, expect.any(String))
      expect(provider.sendImage).not.toHaveBeenCalled()
      expect(service.store.audit).toHaveBeenCalledWith('account-1', 'channel.outbox.delivered', 'channel_outbox', 'outbox-1', true, {
        provider: 'feishu', accountId: 'account-1', outboxId: 'outbox-1',
      }, '')
      expect(result).toEqual({ remoteMessageId: 'remote-image' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('applies the conversation allowlist to group topics as well as root group messages', () => {
    const service = bareService()
    const account = {
      allowAllUsers: true,
      allowedUserIds: [],
      allowedConversationIds: [],
      groupMentionMode: 'always',
    }
    const topicMessage = message('hello', 'topic-denied')
    topicMessage.conversation = { id: 'group-chat-1', scope: 'topic', rootId: 'thread-root-1' }

    expect(service.allowed(account, topicMessage, null)).toEqual({ allowed: false, reason: 'conversation_denied' })
    account.allowedConversationIds.push('group-chat-1')
    expect(service.allowed(account, topicMessage, null)).toEqual({ allowed: true, reason: '' })
  })

  it('keeps unauthorized ambient, disallowed, and ambiguous group traffic silent', () => {
    const service = bareService()
    const account = { allowAllUsers: false, allowedUserIds: ['ou_owner'], allowedConversationIds: ['group-chat-1'], groupMentionMode: 'always' }
    const incoming = message('hello', 'access-boundary')
    incoming.sender.id = 'ou_guest'
    incoming.conversation = { id: 'group-chat-1', scope: 'group' }
    incoming.addressedToAgent = false
    expect(service.allowed(account, incoming, null)).toEqual({ allowed: false, reason: 'mention_required' })

    incoming.conversation.id = 'unknown-group'
    incoming.addressedToAgent = true
    expect(service.allowed(account, incoming, null)).toEqual({ allowed: false, reason: 'conversation_denied' })

    incoming.conversation.id = 'group-chat-1'
    incoming.mentionsOtherRecipient = true
    expect(service.allowed(account, incoming, null)).toEqual({ allowed: false, reason: 'addressed_elsewhere' })

    incoming.mentionsOtherRecipient = false
    expect(service.allowed(account, incoming, null)).toEqual({ allowed: false, reason: 'sender_denied' })
  })

  it('routes an explicit unauthorized private message into access-request handling instead of a Codex turn', async () => {
    const service = bareService()
    const incoming = message('hello', 'unauthorized-private')
    incoming.sender.id = 'ou_guest'
    const claimed = inbox('unauthorized-inbox', incoming.text)
    claimed.message = incoming
    const account = {
      id: 'account-1', enabled: true, allowAllUsers: false, allowedUserIds: ['ou_owner'], allowedConversationIds: [], groupMentionMode: 'always',
    }
    service.store = {
      getGroupProfile: () => null, claimInbound: () => ({ item: claimed, created: true }), listAccounts: () => [account],
      updateRuntime: vi.fn(), findBinding: () => null,
    }
    service.requestAccess = vi.fn(async () => undefined)
    service.submitInbox = vi.fn(async () => undefined)

    await service.onMessage(incoming)

    expect(service.requestAccess).toHaveBeenCalledWith(account, incoming, claimed.id)
    expect(service.submitInbox).not.toHaveBeenCalled()
  })

  it('sends a signed narrow-access card and grants the requester after administrator approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codywork-channel-access-'))
    const db = new WorkbenchDb(join(root, 'workspace.db'))
    try {
      const store = new ChannelStore(db)
      const account = store.saveAccount(null, {
        name: 'Test Bot', appId: 'cli_access_flow', appSecret: 'secret', allowAllUsers: false, allowedUserIds: ['ou_owner'],
      })
      const incoming = message('please grant access', 'access-flow')
      incoming.accountId = account.id
      incoming.sender.id = 'ou_guest'
      const source = store.claimInbound(incoming).item
      const service = bareService()
      service.store = store
      service.options = { now: () => new Date('2026-09-05T00:00:00.000Z') }
      const deliveries: any[] = []
      service.enqueue = vi.fn(async (_accountId: string, input: any) => {
        deliveries.push(input)
        return { id: `outbox-${deliveries.length}`, remoteMessageId: input.kind === 'send_user_card' && input.targetId === 'ou_owner' ? 'admin-card-1' : undefined }
      })

      await service.requestAccess(account, incoming, source.id)

      expect(deliveries).toMatchObject([
        { kind: 'send_user_card', targetId: 'ou_owner' },
        { kind: 'reply_text', targetId: incoming.messageId, payload: { text: expect.stringContaining('已向管理员发送访问申请') } },
      ])
      const token = String(findActionValue(deliveries[0].payload.card, 'channel.access_approve')?.accessRequestToken ?? '')
      expect(token).not.toBe('')
      await expect(service.handleAccessAction(account.id, {
        value: { action: 'channel.access_approve', accessRequestToken: `${token}x` }, actorId: 'ou_owner', remoteMessageId: 'admin-card-1', eventId: 'tampered',
      })).rejects.toThrow('校验失败')
      await expect(service.handleAccessAction(account.id, {
        value: { action: 'channel.access_approve', accessRequestToken: token }, actorId: 'ou_guest', remoteMessageId: 'admin-card-1', eventId: 'wrong-actor',
      })).rejects.toThrow('只有机器人管理员')

      service.options.now = () => new Date('2026-09-06T00:00:00.000Z')
      const resolved = await service.handleAccessAction(account.id, {
        value: { action: 'channel.access_approve', accessRequestToken: token }, actorId: 'ou_owner', remoteMessageId: 'admin-card-1', eventId: 'approved',
      })
      expect(JSON.stringify(resolved)).toContain('已允许访问')
      expect(JSON.stringify(resolved)).not.toContain('channel.access_')
      expect(store.listAccounts()).toMatchObject([{ allowAllUsers: false, allowedUserIds: ['ou_owner', 'ou_guest'] }])
      expect(deliveries.slice(2)).toMatchObject([
        { kind: 'update_card', targetId: 'admin-card-1' },
        { kind: 'send_user_card', targetId: 'ou_guest' },
      ])
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores the previous account and runtime when a reconnecting update fails', async () => {
    const service = bareService()
    const previous: ChannelAccountSecret = {
      id: 'account-1', provider: 'feishu', name: 'Stable Bot', appId: 'cli_stable', appSecret: 'stable-secret',
      appSecretConfigured: true, domain: 'feishu', enabled: true, allowAllUsers: false,
      allowedUserIds: ['user-1'], allowedConversationIds: ['chat-1'], groupMentionMode: 'always',
      privateConversationMode: 'chat', botOpenId: 'bot-1', botName: 'Stable Bot', connectionState: 'connected',
      lastError: '', lastCloseCode: null, lastCloseReason: '', lastDisconnectedAt: null, reconnectAttempts: 0, nextReconnectAt: null,
      connectedAt: '2026-09-05T00:00:00.000Z', lastEventAt: null, lastDeliveryAt: null,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    }
    let current = previous
    const restoreAccount = vi.fn((value: ChannelAccountSecret) => { current = value })
    service.store = {
      validateAccountInput: vi.fn(),
      getAccount: () => current,
      saveAccount: (_id: string, input: any) => {
        current = { ...previous, ...input, appSecret: input.appSecret || previous.appSecret, appSecretConfigured: true }
        return current
      },
      restoreAccount,
      listAccounts: () => [current],
      audit: vi.fn(),
    }
    service.probeAccount = vi.fn(async () => undefined)
    service.stopAccount = vi.fn(async () => undefined)
    service.startAccount = vi.fn()
      .mockRejectedValueOnce(new Error('candidate connection failed'))
      .mockResolvedValueOnce(undefined)

    await expect(service.saveAccount(previous.id, {
      name: 'Broken Bot', appId: 'cli_broken', appSecret: 'broken-secret', enabled: true,
      allowedUserIds: ['user-1'], allowedConversationIds: ['chat-1'],
    })).rejects.toThrow('candidate connection failed')

    expect(restoreAccount).toHaveBeenCalledWith(previous)
    expect(service.startAccount).toHaveBeenNthCalledWith(1, previous.id)
    expect(service.startAccount).toHaveBeenNthCalledWith(2, previous.id)
    expect(current).toEqual(previous)
  })

  it('subscribes before reading history and replays only buffered events newer than the snapshot watermark', async () => {
    const service = bareService()
    const calls: string[] = []
    const applied: ConversationEvent[] = []
    service.conversations = {
      history: async () => {
        calls.push('history')
        service.receiveConversationEvent(event('turn.started', { turnId: 'turn-new', ownerRevision: 6 }))
        service.receiveConversationEvent(event('turn.started', { id: 'snapshot-event', turnId: 'turn-old', ownerRevision: 5 }))
        return { events: [event('turn.started', { id: 'snapshot-event', turnId: 'turn-old', ownerRevision: 5 })], watermark: 5 }
      },
    }
    service.store = { hasBindingForConversation: () => true }
    service.onConversationEventSafely = (_conversationId: string, value: ConversationEvent) => applied.push(value)

    await service.observe(binding('binding-1'))

    expect(calls).toEqual(['history'])
    expect(applied.map(value => value.turnId)).toEqual(['turn-new'])
  })

  it('observes a newly created empty thread without reading unsupported turn history', async () => {
    const service = bareService()
    const applied: ConversationEvent[] = []
    const history = vi.fn(async () => { throw new Error('list_turns is not supported yet') })
    service.conversations = { history }
    service.onConversationEventSafely = (_conversationId: string, value: ConversationEvent) => applied.push(value)

    await service.observe(binding('binding-new'), { emptyHistory: true })

    expect(history).not.toHaveBeenCalled()
    expect(service.observed.get('conversation-1')?.state).toEqual(createConversationState('thread-1'))
    expect(applied).toEqual([])
  })

  it('reconciles a Feishu turn from durable history when a realtime bound event was missed', async () => {
    const service = bareService()
    const value = binding('binding-1')
    const bound = event('command.bound', { itemId: 'channel-command-1', turnId: 'turn-1' })
    const completed = event('turn.completed', { turnId: 'turn-1' })
    service.conversations = { history: vi.fn(async () => ({ events: [bound, completed], watermark: 2 })) }
    service.store = {
      getTurnLinkByCommand: () => ({ id: 'link-1', inboxId: 'inbox-1', bindingId: value.id, clientCommandId: 'channel-command-1', turnId: '', status: 'submitted' }),
      updateTurnLink: vi.fn(), updateInbox: vi.fn(), audit: vi.fn(),
    }
    service.scheduleRender = vi.fn()
    service.observed.set(value.conversationId, { state: createConversationState(value.threadId), bindingIds: new Set([value.id]) })

    await service.reconcileActiveTurn(value, 'channel-command-1', '')

    expect(service.store.updateTurnLink).toHaveBeenCalledWith('channel-command-1', { turnId: 'turn-1', status: 'running' })
    expect(service.store.updateInbox).toHaveBeenCalledWith('inbox-1', 'submitted', { turnId: 'turn-1' })
    expect(service.scheduleRender).toHaveBeenCalledWith(value, 'turn-1', true)
  })

  it('serializes card renders for one turn so a terminal projection cannot reuse a running revision', async () => {
    vi.useFakeTimers()
    try {
      const service = bareService()
      const value = binding('binding-1')
      let finishFirst: (() => void) | undefined
      const first = new Promise<void>(resolve => { finishFirst = resolve })
      service.render = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(undefined)
      service.failAccount = vi.fn()

      service.scheduleRender(value, 'turn-1', true)
      await vi.advanceTimersByTimeAsync(0)
      expect(service.render).toHaveBeenCalledTimes(1)

      service.scheduleRender(value, 'turn-1', true)
      await vi.advanceTimersByTimeAsync(0)
      expect(service.render).toHaveBeenCalledTimes(1)

      finishFirst?.()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(service.render).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks a flat group to choose its session model before it chooses a Workspace', async () => {
    const service = bareService()
    const group = inbox('group-first', 'please help')
    group.message.conversation = { id: 'group-1', scope: 'group' }
    let delivery: any
    service.store = { updateInbox: () => group }
    service.enqueue = vi.fn(async (_accountId: string, input: any) => { delivery = input; return { id: 'outbox-1' } })

    await service.requestWorkspace(group.id)

    expect(delivery).toMatchObject({ kind: 'reply_card', targetId: group.message.messageId, payload: { replyInThread: false } })
    const body = JSON.stringify(delivery.payload.card)
    expect(body).toContain('回复原消息')
    expect(body).toContain('话题任务')
    expect(body).toContain('channel.pick_group_mode')
  })

  it('routes later configured group roots into their own topic conversation before the Inbox is claimed', async () => {
    const service = bareService()
    const incoming = message('new task', 'group-topic')
    incoming.conversation = { id: 'group-1', scope: 'group' }
    const claimed = inbox('group-topic-inbox', incoming.text)
    const storedMessages: ChannelInboundMessage[] = []
    service.store = {
      getGroupProfile: () => ({ accountId: 'account-1', channelConversationId: 'group-1', conversationMode: 'topic', targetType: 'codywork-demand', workspaceId: 'workspace-1', demandId: 'demand-1', permissionMode: 'yolo', ownerIdentity: 'owner-1' }),
      claimInbound: (value: ChannelInboundMessage) => { storedMessages.push(value); claimed.message = value; return { item: claimed, created: true } },
      listAccounts: () => [{ id: 'account-1', enabled: true }], updateRuntime: vi.fn(), findBinding: () => null,
    }
    service.allowed = () => ({ allowed: true, reason: '' })
    service.bindConfiguredGroupTopic = vi.fn(async () => undefined)

    await service.onMessage(incoming)

    expect(storedMessages[0]?.conversation).toEqual({ id: 'group-1', scope: 'topic', rootId: incoming.messageId })
    expect(service.bindConfiguredGroupTopic).toHaveBeenCalledWith(claimed.id, expect.objectContaining({ conversationMode: 'topic' }))
  })

  it('re-publishes only unresolved interactive requests recovered from the owner snapshot', async () => {
    const service = bareService()
    const value = binding('binding-1')
    const requested = event('approval.requested', { id: 'request-event', turnId: 'turn-pending', data: { requestId: '0', method: 'exec' } })
    const resolved = event('approval.resolved', { id: 'resolved-event', turnId: 'turn-resolved', data: { requestId: '1' } })
    service.conversations = { history: async () => ({ events: [requested, event('approval.requested', { id: 'old-request', turnId: 'turn-resolved', data: { requestId: '1', method: 'exec' } }), resolved], watermark: 3 }) }
    service.store = { getTurnLinkByConversationTurn: () => null, getBinding: () => value }
    service.publishRequest = vi.fn(async () => undefined)

    await service.observe(value)
    await Promise.resolve()

    expect(service.publishRequest).toHaveBeenCalledTimes(1)
    expect(service.publishRequest).toHaveBeenCalledWith(value, requested)
  })

  it('expires durable pending requests whose turn is already terminal in the owner snapshot', async () => {
    const service = bareService()
    const value = binding('binding-1')
    service.conversations = { history: async () => ({ events: [
      event('turn.started', { id: 'start', turnId: 'turn-stopped' }),
      event('approval.requested', { id: 'request', turnId: 'turn-stopped', data: { requestId: '0' } }),
      event('turn.interrupted', { id: 'stop', turnId: 'turn-stopped' }),
    ], watermark: 3 }) }
    service.expireTurnRequests = vi.fn()

    await service.observe(value)

    expect(service.expireTurnRequests).toHaveBeenCalledWith(value.conversationId, 'turn-stopped', 'turn.interrupted')
  })

  it('attaches persisted binding observers before connecting the external provider', async () => {
    const service = bareService()
    const calls: string[] = []
    const provider = {
      identity: vi.fn(async () => { calls.push('identity'); return { id: 'bot-1', name: 'Bot' } }),
      start: vi.fn(async () => { calls.push('provider'); return undefined }),
      stop: vi.fn(), classifyError: vi.fn(),
    }
    service.store = {
      getAccount: () => ({ ...binding('account-1'), id: 'account-1', enabled: true }),
      listBindings: () => [binding('binding-1')],
      updateRuntime: vi.fn(),
    }
    service.createProvider = () => provider
    service.recoverBindings = vi.fn(async () => { calls.push('bindings') })
    service.recoverInbox = vi.fn(async () => { calls.push('inbox') })
    service.flushAndReconcile = vi.fn(async () => { calls.push('flush') })
    service.reconcileActiveTurns = vi.fn(async () => { calls.push('turns') })

    await service.startAccount('account-1')

    expect(calls).toEqual(['bindings', 'identity', 'inbox', 'flush', 'turns', 'provider'])
    clearInterval(service.runtimes.get('account-1').flushTimer)
  })

  it('serializes overlapping outbox flushes for the same account', async () => {
    const service = bareService()
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const flush = vi.fn(() => blocked)
    service.runtimes.set('account-1', { outbox: { flush } })
    service.database = { db: { prepare: () => ({ all: () => [] }) } }

    const first = service.flushAndReconcile('account-1')
    const second = service.flushAndReconcile('account-1')

    expect(first).toBe(second)
    expect(flush).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(service.flushInFlight.size).toBe(0)
  })

  it('contains background flush failures even when failure persistence is also locked', async () => {
    const service = bareService()
    const error = new Error('database is locked')
    service.flushAndReconcile = vi.fn(async () => { throw error })
    service.store = {
      audit: vi.fn(() => { throw error }),
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    service.flushInBackground('account-1')
    await vi.waitFor(() => expect(service.store.audit).toHaveBeenCalled())

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('channel.outbox.background_flush failed'))
    consoleError.mockRestore()
  })

  it('installs every persisted observer before waiting for any history snapshot', async () => {
    const service = bareService()
    const pending: Array<() => void> = []
    const started: string[] = []
    service.store = {
      listBindings: () => [binding('binding-1', 'conversation-1'), binding('binding-2', 'conversation-2')],
      audit: vi.fn(),
    }
    service.observe = vi.fn((value: CodyWorkChannelBinding) => {
      started.push(value.conversationId)
      return new Promise<void>(resolve => pending.push(resolve))
    })

    const recovery = service.recoverBindings('account-1')
    expect(started).toEqual(['conversation-1', 'conversation-2'])
    pending.forEach(resolve => resolve())
    await recovery
  })

  it('isolates poison Inbox rows and never replays a failed control command as a Codex prompt', async () => {
    const service = bareService()
    const rows = [inbox('control', '/retry'), inbox('poison', 'bad payload', 'missing-binding'), inbox('good', 'continue', 'binding-1')]
    const updates: Array<{ id: string; status: string; error?: string }> = []
    const submitted: string[] = []
    service.store = {
      listBindings: () => [], pendingInbox: () => rows,
      getBinding: (id: string) => {
        if (id === 'missing-binding') throw new Error('binding is corrupt')
        return binding(id)
      },
      findBinding: () => null,
      updateInbox: (id: string, status: string, patch: { lastError?: string } = {}) => {
        updates.push({ id, status, ...(patch.lastError ? { error: patch.lastError } : {}) })
        return rows.find(row => row.id === id)
      },
      audit: vi.fn(),
    }
    service.observe = vi.fn(async () => undefined)
    service.submitInbox = vi.fn(async (id: string) => { submitted.push(id) })

    await service.recoverInbox('account-1')

    expect(submitted).toEqual(['good'])
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'control', status: 'failed', error: expect.stringContaining('控制命令') }),
      expect.objectContaining({ id: 'poison', status: 'failed', error: expect.stringContaining('binding is corrupt') }),
    ]))
  })

  it('claims a card action before executing it and ignores duplicate delivery', async () => {
    const service = bareService()
    const retry = vi.fn()
    let claimCount = 0
    service.store = {
      claimAction: () => (++claimCount === 1
        ? { id: 'action-1', created: true, status: 'action_processing' }
        : { id: 'action-1', created: false, status: 'action_completed' }),
      finishAction: vi.fn(() => true), audit: vi.fn(),
    }
    service.retryOutbox = retry
    const action = { eventId: 'event-1', actorId: 'user-1', remoteMessageId: 'message-1', value: { action: 'channel.retry_outbox', outboxId: 'outbox-1' }, option: '' }

    await service.onAction('account-1', action)
    await service.onAction('account-1', action)

    expect(retry).toHaveBeenCalledTimes(1)
    expect(service.store.finishAction).toHaveBeenCalledWith('action-1', 'action_completed')
  })

  it('returns binding progress as a raw card callback while retaining durable delivery', async () => {
    const service = bareService()
    const card = { header: { title: { content: '选择 CodyWork 需求' } } }
    service.store = {
      claimAction: () => ({ id: 'action-1', created: true, status: 'action_processing' }),
      finishAction: vi.fn(() => true), audit: vi.fn(),
    }
    service.handleBindingAction = vi.fn(async () => card)

    const response = await service.onAction('account-1', {
      eventId: 'event-1', actorId: 'user-1', remoteMessageId: 'message-1',
      value: { action: 'channel.pick_workspace', inboxId: 'inbox-1', workspaceId: 'workspace-1' }, option: '',
    })

    expect(response).toEqual({ card: { type: 'raw', data: card } })
    expect(service.store.finishAction).toHaveBeenCalledWith('action-1', 'action_completed')
  })

  it('routes interactive requests only to the binding that originated the native Turn', () => {
    const service = bareService()
    const source = binding('binding-1')
    const other = binding('binding-2')
    const publishRequest = vi.fn(async () => undefined)
    service.store = {
      getTurnLinkByCommand: () => null,
      getTurnLinkByConversationTurn: () => ({ id: 'link-1', inboxId: 'inbox-1', bindingId: source.id, clientCommandId: 'command-1', turnId: 'turn-1', status: 'running' }),
      getBinding: (id: string) => id === source.id ? source : other,
    }
    service.publishRequest = publishRequest
    service.scheduleRender = vi.fn()
    service.observed.set('conversation-1', {
      state: createConversationState('thread-1'), bindingIds: new Set([source.id, other.id]),
    })

    service.onConversationEvent('conversation-1', event('approval.requested', {
      turnId: 'turn-1', data: { requestId: 'approval-1', method: 'exec' },
    }))

    expect(publishRequest).toHaveBeenCalledTimes(1)
    expect(publishRequest).toHaveBeenCalledWith(source, expect.objectContaining({ turnId: 'turn-1' }))
  })

  it('bridges a browser-originated interactive request to one binding per account', () => {
    const service = bareService()
    const first = binding('binding-1')
    const duplicateAccount = binding('binding-2')
    const otherAccount = { ...binding('binding-3'), accountId: 'account-2' }
    const rows = new Map([[first.id, first], [duplicateAccount.id, duplicateAccount], [otherAccount.id, otherAccount]])
    const publishRequest = vi.fn(async () => undefined)
    service.store = {
      getTurnLinkByCommand: () => null,
      getTurnLinkByConversationTurn: () => null,
      getBinding: (id: string) => rows.get(id),
    }
    service.publishRequest = publishRequest
    service.scheduleRender = vi.fn()
    service.observed.set('conversation-1', {
      state: createConversationState('thread-1'), bindingIds: new Set(rows.keys()),
    })

    service.onConversationEvent('conversation-1', event('question.requested', {
      turnId: 'turn-browser', data: { requestId: 'question-1', method: 'request_user_input' },
    }))

    expect(publishRequest).toHaveBeenCalledTimes(2)
    expect(publishRequest.mock.calls.map(([value]: [CodyWorkChannelBinding]) => value.accountId).sort()).toEqual(['account-1', 'account-2'])
  })

  it('expires an unresolved approval when its native turn terminates', async () => {
    const service = bareService()
    const value = binding('binding-1')
    const request = {
      id: 'request-row', accountId: value.accountId, bindingId: value.id, requestKey: 'request-key', requestId: '0',
      turnId: 'turn-1', kind: 'approval', remoteMessageId: 'remote-card', requesterIdentity: value.ownerIdentity,
      status: 'pending', request: {},
    }
    service.store = {
      getTurnLinkByCommand: () => null,
      getTurnLinkByConversationTurn: () => null,
      getBinding: () => value,
      listPendingInteractiveRequestsForTurn: () => [request],
      updateInteractiveRequest: vi.fn(),
    }
    service.enqueue = vi.fn(async () => ({ id: 'outbox-1' }))
    service.scheduleRender = vi.fn()
    service.observed.set(value.conversationId, {
      state: createConversationState(value.threadId), bindingIds: new Set([value.id]),
    })

    service.onConversationEvent(value.conversationId, event('turn.interrupted', { turnId: 'turn-1' }))
    await Promise.resolve()

    expect(service.store.updateInteractiveRequest).toHaveBeenCalledWith(value.accountId, request.id, { status: 'expired' })
    expect(service.enqueue).toHaveBeenCalledWith(value.accountId, expect.objectContaining({
      kind: 'update_card', targetId: request.remoteMessageId,
      payload: { card: expect.objectContaining({ header: expect.any(Object) }) },
    }))
  })

  it('renders approval cards from an allowlisted summary without exposing the environment', async () => {
    const service = bareService()
    const value = binding('binding-1')
    let delivery: any
    service.store = {
      saveInteractiveRequest: () => ({ id: 'request-row', status: 'pending', remoteMessageId: '' }),
      updateInteractiveRequest: vi.fn(),
    }
    service.enqueue = vi.fn(async (_accountId: string, input: any) => {
      delivery = input
      return { remoteMessageId: 'remote-1' }
    })

    await service.publishRequest(value, event('approval.requested', {
      data: {
        requestId: 'approval-1', method: 'item/commandExecution/requestApproval',
        params: { command: "/usr/bin/zsh -lc 'sleep 8'", cwd: '/safe/worktree', environment: { PRIVATE_TOKEN: 'must-not-leak' } },
      },
    }))

    const rendered = JSON.stringify(delivery.payload.card)
    expect(rendered).toContain("sleep 8")
    expect(rendered).toContain('/safe/worktree')
    expect(rendered).not.toContain('PRIVATE_TOKEN')
    expect(rendered).not.toContain('must-not-leak')
  })

  it('renders a command failure even when Codex never assigned a turn id', async () => {
    const service = bareService()
    const value = binding('binding-1')
    const renderCommandFailure = vi.fn(async () => undefined)
    service.store = {
      getTurnLinkByCommand: () => ({ id: 'link-1', inboxId: 'inbox-1', bindingId: value.id, clientCommandId: 'command-1', turnId: '', status: 'submitting' }),
      updateTurnLink: vi.fn(), updateInbox: vi.fn(), getTurnLinkByConversationTurn: () => null, getBinding: () => value,
    }
    service.renderCommandFailure = renderCommandFailure
    service.observed.set(value.conversationId, {
      state: createConversationState(value.threadId), bindingIds: new Set([value.id]),
    })

    service.onConversationEvent(value.conversationId, event('command.failed', {
      itemId: 'command-1', turnId: '', data: { error: 'upstream rejected command' },
    }))
    await Promise.resolve()

    expect(renderCommandFailure).toHaveBeenCalledWith('link-1', 'upstream rejected command')
    expect(service.store.updateInbox).toHaveBeenCalledWith('inbox-1', 'failed', { lastError: 'upstream rejected command' })
  })

  it('removes the observation when its final binding is detached', () => {
    const service = bareService()
    const value = binding('binding-1')
    service.observed.set(value.conversationId, {
      state: createConversationState(value.threadId), bindingIds: new Set([value.id]),
    })

    service.detachBindingObservation(value)

    expect(service.observed.has(value.conversationId)).toBe(false)
  })

  it('reports when stop is unsupported instead of claiming that a turn was stopped', async () => {
    const service = bareService()
    const value = binding('binding-1')
    const current = inbox('stop-command', '/stop', value.id)
    const enqueue = vi.fn(async () => ({ id: 'outbox-1' }))
    service.store = { getInbox: () => current, updateInbox: vi.fn() }
    service.conversations = { interrupt: vi.fn(async () => ({ supported: false })) }
    service.enqueue = enqueue

    await service.handleCommand(value, current.id, '/stop')

    expect(enqueue).toHaveBeenCalledWith(value.accountId, expect.objectContaining({
      payload: { text: '当前没有正在执行、可停止的回复。' },
    }))
    expect(service.store.updateInbox).toHaveBeenCalledWith(current.id, 'completed', { bindingId: value.id })
  })

  it('retries attachments from the original Feishu message while replying to the retry command', async () => {
    const service = bareService()
    const value = binding('binding-1')
    const retryCommand = inbox('retry-command', '/retry', value.id)
    const failed = inbox('failed-inbox', 'inspect this image', value.id)
    failed.status = 'failed'
    failed.message.attachments = [{ type: 'image', key: 'image-key', name: 'screen.png' }]
    const captured: ChannelInboundMessage[] = []
    const retried = inbox('retried-inbox', 'inspect this image', value.id)
    service.store = {
      getInbox: () => retryCommand,
      latestFailedInbox: () => failed,
      claimInbound: (value: ChannelInboundMessage) => {
        captured.push(value)
        retried.message = value
        return { item: retried, created: true }
      },
      updateInbox: vi.fn(),
    }
    service.submitInbox = vi.fn(async () => undefined)

    await service.handleCommand(value, retryCommand.id, '/retry')

    expect(captured).toHaveLength(1)
    expect(captured[0].messageId).not.toBe(failed.message.messageId)
    expect(captured[0]).toMatchObject({
      sourceMessageId: failed.message.messageId,
      replyMessageId: retryCommand.message.messageId,
    })
    expect(service.submitInbox).toHaveBeenCalledWith(retried.id, value)
  })

  it('retains a command failure card until the initial reply receives a remote message id', async () => {
    const service = bareService()
    const presentation = {
      id: 'presentation-1', accountId: 'account-1', bindingId: 'binding-1', turnLinkId: 'link-1', purpose: 'turn',
      remoteMessageId: '', status: 'pending', revision: 0, terminal: false, state: { prompt: 'hello', outboxId: 'outbox-1' },
    }
    const updatePresentation = vi.fn(() => presentation)
    service.findTurnPresentation = () => presentation
    service.store = {
      getOutbox: () => ({ id: 'outbox-1', remoteMessageId: undefined }),
      updatePresentation,
    }
    service.enqueue = vi.fn()

    await service.renderCommandFailure('link-1', 'turn id was never assigned')

    expect(service.enqueue).not.toHaveBeenCalled()
    expect(updatePresentation).toHaveBeenCalledWith(presentation.id, expect.objectContaining({
      status: 'pending_failure',
      state: expect.objectContaining({ error: 'turn id was never assigned', pendingFailureCard: expect.any(Object) }),
    }))
  })
})
