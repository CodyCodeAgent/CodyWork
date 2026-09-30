import { createHash } from 'node:crypto'
import {
  channelConversationKey,
  type ChannelInboundMessage,
} from '@codycodeagent/cody-web-core/channel'
import { feishuSelectionCard, feishuTextCard, type FeishuCard, type FeishuCardAction } from '@codycodeagent/cody-web-core/feishu'
import type { ConversationService } from './conversations.js'
import type { ChannelAccessService } from './channelAccessService.js'
import type { ChannelRequestBridge } from './channelRequestBridge.js'
import type { ChannelBindingService } from './channelBindingService.js'
import type { ChannelAccountManager } from './channelAccountManager.js'
import {
  type ChannelAccount,
  type CodyWorkChannelBinding,
} from './channelStore.js'
import type { ChannelRepositoryPorts } from './channelRepositories.js'
import { executionContextMarkdown } from './channelFeishuRenderer.js'
import { channelReasoningLabel, type ChannelModelSettings, type ChannelSessionSettingsService } from './channelSessionSettings.js'

type ChannelRouterHooks = {
  enqueue(accountId: string, input: Parameters<ChannelAccountManager['enqueue']>[1]): ReturnType<ChannelAccountManager['enqueue']>
  addReceiptReaction(accountId: string, messageId: string): Promise<string>
  finishReceiptReaction(accountId: string, messageId: string, reactionId: string, outcome: 'DONE' | 'ERROR'): Promise<void>
  submitInbox(inboxId: string, binding: CodyWorkChannelBinding): Promise<void>
  observe(binding: CodyWorkChannelBinding, options?: { emptyHistory?: boolean }): Promise<void>
  detachBindingObservation(binding: CodyWorkChannelBinding): void
  openUrl(binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string
  accountState(accountId: string): string
  retryOutbox(accountId: string, outboxId: string): void
  fail(accountId: string, action: string, error: unknown): void
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function selectionCard(title: string, text: string, actions: Array<{ text: string; value: Record<string, unknown> }>): FeishuCard {
  return feishuSelectionCard(title, text, actions)
}

function isFlatGroup(message: ChannelInboundMessage): boolean {
  return message.conversation.scope === 'group'
}

function asConfiguredTopic(message: ChannelInboundMessage): ChannelInboundMessage {
  if (!isFlatGroup(message)) return message
  return {
    ...message,
    conversation: { ...message.conversation, scope: 'topic', rootId: message.conversation.rootId || message.messageId },
  }
}

/**
 * Pure channel ingress and binding orchestration. It decides where a message
 * goes, but delegates execution, projection and provider delivery to their
 * respective services.
 */
export class ChannelRouter {
  constructor(
    private readonly repositories: ChannelRepositoryPorts,
    private readonly conversations: ConversationService,
    private readonly access: ChannelAccessService,
    private readonly requests: ChannelRequestBridge,
    private readonly bindings: ChannelBindingService,
    private readonly settings: ChannelSessionSettingsService,
    private readonly hooks: ChannelRouterHooks,
  ) {}

  private allowed(account: ChannelAccount, message: ChannelInboundMessage, binding: CodyWorkChannelBinding | null): { allowed: boolean; reason: string } {
    if (message.sender.type !== 'user') return { allowed: false, reason: 'non_user' }
    if (!message.sender.id) return { allowed: false, reason: 'missing_sender' }
    if (message.conversation.scope !== 'private' && !account.allowAllConversations && !account.allowedConversationIds.includes(message.conversation.id)) return { allowed: false, reason: 'conversation_denied' }
    if (message.mentionsOtherRecipient) return { allowed: false, reason: 'addressed_elsewhere' }
    if (message.conversation.scope !== 'private' && account.groupMentionMode === 'always' && !message.addressedToAgent) return { allowed: false, reason: 'mention_required' }
    if (message.conversation.scope !== 'private' && account.groupMentionMode === 'bound' && !binding && !message.addressedToAgent) return { allowed: false, reason: 'mention_required' }
    if (!account.allowAllUsers && !account.allowedUserIds.includes(message.sender.id)) return { allowed: false, reason: 'sender_denied' }
    return { allowed: true, reason: '' }
  }

  async onMessage(message: ChannelInboundMessage): Promise<void> {
    const profile = isFlatGroup(message) ? this.repositories.bindings.groupProfile(message.accountId, message.conversation.id) : null
    const routedMessage = profile?.conversationMode === 'topic' ? asConfiguredTopic(message) : message
    const claimed = this.repositories.inbox.claim(routedMessage)
    if (!claimed.created) return
    const command = routedMessage.text.trim()
    try {
      const account = this.repositories.accounts.list().find(item => item.id === routedMessage.accountId)
      if (!account?.enabled) return void this.repositories.inbox.update(claimed.item.id, 'ignored', { lastError: 'account_disabled' })
      this.repositories.accounts.updateRuntime(account.id, { connectionState: this.hooks.accountState(account.id), event: true })
      const key = channelConversationKey(routedMessage)
      const binding = this.repositories.bindings.find(account.id, key)
      const decision = this.allowed(account, routedMessage, binding)
      if (!decision.allowed) {
        if (decision.reason === 'sender_denied') {
          await this.withReceipt(routedMessage, () => this.access.request(account, routedMessage, claimed.item.id))
          return
        }
        this.repositories.inbox.update(claimed.item.id, 'ignored', { lastError: decision.reason })
        this.repositories.audit.record(account.id, 'channel.inbound.ignored', 'channel_inbox', claimed.item.id, true, {
          provider: routedMessage.provider, accountId: routedMessage.accountId, eventId: routedMessage.eventId, messageId: routedMessage.messageId,
          conversationKey: key, inboxId: claimed.item.id, ...(binding ? { bindingId: binding.id, threadId: binding.threadId } : {}), reason: decision.reason,
        })
        return
      }
      if (binding && command.startsWith('/')) return void await this.withReceipt(routedMessage, () => this.handleCommand(binding, claimed.item.id, command))
      // Configured topic/reply binding immediately delegates to submitInbox,
      // which owns the durable processing receipt for the resulting Turn.
      if (!binding && profile?.conversationMode === 'topic') return void await this.bindings.bindConfiguredTopic(claimed.item.id, profile)
      if (!binding && profile?.conversationMode === 'reply') return void await this.bindings.bindConfiguredReply(claimed.item.id, profile)
      if (!binding) return void await this.withReceipt(routedMessage, () => this.bindings.requestWorkspace(claimed.item.id))
      this.repositories.inbox.update(claimed.item.id, 'ready', { bindingId: binding.id })
      await this.hooks.submitInbox(claimed.item.id, binding)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.repositories.inbox.update(claimed.item.id, 'failed', { lastError: detail })
      this.repositories.audit.record(routedMessage.accountId, 'channel.inbound.failed', 'channel_inbox', claimed.item.id, false, {
        provider: routedMessage.provider, accountId: routedMessage.accountId, eventId: routedMessage.eventId, messageId: routedMessage.messageId,
        conversationKey: claimed.item.conversationKey, inboxId: claimed.item.id, command: command.startsWith('/'),
      }, detail)
      if (command.startsWith('/')) {
        await this.hooks.enqueue(routedMessage.accountId, {
          kind: 'reply_text', targetId: routedMessage.messageId,
          payload: { text: `命令执行失败：${detail}` }, dedupeKey: `${claimed.item.id}:command-error`, terminal: true,
        }).catch(replyError => this.hooks.fail(message.accountId, 'channel.command.error_reply', replyError))
      }
    }
  }

  private async withReceipt(message: ChannelInboundMessage, action: () => Promise<unknown>): Promise<void> {
    const reactionId = await this.hooks.addReceiptReaction(message.accountId, message.messageId)
    try {
      await action()
      await this.hooks.finishReceiptReaction(message.accountId, message.messageId, reactionId, 'DONE')
    } catch (error) {
      await this.hooks.finishReceiptReaction(message.accountId, message.messageId, reactionId, 'ERROR')
      throw error
    }
  }

  async onAction(accountId: string, action: FeishuCardAction): Promise<unknown> {
    const kind = string(action.value.action)
    const eventId = action.eventId || createHash('sha256')
      .update([accountId, action.remoteMessageId, action.actorId, kind, JSON.stringify(action.value)].join('\u0000'))
      .digest('hex')
    const claim = this.repositories.inbox.claimAction(accountId, eventId, {
      kind, actorId: action.actorId, remoteMessageId: action.remoteMessageId, value: action.value,
    })
    if (!claim.created) {
      return { toast: { type: claim.status === 'action_failed' ? 'error' : 'success', content: claim.status === 'action_failed' ? '该操作此前执行失败，请重新点击后再试' : '该操作已经处理' } }
    }
    try {
      let card: FeishuCard | null = null
      if (kind === 'channel.model_picker') card = await this.handleModelPickerAction(accountId, action)
      else if (kind === 'channel.runtime_picker') card = await this.handleRuntimePickerAction(accountId, action)
      else if (kind === 'channel.runtime_select') card = await this.handleRuntimeSelectAction(accountId, action)
      else if (kind === 'channel.model_select' || kind === 'channel.reasoning_select') card = await this.handleModelAction(accountId, action)
      else if (kind.startsWith('channel.pick_') || kind === 'channel.group_setting_mode') card = await this.bindings.handleAction(accountId, action)
      else if (kind === 'channel.access_approve' || kind === 'channel.access_reject') card = await this.access.handleAction(accountId, action)
      else if (kind === 'channel.approval') await this.requests.handleApprovalAction(accountId, action)
      else if (kind === 'channel.question') await this.requests.handleQuestionAction(accountId, action)
      else if (kind === 'channel.retry_outbox') this.hooks.retryOutbox(accountId, string(action.value.outboxId))
      else throw new Error('未知或已过期的操作')
      this.repositories.inbox.finishAction(claim.id, 'action_completed')
      return card ? { card: { type: 'raw', data: card } } : { toast: { type: 'success', content: '已处理' } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repositories.inbox.finishAction(claim.id, 'action_failed', message)
      this.repositories.audit.record(accountId, 'channel.action.failed', 'feishu_action', action.eventId, false, { action: kind }, message)
      return { toast: { type: 'error', content: message.slice(0, 100) } }
    }
  }

  private modelSummary(settings: ChannelModelSettings): string {
    return executionContextMarkdown(settings).replace(/\n---\n\n$/u, '')
  }

  private modelPickerCard(binding: CodyWorkChannelBinding, settings: ChannelModelSettings): FeishuCard {
    const conversation = this.conversations.get?.(binding.workspaceId, binding.conversationId)
    const runtimeLabel = conversation ? this.runtimeLabel(conversation.runtimeType) : '当前 Runtime'
    if (!settings.models.length) throw new Error(`${runtimeLabel} 当前没有返回可用模型`)
    const reasoningNote = settings.models.some(model => model.supportedReasoningEfforts.length > 0)
      ? '先选择模型，再选择该模型支持的推理程度。保存后只影响后续消息。'
      : '当前 Runtime 不提供推理程度配置；选择模型后将直接生效。'
    return selectionCard('切换 CodyWork 模型', `${this.modelSummary(settings)}\n\n${reasoningNote}`, settings.models.map(model => ({
      text: `${model.label || model.id}${model.id === settings.model ? ' · 当前' : ''}`,
      value: { action: 'channel.model_select', bindingId: binding.id, modelId: model.id },
    })))
  }

  private async handleModelPickerAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const bindingId = string(action.value.bindingId)
    const binding = this.repositories.bindings.get(bindingId)
    if (binding.accountId !== accountId) throw new Error('模型配置不属于当前机器人')
    if (binding.ownerIdentity !== action.actorId) throw new Error('只有此绑定的创建者可以切换模型')
    return this.modelPickerCard(binding, await this.settings.resolve(binding))
  }

  private runtimePickerCard(binding: CodyWorkChannelBinding): FeishuCard {
    const conversation = this.conversations.get(binding.workspaceId, binding.conversationId)
    const current = this.runtimeLabel(conversation.runtimeType)
    const targets = this.conversations.runtimeDescriptors().filter(runtime => runtime.id !== conversation.runtimeType)
    if (!targets.length) throw new Error('当前没有其他可切换的 Runtime')
    return selectionCard('切换 CodyWork Runtime', `当前会话使用 **${current}**。切换会保留源会话，创建一个新的目标 Runtime 会话，并只发送有长度上限的可见历史交接。\n\n切换后，这个飞书会话的后续消息将交由新会话处理；正在执行或等待审批时不能切换。`, targets.map(target => ({
      text: `切换到 ${target.label}`,
      value: { action: 'channel.runtime_select', bindingId: binding.id, targetRuntimeType: target.id },
    })))
  }

  private runtimeLabel(runtimeType: string): string {
    return this.conversations.runtimeDescriptors().find(runtime => runtime.id === runtimeType)?.label ?? runtimeType
  }

  private async handleRuntimePickerAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const binding = this.repositories.bindings.get(string(action.value.bindingId))
    if (binding.accountId !== accountId) throw new Error('底座配置不属于当前机器人')
    if (binding.ownerIdentity !== action.actorId) throw new Error('只有此绑定的创建者可以切换 Runtime')
    return this.runtimePickerCard(binding)
  }

  private async handleRuntimeSelectAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const binding = this.repositories.bindings.get(string(action.value.bindingId))
    if (binding.accountId !== accountId) throw new Error('底座配置不属于当前机器人')
    if (binding.ownerIdentity !== action.actorId) throw new Error('只有此绑定的创建者可以切换 Runtime')
    const targetRuntimeType = string(action.value.targetRuntimeType)
    if (!this.conversations.runtimeDescriptors().some(runtime => runtime.id === targetRuntimeType)) throw new Error('请选择已启用的目标 Runtime')
    const migrated = await this.conversations.migrateRuntime(binding.workspaceId, binding.conversationId, targetRuntimeType, true)
    this.hooks.detachBindingObservation(binding)
    const rebound = this.repositories.bindings.updateConversation(accountId, binding.id, migrated.id)
    await this.hooks.observe(rebound)
    this.repositories.audit.record(accountId, 'channel.runtime.migrated', 'channel_binding', binding.id, true, {
      sourceConversationId: binding.conversationId, targetConversationId: migrated.id, targetRuntimeType,
    })
    const target = this.runtimeLabel(targetRuntimeType)
    return feishuTextCard('CodyWork · Runtime 已切换', `已创建并接管 **${target}** 会话。后续飞书消息会发送到新会话；源会话仍保留，可在 CodyWork 中查看。`, {
      color: 'green', ...(this.hooks.openUrl(rebound) ? { actions: [{ text: '在 CodyWork 中打开', url: this.hooks.openUrl(rebound), type: 'primary' as const }] } : {}),
    })
  }

  private async handleModelAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const bindingId = string(action.value.bindingId)
    const modelId = string(action.value.modelId)
    const actionBinding = this.repositories.bindings.get(bindingId)
    if (actionBinding.accountId !== accountId) throw new Error('模型配置不属于当前机器人')
    if (string(action.value.action) === 'channel.model_select') {
      const { model } = await this.settings.model(bindingId, action.actorId, modelId)
      if (model.supportedReasoningEfforts.length === 0) {
        const selected = await this.settings.select(bindingId, action.actorId, modelId, '')
        const openUrl = this.hooks.openUrl(actionBinding)
        const next = feishuTextCard('CodyWork · 模型已更新', `${this.modelSummary(selected)}\n\n当前 Runtime 未提供推理程度配置，新模型会从下一条消息开始生效。`, {
          color: 'green', ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
        })
        await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `model:${bindingId}:${modelId}`, revision: 2, terminal: true })
        return next
      }
      const next = selectionCard('选择推理程度', `已选择模型：**${model.label || model.id}**\n\n请选择该模型支持的推理程度。保存后只影响后续消息。`, model.supportedReasoningEfforts.map(effort => ({
        text: `${channelReasoningLabel(effort)}${effort === model.defaultReasoningEffort ? ' · 默认' : ''}`,
        value: { action: 'channel.reasoning_select', bindingId, modelId, reasoningEffort: effort },
      })))
      await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `model:${bindingId}:${modelId}`, revision: 1 })
      return next
    }
    const selected = await this.settings.select(bindingId, action.actorId, modelId, string(action.value.reasoningEffort))
    const openUrl = this.hooks.openUrl(actionBinding)
    const next = feishuTextCard('CodyWork · 模型已更新', `${this.modelSummary(selected)}\n\n新配置会从下一条消息开始生效。`, {
      color: 'green', ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
    })
    await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `model:${bindingId}:${modelId}:${selected.reasoningEffort}`, revision: 2, terminal: true })
    return next
  }

  private async handleCommand(binding: CodyWorkChannelBinding, inboxId: string, command: string): Promise<void> {
    const inbox = this.repositories.inbox.get(inboxId)
    const [name, ...args] = command.split(/\s+/u)
    if (name === '/model') {
      if (binding.ownerIdentity !== inbox.message.sender.id) throw new Error('只有此绑定的创建者可以切换模型')
      const settings = await this.settings.resolve(binding)
      const card = this.modelPickerCard(binding, settings)
      await this.hooks.enqueue(binding.accountId, { kind: 'reply_card', targetId: inbox.message.messageId, payload: { card, replyInThread: binding.channelScope === 'topic' }, dedupeKey: `${inbox.id}:model`, terminal: true })
      this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/runtime') {
      if (binding.ownerIdentity !== inbox.message.sender.id) throw new Error('只有此绑定的创建者可以切换 Runtime')
      const card = this.runtimePickerCard(binding)
      await this.hooks.enqueue(binding.accountId, { kind: 'reply_card', targetId: inbox.message.messageId, payload: { card, replyInThread: binding.channelScope === 'topic' }, dedupeKey: `${inbox.id}:runtime`, terminal: true })
      this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/setting') {
      if (binding.channelScope === 'private') throw new Error('私聊没有群会话模式；可直接使用 /status 查看绑定。')
      if (binding.ownerIdentity !== inbox.message.sender.id) throw new Error('只有此群绑定的创建者可以修改设置')
      const profile = this.repositories.bindings.groupProfile(binding.accountId, binding.channelConversationId)
      const current = profile?.conversationMode === 'topic' ? '话题任务' : '回复原消息'
      const card = selectionCard('CodyWork 群设置', `当前模式：**${current}**。修改只影响后续的新消息；不会中断正在执行的任务，也不会迁移已有会话。`, [
        { text: '回复原消息 · 共享会话', value: { action: 'channel.group_setting_mode', bindingId: binding.id, groupMode: 'reply' } },
        { text: '话题任务 · 每条根消息独立会话', value: { action: 'channel.group_setting_mode', bindingId: binding.id, groupMode: 'topic' } },
      ])
      await this.hooks.enqueue(binding.accountId, { kind: 'reply_card', targetId: inbox.message.messageId, payload: { card, replyInThread: binding.channelScope === 'topic' }, dedupeKey: `${inbox.id}:setting`, terminal: true })
      this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/status') {
      const conversation = this.conversations.get(binding.workspaceId, binding.conversationId)
      const openUrl = this.hooks.openUrl(binding)
      const scope = binding.targetType === 'codywork-workspace' ? 'Workspace 会话' : 'Demand Worktree'
      await this.hooks.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text: `已绑定：${conversation.title}\n范围：${scope}\nThread：${binding.threadId}\n连接：${this.hooks.accountState(binding.accountId)}${openUrl ? `\n在 CodyWork 中打开：${openUrl}` : ''}` }, dedupeKey: `${inbox.id}:status`, terminal: true })
      this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/unbind') {
      this.hooks.detachBindingObservation(binding)
      this.repositories.bindings.delete(binding.accountId, inbox.conversationKey)
      await this.hooks.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text: '已解除 CodyWork 绑定。下一条消息会重新选择 Workspace、运行范围和会话。' }, dedupeKey: `${inbox.id}:unbind`, terminal: true })
      this.repositories.inbox.update(inbox.id, 'completed'); return
    }
    if (name === '/stop') {
      const result = await this.conversations.executeAction({
        kind: 'interrupt', workspaceId: binding.workspaceId, conversationId: binding.conversationId,
        origin: { kind: 'channel', provider: 'feishu', accountId: binding.accountId, bindingId: binding.id, messageId: inbox.message.messageId, conversationKey: binding.conversationKey },
      })
      const text = result.kind === 'interrupt' && result.supported ? '已请求停止当前回复。' : '当前没有正在执行、可停止的回复。'
      await this.hooks.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text }, dedupeKey: `${inbox.id}:stop`, terminal: true })
      this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/retry') {
      const failed = this.repositories.inbox.latestFailed(binding.accountId, inbox.conversationKey)
      if (!failed) throw new Error('没有可重试的失败消息')
      const failedMessage = failed.message as ChannelInboundMessage & { sourceMessageId?: string }
      const retried: ChannelInboundMessage & { sourceMessageId?: string; replyMessageId?: string } = {
        ...failed.message, eventId: `${failed.message.eventId}:retry:${inbox.id}`,
        messageId: `${failed.message.messageId}:retry:${inbox.id}`,
        sourceMessageId: failedMessage.sourceMessageId || failed.message.messageId,
        replyMessageId: inbox.message.messageId,
      }
      const claimed = this.repositories.inbox.claim(retried)
      this.repositories.inbox.update(claimed.item.id, 'ready', { bindingId: binding.id })
      await this.hooks.submitInbox(claimed.item.id, binding)
      this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/answer') {
      const [requestId, ...answerParts] = args
      const answer = answerParts.join(' ').trim()
      if (!requestId || !answer) throw new Error('用法：/answer <requestId> <答案>')
      const request = this.repositories.requests.get(binding.accountId, requestId)
      if (request.requesterIdentity !== inbox.message.sender.id || request.status !== 'pending') throw new Error('问题不存在、已回答或无权处理')
      await this.conversations.executeAction({
        kind: 'question.resolve', workspaceId: binding.workspaceId, conversationId: binding.conversationId,
        origin: { kind: 'channel', provider: 'feishu', accountId: binding.accountId, bindingId: binding.id, messageId: inbox.message.messageId, conversationKey: binding.conversationKey },
        requestId, answer,
      })
      this.repositories.requests.update(binding.accountId, request.id, { status: 'answered' })
      this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    await this.hooks.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text: '可用命令：/model、/runtime、/status、/stop、/retry、/unbind、/setting（群聊）、/answer <requestId> <答案>' }, dedupeKey: `${inbox.id}:help`, terminal: true })
    this.repositories.inbox.update(inbox.id, 'completed', { bindingId: binding.id })
  }
}
