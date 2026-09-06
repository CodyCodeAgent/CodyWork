import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { ChannelInboundMessage } from '@codycodeagent/cody-web-core/channel'
import { WorkbenchDb, makeId, nowIso } from '../src/db/index.js'
import { ChannelBindingService } from '../src/services/channelBindingService.js'
import { ChannelCommandAdapter } from '../src/services/channelCommandAdapter.js'
import { ChannelProjectionService } from '../src/services/channelProjection.js'
import { ChannelRepositories } from '../src/services/channelRepositories.js'
import { ChannelRouter } from '../src/services/channelRouter.js'
import { ChannelStore, type CodyWorkChannelBinding } from '../src/services/channelStore.js'
import { ConversationService } from '../src/services/conversations.js'
import { WorkspaceRegistry } from '../src/services/workspaceRegistry.js'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'

type Delivery = {
  accountId: string
  kind: string
  targetId: string
  payload: Record<string, unknown>
  dedupeKey: string
  terminal?: boolean
  remoteMessageId: string
}

function inbound(accountId: string, text: string, conversationId: string, scope: 'private' | 'group' = 'private'): ChannelInboundMessage {
  return {
    provider: 'feishu',
    accountId,
    eventId: `event-${text}`,
    messageId: `message-${text}`,
    conversation: { id: conversationId, scope },
    sender: { id: 'ou-owner', type: 'user' },
    text,
    attachments: [],
    addressedToAgent: true,
    mentionsOtherRecipient: false,
    createdAtIso: '2026-09-06T00:00:00.000Z',
  }
}

describe('CodyWork channel end-to-end pipeline', () => {
  it('converges private, flat-group reply and group-topic messages through one durable pipeline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-channel-pipeline-'))
    const baseline = join(root, 'services', 'demo')
    const worktree = join(root, 'worktrees', 'verify')
    mkdirSync(baseline, { recursive: true })
    mkdirSync(join(root, 'docs'), { recursive: true })
    mkdirSync(join(root, 'specs'), { recursive: true })
    mkdirSync(join(worktree, 'services', 'demo'), { recursive: true })
    const db = new WorkbenchDb(':memory:')
    const now = nowIso()
    const workspaceId = makeId('ws')
    const demandId = makeId('demand')
    const repositoryId = makeId('repo')
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceId, 'Channel pipeline', root, now, now)
    db.db.prepare('INSERT INTO repositories (id, workspace_id, name, baseline_path, origin_url, default_ref, inspected_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(repositoryId, workspaceId, 'demo', baseline, null, null, now)
    db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(demandId, workspaceId, 'Verify channel', 'verify', 'verify', 'in_progress', now, now)
    db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(demandId, repositoryId, 'verify', join(worktree, 'services', 'demo'), 'HEAD', 'test', now)

    class CapturingRuntime extends TestRuntimeAdapter {
      readonly permissions: string[] = []
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.permissions.push(request.executionProfile?.permissionMode ?? '')
        return super.submitTurn(request)
      }
    }

    const runtime = new CapturingRuntime()
    const conversations = new ConversationService(db, runtime)
    const workspaces = new WorkspaceRegistry(db)
    const privateConversation = await conversations.create(workspaceId, demandId, 'Private conversation', 'feishu')
    const replyConversation = await conversations.create(workspaceId, demandId, 'Group reply conversation', 'feishu')
    const store = new ChannelStore(db)
    const repositories = new ChannelRepositories(store)
    const account = store.saveAccount(null, {
      name: 'Pipeline bot', appId: 'cli_pipeline', appSecret: 'test-secret', enabled: true,
      allowAllUsers: true, allowedConversationIds: ['oc-reply', 'oc-topic'], groupMentionMode: 'always',
    })
    const privateMessage = inbound(account.id, 'PRIVATE_PIPELINE', 'ou-private')
    const replyMessage = inbound(account.id, 'GROUP_REPLY_PIPELINE', 'oc-reply', 'group')
    const topicMessage = inbound(account.id, 'GROUP_TOPIC_PIPELINE', 'oc-topic', 'group')
    const createBinding = (message: ChannelInboundMessage, conversation: typeof privateConversation): CodyWorkChannelBinding => repositories.bindings.create({
      message, targetType: 'codywork-demand', workspaceId, demandId, conversationId: conversation.id,
      threadId: conversation.nativeId, ownerIdentity: 'ou-owner', permissionMode: 'yolo', notificationPolicy: 'mirror-requests',
    })
    createBinding(privateMessage, privateConversation)
    createBinding(replyMessage, replyConversation)
    repositories.bindings.saveGroupProfile({
      accountId: account.id, channelConversationId: 'oc-reply', conversationMode: 'reply',
      targetType: 'codywork-demand', workspaceId, demandId, conversationId: replyConversation.id,
      permissionMode: 'yolo', ownerIdentity: 'ou-owner',
    })
    repositories.bindings.saveGroupProfile({
      accountId: account.id, channelConversationId: 'oc-topic', conversationMode: 'topic',
      targetType: 'codywork-demand', workspaceId, demandId, conversationId: null,
      permissionMode: 'yolo', ownerIdentity: 'ou-owner',
    })

    const deliveries: Delivery[] = []
    const enqueue = async (accountId: string, input: {
      kind: string; targetId: string; payload: Record<string, unknown>; dedupeKey: string; revision?: number; terminal?: boolean
    }) => {
      const row = await repositories.outbox.enqueue({
        id: makeId('outbox'), provider: 'feishu', accountId, ...input,
      })
      const remoteMessageId = `remote-${deliveries.length + 1}`
      await repositories.outbox.markSent(row.id, remoteMessageId)
      deliveries.push({ accountId, ...input, remoteMessageId })
      return repositories.outbox.get(row.id)
    }
    const requests = {
      publish: vi.fn(async () => undefined), resolve: vi.fn(async () => undefined), expireTurn: vi.fn(),
      handleApprovalAction: vi.fn(), handleQuestionAction: vi.fn(),
    }
    const projection = new ChannelProjectionService(db, repositories, conversations, workspaces, requests as never, {
      enqueue, queue: enqueue, fail: vi.fn(), isAccountActive: () => true, openUrl: () => 'http://localhost/conversation',
    } as never)
    const commands = new ChannelCommandAdapter(db, repositories, conversations, workspaces, projection, {
      provider: () => ({}) as never, enqueue, openUrl: () => 'http://localhost/conversation',
    })
    let bindings!: ChannelBindingService
    const bindingHooks = {
      enqueue,
      submitInbox: (inboxId: string, binding: CodyWorkChannelBinding) => commands.submitInbox(inboxId, binding),
      observe: (binding: CodyWorkChannelBinding, options?: { emptyHistory?: boolean }) => projection.observe(binding, options),
      openUrl: () => 'http://localhost/conversation',
    }
    bindings = new ChannelBindingService(db, repositories, conversations, workspaces, bindingHooks)
    const router = new ChannelRouter(repositories, conversations, {} as never, requests as never, bindings, {
      ...bindingHooks,
      detachBindingObservation: (binding: CodyWorkChannelBinding) => projection.detach(binding),
      accountState: () => 'connected', retryOutbox: vi.fn(), fail: vi.fn(),
    })

    try {
      await router.onMessage(privateMessage)
      await router.onMessage(replyMessage)
      await router.onMessage(topicMessage)
      await new Promise(resolve => setTimeout(resolve, 900))

      const inboxRows = db.db.prepare("SELECT status, turn_id, message_json FROM channel_inbox WHERE status NOT LIKE 'action_%' ORDER BY created_at")
        .all() as Array<{ status: string; turn_id: string | null; message_json: string }>
      expect(inboxRows).toHaveLength(3)
      expect(inboxRows.map(row => row.status)).toEqual(['completed', 'completed', 'completed'])
      expect(inboxRows.every(row => Boolean(row.turn_id))).toBe(true)
      expect(runtime.permissions).toEqual(['yolo', 'yolo', 'yolo'])

      const initialCards = deliveries.filter(delivery => delivery.kind === 'reply_card')
      expect(initialCards).toHaveLength(3)
      const initialByPrompt = new Map(initialCards.map(delivery => [
        JSON.stringify(delivery.payload), delivery,
      ]))
      const privateInitial = [...initialByPrompt].find(([body]) => body.includes('PRIVATE_PIPELINE'))?.[1]
      const replyInitial = [...initialByPrompt].find(([body]) => body.includes('GROUP_REPLY_PIPELINE'))?.[1]
      const topicInitial = [...initialByPrompt].find(([body]) => body.includes('GROUP_TOPIC_PIPELINE'))?.[1]
      expect(privateInitial?.payload.replyInThread).toBe(false)
      expect(replyInitial?.payload.replyInThread).toBe(false)
      expect(topicInitial?.payload.replyInThread).toBe(true)

      const terminalUpdates = deliveries.filter(delivery => delivery.kind === 'update_card' && delivery.terminal)
      expect(terminalUpdates).toHaveLength(3)
      for (const prompt of ['PRIVATE_PIPELINE', 'GROUP_REPLY_PIPELINE', 'GROUP_TOPIC_PIPELINE']) {
        const matches = terminalUpdates.filter(delivery => JSON.stringify(delivery.payload).includes(prompt))
        expect(matches, prompt).toHaveLength(1)
        expect(JSON.stringify(matches[0]?.payload)).toContain('CodyWork · 已完成')
      }

      const topicBinding = repositories.bindings.list(account.id).find(binding => binding.channelConversationId === 'oc-topic')
      expect(topicBinding).toMatchObject({ channelScope: 'topic', channelRootId: topicMessage.messageId, permissionMode: 'yolo' })
      const sentOutbox = db.db.prepare("SELECT COUNT(*) AS value FROM channel_outbox WHERE status = 'sent'").get() as { value: number }
      expect(sentOutbox.value).toBe(deliveries.length)
      const channelOrigins = db.db.prepare("SELECT data_json FROM conversation_audits WHERE action = 'turn.bound'").all() as Array<{ data_json: string }>
      expect(channelOrigins).toHaveLength(3)
      expect(channelOrigins.every(row => JSON.parse(row.data_json).origin?.kind === 'channel')).toBe(true)
    } finally {
      projection.close()
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
