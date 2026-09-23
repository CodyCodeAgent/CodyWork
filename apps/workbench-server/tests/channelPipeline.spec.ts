import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { ChannelSessionSettingsService } from '../src/services/channelSessionSettings.js'
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
  it('offers YOLO and Normal for Workspace bindings and creates an unrestricted YOLO session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-channel-workspace-binding-'))
    mkdirSync(join(root, 'docs'), { recursive: true })
    const db = new WorkbenchDb(':memory:')
    const now = nowIso()
    const workspaceId = makeId('ws')
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceId, 'Workspace binding', root, now, now)
    const store = new ChannelStore(db)
    const repositories = new ChannelRepositories(store)
    const account = store.saveAccount(null, { name: 'Workspace bot', appId: 'cli_workspace_binding', appSecret: 'test-secret' })
    const claimed = repositories.inbox.claim(inbound(account.id, 'WORKSPACE_BINDING_E2E', 'ou-private')).item
    repositories.inbox.update(claimed.id, 'waiting_binding')
    const conversations = new ConversationService(db, new TestRuntimeAdapter())
    const submitted: CodyWorkChannelBinding[] = []
    const enqueued: Array<Record<string, unknown>> = []
    const service = new ChannelBindingService(db, repositories, conversations, new WorkspaceRegistry(db), {
      enqueue: async (_accountId, input) => { enqueued.push(input as unknown as Record<string, unknown>); return { id: makeId('outbox'), remoteMessageId: 'remote-card' } as never },
      submitInbox: async (_inboxId, binding) => { submitted.push(binding) },
      observe: async () => undefined,
      openUrl: () => 'http://localhost/workspace-session',
    })
    const action = (value: Record<string, unknown>) => ({ value: { inboxId: claimed.id, workspaceId, ...value }, actorId: 'ou-owner', remoteMessageId: 'remote-card', eventId: makeId('action') }) as never

    const sessions = await service.handleAction(account.id, action({ action: 'channel.pick_workspace_scope' }))
    expect(JSON.stringify(sessions)).toContain('+ 新建 Workspace 会话')
    const permissions = await service.handleAction(account.id, action({ action: 'channel.pick_new_workspace_session' }))
    expect(JSON.stringify(permissions)).toContain('YOLO（默认）')
    expect(JSON.stringify(permissions)).toContain('Normal（每次审批）')
    await service.handleAction(account.id, action({
      action: 'channel.pick_permission', sessionAction: 'channel.pick_new_workspace_session', permissionMode: 'yolo', conversationId: '',
    }))

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toMatchObject({ targetType: 'codywork-workspace', demandId: null, permissionMode: 'yolo' })
    expect(conversations.get(workspaceId, submitted[0]!.conversationId)).toMatchObject({ scope: 'workspace', permissionMode: 'yolo', createdVia: 'feishu' })
    expect(enqueued.length).toBeGreaterThanOrEqual(3)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

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
      readonly settings: Array<{ model?: string; reasoningEffort?: string } | undefined> = []
      readonly localImages: string[][] = []
      readonly prompts: string[] = []
      override async getComposerOptions() {
        return {
          models: [{ id: 'gpt-pipeline', label: 'GPT Pipeline', description: 'fixture', isDefault: true, defaultReasoningEffort: 'high' as const, supportedReasoningEfforts: ['medium', 'high'] as const }],
          skills: [], collaborationModes: [],
        }
      }
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.permissions.push(request.executionProfile?.permissionMode ?? '')
        this.settings.push(request.settings)
        this.localImages.push(request.localImages?.map(image => image.path) ?? [])
        this.prompts.push(request.prompt)
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
    const settings = new ChannelSessionSettingsService(db, repositories, conversations, workspaces)
    const account = store.saveAccount(null, {
      name: 'Pipeline bot', appId: 'cli_pipeline', appSecret: 'test-secret', enabled: true,
      allowAllUsers: true, allowedConversationIds: ['oc-reply', 'oc-topic'], groupMentionMode: 'always',
    })
    const privateMessage = inbound(account.id, 'PRIVATE_PIPELINE', 'ou-private')
    privateMessage.replyTo = 'message-quoted'
    privateMessage.quotedMessage = {
      messageId: 'message-quoted', conversationId: 'ou-private',
      sender: { id: 'ou-quoted-author', type: 'user', name: 'Quoted Author' },
      text: 'QUOTED_CONTEXT_BODY',
      attachments: [
        { id: 'quoted-image', type: 'image', name: 'quoted.png' },
        { id: 'quoted-file', type: 'file', name: 'quoted.txt' },
      ],
      createdAtIso: '2026-09-06T00:00:00.000Z',
    }
    const replyMessage = inbound(account.id, 'GROUP_REPLY_PIPELINE', 'oc-reply', 'group')
    const topicMessage = inbound(account.id, 'GROUP_TOPIC_PIPELINE', 'oc-topic', 'group')
    const createBinding = (message: ChannelInboundMessage, conversation: typeof privateConversation): CodyWorkChannelBinding => repositories.bindings.create({
      message, targetType: 'codywork-demand', workspaceId, demandId, conversationId: conversation.id,
      threadId: conversation.nativeId, ownerIdentity: 'ou-owner', permissionMode: 'yolo', notificationPolicy: 'mirror-requests',
    })
    const privateBinding = createBinding(privateMessage, privateConversation)
    await expect(settings.select(privateBinding.id, 'ou-owner', 'gpt-pipeline', 'none')).rejects.toThrow('不支持所选推理程度')
    await settings.select(privateBinding.id, 'ou-owner', 'gpt-pipeline', 'medium')
    expect(repositories.bindings.get(privateBinding.id)).toMatchObject({ model: 'gpt-pipeline', reasoningEffort: 'medium' })
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
    const commands = new ChannelCommandAdapter(db, repositories, conversations, workspaces, projection, settings, {
      provider: () => ({
        downloadAttachment: async (messageId: string, attachment: { name: string }, destination: string) => {
          mkdirSync(destination, { recursive: true })
          const path = join(destination, attachment.name)
          writeFileSync(path, `${messageId}:${attachment.name}`)
          return { path, sizeBytes: 1 }
        },
      }) as never,
      enqueue, openUrl: () => 'http://localhost/conversation',
      persistImage: (_workspaceId, _conversationId, input) => ({ path: `${input.path}.owned` }),
    })
    let bindings!: ChannelBindingService
    const bindingHooks = {
      enqueue,
      submitInbox: (inboxId: string, binding: CodyWorkChannelBinding) => commands.submitInbox(inboxId, binding),
      observe: (binding: CodyWorkChannelBinding, options?: { emptyHistory?: boolean }) => projection.observe(binding, options),
      openUrl: () => 'http://localhost/conversation',
    }
    bindings = new ChannelBindingService(db, repositories, conversations, workspaces, bindingHooks)
    const router = new ChannelRouter(repositories, conversations, {} as never, requests as never, bindings, settings, {
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
      expect(runtime.settings).toEqual([
        { model: 'gpt-pipeline', reasoningEffort: 'medium' },
        { model: 'gpt-pipeline', reasoningEffort: 'high' },
        { model: 'gpt-pipeline', reasoningEffort: 'high' },
      ])
      expect(runtime.localImages[0]).toHaveLength(1)
      expect(runtime.localImages[0]?.[0]).toContain('message-quoted/quoted.png.owned')
      expect(runtime.prompts[0]).toContain('Quoted Author')
      expect(runtime.prompts[0]).toContain('QUOTED_CONTEXT_BODY')
      expect(runtime.prompts[0]).toContain('message-quoted/quoted.txt')
      expect(runtime.prompts[0]).toContain('[当前消息]\nPRIVATE_PIPELINE\n[/当前消息]')

      const initialCards = deliveries.filter(delivery => delivery.kind === 'reply_card')
      expect(initialCards).toHaveLength(3)
      expect(JSON.stringify(initialCards)).toContain('GPT Pipeline')
      expect(JSON.stringify(initialCards)).toContain('Channel pipeline')
      expect(JSON.stringify(initialCards)).toContain('Verify channel')
      const initialByPrompt = new Map(initialCards.map(delivery => [
        JSON.stringify(delivery.payload), delivery,
      ]))
      const privateInitial = [...initialByPrompt].find(([body]) => body.includes('QUOTED_CONTEXT_BODY'))?.[1]
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
