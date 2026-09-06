import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { ChannelInboundMessage } from '@codycodeagent/cody-web-core/channel'
import type { FeishuCard, FeishuCardAction, FeishuProvider } from '@codycodeagent/cody-web-core/feishu'
import { WorkbenchDb, makeId, nowIso } from '../src/db/index.js'
import { CodyWorkChannelService } from '../src/services/channelBot.js'
import { ChannelStore } from '../src/services/channelStore.js'
import { ConversationService } from '../src/services/conversations.js'
import { WorkspaceRegistry } from '../src/services/workspaceRegistry.js'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'

type ProviderStartHooks = Parameters<FeishuProvider['start']>[0]

class FakeFeishuProvider {
  state = 'offline'
  hooks: ProviderStartHooks | null = null
  readonly replies: Array<{ targetId: string; card: FeishuCard; replyInThread: boolean }> = []
  readonly userCards: Array<{ targetId: string; card: FeishuCard; remoteMessageId: string }> = []
  readonly updates: Array<{ targetId: string; card: FeishuCard }> = []

  async identity() { return { id: 'ou-test-bot', name: 'CodyWork E2E' } }
  async start(hooks: ProviderStartHooks) {
    this.hooks = hooks
    this.state = 'connected'
    hooks.onState('connected')
  }
  stop() { this.state = 'offline' }
  getState() { return this.state }
  classifyError(error: unknown) { return { retryable: false, message: error instanceof Error ? error.message : String(error) } }
  async replyCard(targetId: string, card: FeishuCard, replyInThread: boolean) {
    this.replies.push({ targetId, card, replyInThread })
    return `remote-${this.replies.length}`
  }
  async sendUserCard(targetId: string, card: FeishuCard) {
    const remoteMessageId = `user-card-${this.userCards.length + 1}`
    this.userCards.push({ targetId, card, remoteMessageId })
    return remoteMessageId
  }
  async updateCard(targetId: string, card: FeishuCard) { this.updates.push({ targetId, card }) }
  async emitMessage(message: ChannelInboundMessage) {
    if (!this.hooks) throw new Error('fake Feishu provider is not connected')
    await this.hooks.onMessage(message)
  }
  async emitAction(action: FeishuCardAction) {
    if (!this.hooks) throw new Error('fake Feishu provider is not connected')
    return this.hooks.onAction(action)
  }
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cody-channel-service-'))
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
    .run(workspaceId, 'Channel service', root, now, now)
  db.db.prepare('INSERT INTO repositories (id, workspace_id, name, baseline_path, origin_url, default_ref, inspected_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(repositoryId, workspaceId, 'demo', baseline, null, null, now)
  db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(demandId, workspaceId, 'Verify channel service', 'verify', 'verify', 'in_progress', now, now)
  db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(demandId, repositoryId, 'verify', join(worktree, 'services', 'demo'), 'HEAD', 'test', now)
  return { root, db, workspaceId, demandId }
}

function inbound(accountId: string, text: string, conversationId = 'ou-private', scope: 'private' | 'group' = 'private'): ChannelInboundMessage {
  return {
    provider: 'feishu', accountId, eventId: `event-${text}`, messageId: `message-${text}`,
    conversation: { id: conversationId, scope }, sender: { id: 'ou-owner', type: 'user' },
    text, attachments: [], addressedToAgent: true, mentionsOtherRecipient: false, createdAtIso: nowIso(),
  }
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for channel projection')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('CodyWork channel composition root', () => {
  it('runs ingress, native Turn, durable Outbox delivery and restart recovery through the real service graph', async () => {
    const test = createFixture()
    class ActionRuntime extends TestRuntimeAdapter {
      readonly approvals: Array<{ requestId: string; outcome: string }> = []
      async respondApproval(_conversation: Parameters<TestRuntimeAdapter['interrupt']>[0], requestId: string, outcome: 'allowed-once' | 'rejected') {
        this.approvals.push({ requestId, outcome })
      }
    }
    const runtime = new ActionRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const workspaces = new WorkspaceRegistry(test.db)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Shared private conversation', 'feishu')
    const replyConversation = await conversations.create(test.workspaceId, test.demandId, 'Shared group reply conversation', 'feishu')
    const providers: FakeFeishuProvider[] = []
    const providerFactory = () => {
      const provider = new FakeFeishuProvider()
      providers.push(provider)
      return provider as unknown as FeishuProvider
    }
    let service = new CodyWorkChannelService(test.db, conversations, workspaces, { providerFactory })
    try {
      const account = await service.saveAccount(null, {
        name: 'Composition bot', appId: 'cli_composition', appSecret: 'test-secret', enabled: true,
        allowAllUsers: true, allowedConversationIds: ['oc-reply', 'oc-topic'], privateConversationMode: 'chat',
      })
      const store = new ChannelStore(test.db)
      store.createBinding({
        message: inbound(account.id, 'binding-seed'), targetType: 'codywork-demand', workspaceId: test.workspaceId,
        demandId: test.demandId, conversationId: conversation.id, threadId: conversation.nativeId,
        ownerIdentity: 'ou-owner', permissionMode: 'yolo', notificationPolicy: 'mirror-requests',
      })
      store.createBinding({
        message: inbound(account.id, 'group-binding-seed', 'oc-reply', 'group'), targetType: 'codywork-demand', workspaceId: test.workspaceId,
        demandId: test.demandId, conversationId: replyConversation.id, threadId: replyConversation.nativeId,
        ownerIdentity: 'ou-owner', permissionMode: 'yolo', notificationPolicy: 'mirror-requests',
      })
      store.saveGroupProfile({
        accountId: account.id, channelConversationId: 'oc-reply', conversationMode: 'reply', targetType: 'codywork-demand',
        workspaceId: test.workspaceId, demandId: test.demandId, conversationId: replyConversation.id,
        permissionMode: 'yolo', ownerIdentity: 'ou-owner',
      })
      store.saveGroupProfile({
        accountId: account.id, channelConversationId: 'oc-topic', conversationMode: 'topic', targetType: 'codywork-demand',
        workspaceId: test.workspaceId, demandId: test.demandId, conversationId: null,
        permissionMode: 'yolo', ownerIdentity: 'ou-owner',
      })

      const firstProvider = providers.at(-1)!
      await firstProvider.emitMessage(inbound(account.id, 'COMPOSITION_FIRST'))
      await firstProvider.emitMessage(inbound(account.id, 'COMPOSITION_GROUP_REPLY', 'oc-reply', 'group'))
      const topicMessage = inbound(account.id, 'COMPOSITION_GROUP_TOPIC', 'oc-topic', 'group')
      await firstProvider.emitMessage(topicMessage)
      await waitFor(() => firstProvider.updates.filter(update => JSON.stringify(update.card).includes('CodyWork · 已完成')).length === 3)
      expect(firstProvider.replies).toHaveLength(3)
      expect(firstProvider.replies).toEqual(expect.arrayContaining([
        expect.objectContaining({ targetId: 'message-COMPOSITION_FIRST', replyInThread: false }),
        expect.objectContaining({ targetId: 'message-COMPOSITION_GROUP_REPLY', replyInThread: false }),
        expect.objectContaining({ targetId: 'message-COMPOSITION_GROUP_TOPIC', replyInThread: true }),
      ]))
      expect(firstProvider.updates).toHaveLength(3)
      for (const prompt of ['COMPOSITION_FIRST', 'COMPOSITION_GROUP_REPLY', 'COMPOSITION_GROUP_TOPIC']) {
        expect(firstProvider.updates.filter(update => JSON.stringify(update.card).includes(`Test runtime received: ${prompt}`))).toHaveLength(1)
      }
      expect(test.db.db.prepare("SELECT status FROM channel_inbox WHERE external_message_id = 'message-COMPOSITION_FIRST'").get())
        .toMatchObject({ status: 'completed' })
      expect(test.db.db.prepare("SELECT COUNT(*) AS value FROM channel_outbox WHERE status = 'sent'").get())
        .toMatchObject({ value: 6 })
      expect(store.listBindings(account.id).map(binding => binding.channelScope).sort()).toEqual(['group', 'private', 'topic'])

      await firstProvider.emitMessage(topicMessage)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(firstProvider.replies).toHaveLength(3)
      expect(firstProvider.updates).toHaveLength(3)

      const approvalRequestedAt = nowIso()
      conversations.events.publish({
        id: 'approval-event', type: 'approval.requested', conversationId: conversation.id,
        threadId: conversation.nativeId, turnId: 'approval-turn', itemId: 'approval-item', timestamp: approvalRequestedAt, atIso: approvalRequestedAt,
        data: { requestId: 'approval-e2e', method: 'item/commandExecution/requestApproval', params: { command: 'echo approved', cwd: test.root } },
      })
      await waitFor(() => firstProvider.userCards.length === 1)
      const request = test.db.db.prepare("SELECT id, request_id FROM channel_interactive_requests WHERE request_id = 'approval-e2e'").get() as { id: string; request_id: string }
      await firstProvider.emitAction({
        eventId: 'approval-action', actorId: 'ou-owner', remoteMessageId: firstProvider.userCards[0]!.remoteMessageId,
        value: { action: 'channel.approval', interactiveRequestId: request.id, requestId: request.request_id, outcome: 'allowed-once' },
      })
      expect(runtime.approvals).toEqual([{ requestId: 'approval-e2e', outcome: 'allowed-once' }])
      expect(test.db.db.prepare('SELECT status FROM channel_interactive_requests WHERE id = ?').get(request.id)).toEqual({ status: 'allowed-once' })
      expect(firstProvider.updates.some(update => JSON.stringify(update.card).includes('审批已处理'))).toBe(true)

      await service.close()
      service = new CodyWorkChannelService(test.db, conversations, workspaces, { providerFactory })
      await service.start()
      const recoveredProvider = providers.at(-1)!
      await recoveredProvider.emitMessage(inbound(account.id, 'COMPOSITION_AFTER_RESTART'))
      await waitFor(() => recoveredProvider.updates.some(update => JSON.stringify(update.card).includes('CodyWork · 已完成')))
      expect(recoveredProvider.replies).toHaveLength(1)
      expect(recoveredProvider.updates).toHaveLength(1)
      expect(JSON.stringify(recoveredProvider.updates[0]?.card)).toContain('Test runtime received: COMPOSITION_AFTER_RESTART')
      expect(service.diagnostics(account.id)).toMatchObject({
        account: { connectionState: 'connected' }, bindings: 3, inbox: { failed: 0 }, outbox: { pending: 0, deadLetter: 0 },
      })
    } finally {
      await service.close().catch(() => undefined)
      test.db.close()
      rmSync(test.root, { recursive: true, force: true })
    }
  })
})
