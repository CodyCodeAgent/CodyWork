import { describe, expect, it, vi } from 'vitest'
import { createConversationState } from '@codycodeagent/cody-web-core/conversation'
import type { ChannelInboundMessage, ChannelInboxItem } from '@codycodeagent/cody-web-core/channel'
import type { ConversationEvent } from '../src/services/conversations.js'
import { CodyWorkChannelService } from '../src/services/channelBot.js'
import type { ChannelAccountSecret, CodyWorkChannelBinding } from '../src/services/channelStore.js'

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
    observed: new Map(), observationInitializations: new Map(), renderTimers: new Map(), reconnectTimers: new Map(), runtimes: new Map(),
  })
  return service
}

describe('CodyWork channel lifecycle', () => {
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

  it('restores the previous account and runtime when a reconnecting update fails', async () => {
    const service = bareService()
    const previous: ChannelAccountSecret = {
      id: 'account-1', provider: 'feishu', name: 'Stable Bot', appId: 'cli_stable', appSecret: 'stable-secret',
      appSecretConfigured: true, domain: 'feishu', enabled: true, allowAllUsers: false,
      allowedUserIds: ['user-1'], allowedConversationIds: ['chat-1'], groupMentionMode: 'always',
      privateConversationMode: 'chat', botOpenId: 'bot-1', botName: 'Stable Bot', connectionState: 'connected',
      lastError: '', connectedAt: '2026-09-05T00:00:00.000Z', lastEventAt: null, lastDeliveryAt: null,
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
    let listener: ((value: ConversationEvent) => void) | undefined
    service.conversations = {
      subscribeChannel: (_conversationId: string, callback: (value: ConversationEvent) => void) => {
        calls.push('subscribe'); listener = callback; return vi.fn()
      },
      history: async () => {
        calls.push('history')
        listener?.(event('turn.started', { turnId: 'turn-new', ownerRevision: 6 }))
        listener?.(event('turn.started', { id: 'snapshot-event', turnId: 'turn-old', ownerRevision: 5 }))
        return { events: [event('turn.started', { id: 'snapshot-event', turnId: 'turn-old', ownerRevision: 5 })], watermark: 5 }
      },
    }
    service.onConversationEventSafely = (_conversationId: string, value: ConversationEvent) => applied.push(value)

    await service.observe(binding('binding-1'))

    expect(calls).toEqual(['subscribe', 'history'])
    expect(applied.map(value => value.turnId)).toEqual(['turn-new'])
  })

  it('observes a newly created empty thread without reading unsupported turn history', async () => {
    const service = bareService()
    const applied: ConversationEvent[] = []
    const history = vi.fn(async () => { throw new Error('list_turns is not supported yet') })
    service.conversations = {
      subscribeChannel: (_conversationId: string, callback: (value: ConversationEvent) => void) => {
        callback(event('thread.attached', { ownerRevision: 1 }))
        return vi.fn()
      },
      history,
    }
    service.onConversationEventSafely = (_conversationId: string, value: ConversationEvent) => applied.push(value)

    await service.observe(binding('binding-new'), { emptyHistory: true })

    expect(history).not.toHaveBeenCalled()
    expect(service.observed.get('conversation-1')?.state).toEqual(createConversationState('thread-1'))
    expect(applied.map(value => value.type)).toEqual(['thread.attached'])
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

    await service.recover('account-1')

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
      state: createConversationState('thread-1'), bindingIds: new Set([source.id, other.id]), unsubscribe: vi.fn(),
    })

    service.onConversationEvent('conversation-1', event('approval.requested', {
      turnId: 'turn-1', data: { requestId: 'approval-1', method: 'exec' },
    }))

    expect(publishRequest).toHaveBeenCalledTimes(1)
    expect(publishRequest).toHaveBeenCalledWith(source, expect.objectContaining({ turnId: 'turn-1' }))
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
      state: createConversationState(value.threadId), bindingIds: new Set([value.id]), unsubscribe: vi.fn(),
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
    const unsubscribe = vi.fn()
    const value = binding('binding-1')
    service.observed.set(value.conversationId, {
      state: createConversationState(value.threadId), bindingIds: new Set([value.id]), unsubscribe,
    })

    service.detachBindingObservation(value)

    expect(unsubscribe).toHaveBeenCalledOnce()
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
