import { describe, expect, it, vi } from 'vitest'
import type { ChannelInboundMessage, ChannelInboxItem } from '@codycodeagent/cody-web-core/channel'
import { ChannelBindingService } from '../src/services/channelBindingService.js'
import { ChannelCommandAdapter } from '../src/services/channelCommandAdapter.js'
import { ChannelDeliveryWorker } from '../src/services/channelDeliveryWorker.js'
import { ChannelProjectionService } from '../src/services/channelProjection.js'
import { ChannelRepositories } from '../src/services/channelRepositories.js'
import { ChannelRequestBridge } from '../src/services/channelRequestBridge.js'
import { ConversationEventHub } from '../src/services/conversationEventHub.js'
import type { ConversationEvent } from '../src/services/conversations.js'
import type { CodyWorkChannelBinding } from '../src/services/channelStore.js'

function message(text = 'hello', scope: 'private' | 'group' | 'topic' = 'private'): ChannelInboundMessage {
  return {
    provider: 'feishu', accountId: 'account-1', eventId: `event-${text}`, messageId: `message-${text}`,
    conversation: { id: 'chat-1', scope, ...(scope === 'topic' ? { rootId: 'root-1' } : {}) },
    sender: { id: 'owner-1', type: 'user' }, text, attachments: [], addressedToAgent: true,
    mentionsOtherRecipient: false, createdAtIso: '2026-09-06T00:00:00.000Z',
  }
}

function inbox(id: string, text = 'hello', status: ChannelInboxItem['status'] = 'received'): ChannelInboxItem {
  const inbound = message(text)
  return {
    id, message: inbound, conversationKey: 'feishu:account-1:private:chat-1:', status,
    createdAtIso: inbound.createdAtIso, updatedAtIso: inbound.createdAtIso,
  }
}

function binding(id: string, patch: Partial<CodyWorkChannelBinding> = {}): CodyWorkChannelBinding {
  return {
    id, provider: 'feishu', accountId: 'account-1', conversationKey: `feishu:account-1:private:${id}:`,
    targetType: 'codywork-demand', targetId: 'demand-1', threadId: 'thread-1', ownerIdentity: 'owner-1',
    createdAtIso: '2026-09-06T00:00:00.000Z', updatedAtIso: '2026-09-06T00:00:00.000Z',
    workspaceId: 'workspace-1', demandId: 'demand-1', conversationId: 'conversation-1',
    channelConversationId: `chat-${id}`, channelScope: 'private', channelRootId: '',
    permissionMode: 'workspace-write', model: '', reasoningEffort: '', notificationPolicy: 'mirror-requests', ...patch,
  }
}

function event(type: ConversationEvent['type'], patch: Partial<ConversationEvent> = {}): ConversationEvent {
  return {
    id: `${type}-1`, type, threadId: 'thread-1', turnId: 'turn-1', atIso: '2026-09-06T00:00:00.000Z',
    conversationId: 'conversation-1', timestamp: '2026-09-06T00:00:00.000Z', data: {}, ...patch,
  }
}

describe('CodyWork channel components', () => {
  it('serializes overlapping Outbox flushes and converges once', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const outbox = { flush: vi.fn(() => blocked), enqueue: vi.fn() }
    const afterFlush = vi.fn(async () => undefined)
    const worker = new ChannelDeliveryWorker(outbox as never, { afterFlush, onBackgroundError: vi.fn() })

    const first = worker.flush()
    const second = worker.flush()

    expect(first).toBe(second)
    expect(outbox.flush).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(afterFlush).toHaveBeenCalledTimes(1)
    await worker.close()
  })

  it('does not replay control commands or uncertain submissions after restart', async () => {
    const rows = [
      inbox('control', '/retry', 'received'),
      { ...inbox('uncertain', 'may already be running', 'submitting'), bindingId: 'binding-1' },
      { ...inbox('good', 'continue', 'ready'), bindingId: 'binding-1' },
    ]
    const updates: Array<{ id: string; status: string; error?: string }> = []
    const store = {
      pendingInbox: () => rows,
      getBinding: () => binding('binding-1'), findBinding: () => binding('binding-1'),
      updateInbox: (id: string, status: string, patch: { lastError?: string } = {}) => {
        updates.push({ id, status, ...(patch.lastError ? { error: patch.lastError } : {}) })
        return rows.find(row => row.id === id)
      },
      audit: vi.fn(),
    }
    const projection = { observe: vi.fn(async () => undefined), scheduleRender: vi.fn() }
    const adapter = new ChannelCommandAdapter({} as never, new ChannelRepositories(store as never), {} as never, {} as never, projection as never, {} as never, {} as never)
    const submit = vi.spyOn(adapter, 'submitInbox').mockResolvedValue(undefined)

    await adapter.recoverInbox('account-1')

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('good', expect.objectContaining({ id: 'binding-1' }))
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'control', status: 'failed', error: expect.stringContaining('控制命令') }),
      expect.objectContaining({ id: 'uncertain', status: 'failed', error: expect.stringContaining('不确定') }),
    ]))
  })

  it('routes an interactive request only to the binding that originated its Turn', async () => {
    const source = binding('source')
    const other = binding('other')
    const store = {
      getTurnLinkByConversationTurn: () => ({ id: 'link-1', bindingId: source.id }),
      getBinding: (id: string) => id === source.id ? source : other,
    }
    const requests = { publish: vi.fn(async () => undefined), expireTurn: vi.fn(), resolve: vi.fn() }
    const projection = new ChannelProjectionService({} as never, new ChannelRepositories(store as never), { events: new ConversationEventHub() } as never, {} as never, requests as never, { fail: vi.fn() } as never) as any
    projection.bindings.set('conversation-1', new Set([source.id, other.id]))
    projection.scheduleRender = vi.fn()

    projection.onConversationEvent('conversation-1', event('approval.requested', { data: { requestId: 'approval-1', method: 'exec' } }), {})
    await Promise.resolve()

    expect(requests.publish).toHaveBeenCalledTimes(1)
    expect(requests.publish).toHaveBeenCalledWith(source, expect.objectContaining({ turnId: 'turn-1' }))
    projection.close()
  })

  it('mirrors a browser request once per account and respects origin-only bindings', async () => {
    const first = binding('first')
    const duplicateAccount = binding('duplicate')
    const originOnly = binding('silent', { accountId: 'account-2', notificationPolicy: 'origin-only' })
    const otherAccount = binding('other-account', { accountId: 'account-3' })
    const rows = new Map([first, duplicateAccount, originOnly, otherAccount].map(row => [row.id, row]))
    const store = { getTurnLinkByConversationTurn: () => null, getBinding: (id: string) => rows.get(id) }
    const requests = { publish: vi.fn(async () => undefined), expireTurn: vi.fn(), resolve: vi.fn() }
    const projection = new ChannelProjectionService({} as never, new ChannelRepositories(store as never), { events: new ConversationEventHub() } as never, {} as never, requests as never, { fail: vi.fn() } as never) as any
    projection.bindings.set('conversation-1', new Set(rows.keys()))
    projection.scheduleRender = vi.fn()

    projection.onConversationEvent('conversation-1', event('question.requested', { data: { requestId: 'question-1' } }), {})
    await Promise.resolve()

    expect(requests.publish.mock.calls.map(([row]: [CodyWorkChannelBinding]) => row.accountId).sort()).toEqual(['account-1', 'account-3'])
    projection.close()
  })

  it('retains a command failure projection until the first reply has a remote id', async () => {
    const presentation = {
      id: 'presentation-1', accountId: 'account-1', bindingId: 'binding-1', turnLinkId: 'link-1', purpose: 'turn',
      remoteMessageId: '', status: 'pending', revision: 0, terminal: false,
      state: { prompt: 'hello', outboxId: 'outbox-1' },
    }
    const updatePresentation = vi.fn(() => presentation)
    const store = { getOutbox: () => ({ id: 'outbox-1', remoteMessageId: undefined }), updatePresentation }
    const hooks = { enqueue: vi.fn(), openUrl: vi.fn(() => ''), fail: vi.fn() }
    const projection = new ChannelProjectionService({ db: { prepare: vi.fn() } } as never, new ChannelRepositories(store as never), { events: new ConversationEventHub() } as never, {} as never, {} as never, hooks as never) as any
    projection.findTurnPresentation = () => presentation

    await projection.renderCommandFailure('link-1', 'turn id was never assigned')

    expect(hooks.enqueue).not.toHaveBeenCalled()
    expect(updatePresentation).toHaveBeenCalledWith(presentation.id, expect.objectContaining({
      status: 'pending_failure', state: expect.objectContaining({ error: 'turn id was never assigned', pendingFailureCard: expect.any(Object) }),
    }))
    projection.close()
  })

  it('offers flat groups an explicit reply-vs-topic choice before Workspace binding', async () => {
    const groupInbox = inbox('group', 'configure')
    groupInbox.message.conversation = { id: 'group-1', scope: 'group' }
    const enqueue = vi.fn(async () => ({ id: 'outbox-1' }))
    const store = { updateInbox: () => ({ ...groupInbox, status: 'waiting_binding' }) }
    const bindings = new ChannelBindingService({} as never, new ChannelRepositories(store as never), {} as never, {} as never, { enqueue } as never)

    await bindings.requestWorkspace(groupInbox.id)

    const delivery = enqueue.mock.calls[0]?.[1]
    expect(delivery).toMatchObject({ kind: 'reply_card', targetId: groupInbox.message.messageId, payload: { replyInThread: false } })
    expect(JSON.stringify(delivery?.payload)).toContain('channel.pick_group_mode')
    expect(JSON.stringify(delivery?.payload)).toContain('回复原消息')
    expect(JSON.stringify(delivery?.payload)).toContain('话题任务')
  })

  it('sanitizes approval cards and never exposes environment variables', async () => {
    const value = binding('binding-1')
    const sent: unknown[] = []
    const request = {
      id: 'request-row', accountId: value.accountId, bindingId: value.id, requestKey: 'request-key', requestId: 'approval-1',
      turnId: 'turn-1', kind: 'approval', remoteMessageId: '', requesterIdentity: value.ownerIdentity,
      status: 'pending', request: {},
    }
    const store = { saveInteractiveRequest: () => request, updateInteractiveRequest: vi.fn() }
    const bridge = new ChannelRequestBridge(new ChannelRepositories(store as never), {} as never, async (_accountId, delivery) => {
      sent.push(delivery)
      return { id: 'outbox-1', remoteMessageId: 'remote-1' } as never
    }, () => '', vi.fn())

    await bridge.publish(value, event('approval.requested', {
      data: {
        requestId: 'approval-1', method: 'item/commandExecution/requestApproval',
        params: { command: "/usr/bin/zsh -lc 'sleep 8'", cwd: '/safe/worktree', environment: { PRIVATE_TOKEN: 'must-not-leak' } },
      },
    }))

    const rendered = JSON.stringify(sent[0])
    expect(rendered).toContain('sleep 8')
    expect(rendered).toContain('/safe/worktree')
    expect(rendered).not.toContain('PRIVATE_TOKEN')
    expect(rendered).not.toContain('must-not-leak')
  })
})
