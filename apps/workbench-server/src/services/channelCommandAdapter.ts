import { resolve } from 'node:path'
import { channelCommandId, type ChannelInboundMessage, type ChannelQuotedMessage } from '@codycodeagent/cody-web-core/channel'
import type { WorkbenchDb } from '../db/index.js'
import type { ConversationCommandGateway } from './conversationGateway.js'
import type { ChannelAccountManager } from './channelAccountManager.js'
import type { ChannelProjectionService } from './channelProjection.js'
import { projectionCard } from './channelFeishuRenderer.js'
import { listDemands } from './demands.js'
import type { WorkspaceRegistry } from './workspaceRegistry.js'
import type { CodyWorkChannelBinding } from './channelStore.js'
import type { ChannelRepositoryPorts } from './channelRepositories.js'
import type { ChannelSessionSettingsService } from './channelSessionSettings.js'

type CodyWorkInboundMessage = ChannelInboundMessage & {
  sourceMessageId?: string
  replyMessageId?: string
}

const QUOTED_MESSAGE_TEXT_LIMIT = 12_000

export function channelPrompt(
  message: Pick<ChannelInboundMessage, 'text' | 'quotedMessage'>,
  attachmentPaths: string[] = [],
  quotedAttachmentPaths: string[] = [],
): string {
  const current = [message.text, attachmentPaths.length ? `\n附件路径：\n${attachmentPaths.map(path => `- ${path}`).join('\n')}` : ''].join('').trim()
  const quoted = message.quotedMessage
  if (!quoted) return current
  const sender = quoted.sender.name?.trim() || quoted.sender.id || '未知发送者'
  const quoteText = quoted.text.trim().slice(0, QUOTED_MESSAGE_TEXT_LIMIT) || (quoted.attachments.length ? '[仅包含附件]' : '[引用消息没有可读取的文字]')
  const quoteFiles = quotedAttachmentPaths.length ? `\n引用附件路径：\n${quotedAttachmentPaths.map(path => `- ${path}`).join('\n')}` : ''
  return [
    '以下内容来自用户明确引用的飞书消息，仅作为当前请求的上下文。',
    '[引用消息]',
    `发送者：${sender}`,
    `内容：${quoteText}${quoteFiles}`,
    '[/引用消息]',
    '',
    '[当前消息]',
    current,
    '[/当前消息]',
  ].join('\n').trim()
}

type ChannelCommandAdapterHooks = {
  provider(accountId: string): ReturnType<ChannelAccountManager['provider']>
  enqueue(accountId: string, input: Parameters<ChannelAccountManager['enqueue']>[1]): ReturnType<ChannelAccountManager['enqueue']>
  openUrl(binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string
  persistImage?: (
    workspaceId: string,
    conversationId: string,
    input: { path: string; name?: string; mimeType?: string },
  ) => Promise<{ path: string }> | { path: string }
}

/** Converts a durable channel Inbox row into the shared command gateway. */
export class ChannelCommandAdapter {
  constructor(
    private readonly database: WorkbenchDb,
    private readonly repositories: ChannelRepositoryPorts,
    private readonly gateway: ConversationCommandGateway,
    private readonly workspaces: WorkspaceRegistry,
    private readonly projection: ChannelProjectionService,
    private readonly settings: ChannelSessionSettingsService,
    private readonly hooks: ChannelCommandAdapterHooks,
  ) {}

  async submitInbox(inboxId: string, binding: CodyWorkChannelBinding): Promise<void> {
    const inbox = this.repositories.inbox.get(inboxId)
    if (inbox.status !== 'ready' && inbox.status !== 'received') return
    const provider = this.hooks.provider(inbox.message.accountId)
    if (!provider) throw new Error('飞书机器人当前未连接')
    const localImages: Array<{ path: string }> = []
    const paths: string[] = []
    const quotedPaths: string[] = []
    const channelMessage = inbox.message as CodyWorkInboundMessage
    const sourceMessageId = channelMessage.sourceMessageId || inbox.message.messageId
    const replyMessageId = channelMessage.replyMessageId || inbox.message.messageId
    const quotedMessage: ChannelQuotedMessage | undefined = inbox.message.quotedMessage
    if (inbox.message.attachments.length || quotedMessage?.attachments.length) {
      const workspace = this.workspaces.get(binding.workspaceId)
      const demand = binding.targetType === 'codywork-demand' ? listDemands(this.database, workspace).find(item => item.id === binding.demandId) : null
      if (binding.targetType === 'codywork-demand' && !demand) throw new Error('绑定的需求不存在')
      const attachmentRoot = (messageId: string) => resolve(demand?.path ?? workspace.path, 'docs', '.channel-attachments', messageId)
      for (const attachment of inbox.message.attachments) {
        const downloaded = await provider.downloadAttachment(sourceMessageId, attachment, attachmentRoot(sourceMessageId))
        if (attachment.type === 'image') {
          const stored = this.hooks.persistImage
            ? await this.hooks.persistImage(binding.workspaceId, binding.conversationId, { path: downloaded.path, name: attachment.name, mimeType: attachment.mimeType })
            : downloaded
          localImages.push({ path: stored.path })
        }
        else paths.push(downloaded.path)
      }
      if (quotedMessage) for (const attachment of quotedMessage.attachments) {
        const downloaded = await provider.downloadAttachment(quotedMessage.messageId, attachment, attachmentRoot(quotedMessage.messageId))
        if (attachment.type === 'image') {
          const stored = this.hooks.persistImage
            ? await this.hooks.persistImage(binding.workspaceId, binding.conversationId, { path: downloaded.path, name: attachment.name, mimeType: attachment.mimeType })
            : downloaded
          localImages.push({ path: stored.path })
        }
        else quotedPaths.push(downloaded.path)
      }
    }
    const prompt = channelPrompt(inbox.message, paths, quotedPaths)
    const resolvedSettings = await this.settings.resolve(binding)
    const { models: _models, ...executionContext } = resolvedSettings
    const commandId = channelCommandId(inbox.message)
    const turnLinkId = this.repositories.projections.createTurnLink({ inboxId, bindingId: binding.id, clientCommandId: commandId })
    const presentation = this.repositories.projections.createPresentation({ accountId: inbox.message.accountId, bindingId: binding.id, turnLinkId, purpose: 'turn', state: { prompt, executionContext } })
    this.repositories.inbox.update(inboxId, 'submitting', { bindingId: binding.id, clientCommandId: commandId })
    await this.projection.observe(binding)
    const initial = projectionCard({
      threadId: binding.threadId, turnId: '', status: 'queued', assistantText: '', assistantImages: [], error: '', terminal: false, revision: 0,
    }, prompt, this.hooks.openUrl(binding), executionContext)
    const sent = await this.hooks.enqueue(inbox.message.accountId, {
      kind: 'reply_card', targetId: replyMessageId, payload: { card: initial, replyInThread: binding.channelScope === 'topic' }, dedupeKey: `${inbox.id}:turn-card`, revision: 0,
    })
    this.repositories.projections.updatePresentation(presentation.id, { remoteMessageId: sent.remoteMessageId, status: sent.status, state: { prompt, executionContext, outboxId: sent.id } })
    try {
      await this.gateway.submitCommand({
        id: commandId,
        workspaceId: binding.workspaceId,
        conversationId: binding.conversationId,
        origin: {
          kind: 'channel', provider: 'feishu', accountId: binding.accountId, bindingId: binding.id,
          messageId: inbox.message.messageId, conversationKey: inbox.conversationKey,
        },
        prompt,
        submitMode: 'queue',
        executionProfile: { permissionMode: binding.permissionMode },
        ...(executionContext.model && executionContext.reasoningEffort ? { settings: {
          model: executionContext.model, reasoningEffort: executionContext.reasoningEffort,
        } } : {}),
        localImages,
      })
      this.repositories.inbox.update(inboxId, 'submitted', { clientCommandId: commandId })
      this.repositories.projections.updateTurnLink(commandId, { status: 'submitted' })
      this.repositories.audit.record(binding.accountId, 'channel.inbound.submitted', 'channel_inbox', inbox.id, true, {
        provider: inbox.message.provider, accountId: binding.accountId, eventId: inbox.message.eventId, messageId: inbox.message.messageId,
        conversationKey: inbox.conversationKey, bindingId: binding.id, threadId: binding.threadId, inboxId: inbox.id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repositories.inbox.update(inboxId, 'failed', { lastError: message })
      this.repositories.projections.updateTurnLink(commandId, { status: 'failed' })
      await this.projection.renderCommandFailure(turnLinkId, message)
      throw error
    }
  }

  async recoverInbox(accountId: string): Promise<void> {
    for (const inbox of this.repositories.inbox.pending(accountId)) {
      try {
        if (inbox.status === 'waiting_binding') continue
        if (inbox.message.text.trim().startsWith('/')) {
          this.repositories.inbox.update(inbox.id, 'failed', { lastError: '控制命令未完成，重启后不会作为普通消息重放。请重新发送该命令。' })
          continue
        }
        const binding = inbox.bindingId ? this.repositories.bindings.get(inbox.bindingId) : this.repositories.bindings.find(accountId, inbox.conversationKey)
        if (!binding) {
          this.repositories.inbox.update(inbox.id, 'failed', { lastError: 'CodyWork 重启后未找到绑定，未自动提交。' })
          continue
        }
        await this.projection.observe(binding)
        if (inbox.status === 'received' || inbox.status === 'ready') {
          this.repositories.inbox.update(inbox.id, 'ready', { bindingId: binding.id })
          await this.submitInbox(inbox.id, binding)
        } else if (inbox.status === 'submitting' && !inbox.turnId) {
          this.repositories.inbox.update(inbox.id, 'failed', { lastError: '提交结果不确定，未自动重发。请使用 /retry 明确重试。' })
        } else if (inbox.turnId) {
          this.projection.scheduleRender(binding, inbox.turnId, true)
        } else {
          this.repositories.inbox.update(inbox.id, 'failed', { lastError: '缺少原生 Turn 关联，未自动重发。请使用 /retry 明确重试。' })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.repositories.inbox.update(inbox.id, 'failed', { lastError: `恢复失败，未自动重发：${message}` })
        this.repositories.audit.record(accountId, 'channel.inbox.recovery_failed', 'channel_inbox', inbox.id, false, {}, message)
      }
    }
  }
}
