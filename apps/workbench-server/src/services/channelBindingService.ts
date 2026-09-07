import type { ChannelInboundMessage } from '@codycodeagent/cody-web-core/channel'
import { feishuSelectionCard, feishuTextCard, type FeishuCard, type FeishuCardAction } from '@codycodeagent/cody-web-core/feishu'
import type { WorkbenchDb } from '../db/index.js'
import type { ConversationService } from './conversations.js'
import { listDemands } from './demands.js'
import type { ChannelAccountManager } from './channelAccountManager.js'
import type { WorkspaceRegistry } from './workspaceRegistry.js'
import type { ChannelGroupProfile, CodyWorkChannelBinding } from './channelStore.js'
import type { ChannelRepositoryPorts, InboxRepository } from './channelRepositories.js'

type Hooks = {
  enqueue(accountId: string, input: Parameters<ChannelAccountManager['enqueue']>[1]): ReturnType<ChannelAccountManager['enqueue']>
  submitInbox(inboxId: string, binding: CodyWorkChannelBinding): Promise<void>
  observe(binding: CodyWorkChannelBinding, options?: { emptyHistory?: boolean }): Promise<void>
  openUrl(binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string
}

function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function isFlatGroup(message: ChannelInboundMessage): boolean { return message.conversation.scope === 'group' }
function asTopic(message: ChannelInboundMessage): ChannelInboundMessage {
  return isFlatGroup(message) ? { ...message, conversation: { ...message.conversation, scope: 'topic', rootId: message.conversation.rootId || message.messageId } } : message
}
function card(title: string, text: string, actions: Array<{ text: string; value: Record<string, unknown> }>): FeishuCard {
  return feishuSelectionCard(title, text, actions)
}

/** Owns the durable remote-conversation -> CodyWork conversation binding flow. */
export class ChannelBindingService {
  constructor(
    private readonly database: WorkbenchDb,
    private readonly repositories: ChannelRepositoryPorts,
    private readonly conversations: ConversationService,
    private readonly workspaces: WorkspaceRegistry,
    private readonly hooks: Hooks,
  ) {}

  async requestWorkspace(inboxId: string): Promise<void> {
    const inbox = this.repositories.inbox.update(inboxId, 'waiting_binding')
    if (isFlatGroup(inbox.message)) {
      const next = card('配置此群的 CodyWork 会话', '先选择群内消息的组织方式。此设置只影响本群；完成 Workspace、范围与权限配置后，当前消息才会执行。', [
        { text: '回复原消息 · 共享会话', value: { action: 'channel.pick_group_mode', inboxId, groupMode: 'reply' } },
        { text: '话题任务 · 每条根消息独立会话', value: { action: 'channel.pick_group_mode', inboxId, groupMode: 'topic' } },
      ])
      await this.hooks.enqueue(inbox.message.accountId, { kind: 'reply_card', targetId: inbox.message.messageId, payload: { card: next, replyInThread: false }, dedupeKey: `${inbox.id}:pick-group-mode`, terminal: true })
      return
    }
    const next = card('绑定 CodyWork Workspace', '首次使用需要选择消息要进入的 Workspace。原消息已保留，完成绑定后会自动提交。', this.workspaces.list().map(workspace => ({
      text: workspace.name, value: { action: 'channel.pick_workspace', inboxId, workspaceId: workspace.id },
    })))
    await this.hooks.enqueue(inbox.message.accountId, { kind: 'reply_card', targetId: inbox.message.messageId, payload: { card: next, replyInThread: inbox.message.conversation.scope === 'topic' }, dedupeKey: `${inbox.id}:pick-workspace`, terminal: true })
  }

  async handleAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    return action.value.action === 'channel.group_setting_mode'
      ? this.handleGroupSettingAction(accountId, action)
      : this.handleBindingAction(accountId, action)
  }

  private assertOwner(inboxId: string, actorId: string): ReturnType<InboxRepository['get']> {
    const inbox = this.repositories.inbox.get(inboxId)
    if (inbox.message.sender.id !== actorId) throw new Error('只有发起人可以完成这次绑定')
    return inbox
  }

  private async handleBindingAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const inboxId = string(action.value.inboxId)
    const inbox = this.assertOwner(inboxId, action.actorId)
    if (inbox.message.accountId !== accountId || inbox.status !== 'waiting_binding') throw new Error('绑定请求已失效')
    const kind = string(action.value.action)
    const groupMode = action.value.groupMode === 'topic' ? 'topic' : action.value.groupMode === 'reply' ? 'reply' : ''
    const carryMode = <T extends Record<string, unknown>>(value: T): T & { groupMode?: string } => groupMode ? { ...value, groupMode } : value
    if (kind === 'channel.pick_group_mode') {
      const next = card('绑定 CodyWork Workspace', '此群将按所选模式运行。选择 Workspace 后继续选择运行范围、会话与权限；原消息会在配置完成后自动执行。', this.workspaces.list().map(workspace => ({ text: workspace.name, value: carryMode({ action: 'channel.pick_workspace', inboxId, workspaceId: workspace.id }) })))
      await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `${inbox.id}:pick-workspace:${groupMode}`, revision: 1 })
      return next
    }
    if (kind === 'channel.pick_workspace') {
      const workspaceId = string(action.value.workspaceId)
      const workspace = this.workspaces.get(workspaceId)
      const actions = listDemands(this.database, workspace).map(demand => ({ text: demand.name, value: carryMode({ action: 'channel.pick_demand', inboxId, workspaceId, demandId: demand.id }) }))
      actions.unshift({ text: 'Workspace 只读搜索', value: carryMode({ action: 'channel.pick_workspace_scope', inboxId, workspaceId, demandId: '' }) })
      const next = card('选择 CodyWork 运行范围', `Workspace：**${workspace.name}**\n\nWorkspace 搜索会话可读代码、知识库并运行查询命令，但不能修改任何文件；开发任务请选择下方 Demand。`, actions)
      await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `${inbox.id}:pick-scope:${workspaceId}`, revision: 1 })
      return next
    }
    const workspaceId = string(action.value.workspaceId)
    const demandId = string(action.value.demandId)
    if (kind === 'channel.pick_workspace_scope') {
      const workspace = this.workspaces.get(workspaceId)
      const actions = this.conversations.listWorkspace(workspaceId).map(session => ({ text: session.title, value: carryMode({ action: 'channel.pick_workspace_session', inboxId, workspaceId, demandId: '', conversationId: session.id }) }))
      actions.unshift({ text: '+ 新建只读搜索会话', value: carryMode({ action: 'channel.pick_new_workspace_session', inboxId, workspaceId, demandId: '', conversationId: '' }) })
      const next = card('选择 Workspace 搜索会话', `Workspace：**${workspace.name}**\n\n飞书与浏览器将共享同一个只读 Codex Thread。可运行查询命令和联网，但文件写入会被沙箱阻止。`, actions)
      await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `${inbox.id}:pick-workspace-session:${workspaceId}`, revision: 2 })
      return next
    }
    if (kind === 'channel.pick_demand') {
      const workspace = this.workspaces.get(workspaceId)
      const demand = listDemands(this.database, workspace).find(item => item.id === demandId)
      if (!demand) throw new Error('需求不存在')
      const actions = this.conversations.list(workspaceId, demandId).map(session => ({ text: session.title, value: carryMode({ action: 'channel.pick_session', inboxId, workspaceId, demandId, conversationId: session.id }) }))
      actions.unshift({ text: '+ 新建会话', value: carryMode({ action: 'channel.pick_new_session', inboxId, workspaceId, demandId, conversationId: '' }) })
      const next = card('选择 CodyWork 会话', `需求：**${demand.name}**\n\n飞书与浏览器将共享同一个原生 Codex Thread。`, actions)
      await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `${inbox.id}:pick-session:${demandId}`, revision: 2 })
      return next
    }
    const effectiveKind = kind === 'channel.pick_permission' ? string(action.value.sessionAction) : kind
    const workspaceKinds = new Set(['channel.pick_workspace_session', 'channel.pick_new_workspace_session'])
    const demandKinds = new Set(['channel.pick_session', 'channel.pick_new_session'])
    if (!workspaceKinds.has(effectiveKind) && !demandKinds.has(effectiveKind)) throw new Error('未知绑定步骤')
    const workspaceScope = workspaceKinds.has(effectiveKind)
    const isNew = effectiveKind === 'channel.pick_new_session' || effectiveKind === 'channel.pick_new_workspace_session'
    const permissionMode = workspaceScope ? 'read-only' : action.value.permissionMode === 'workspace-write' ? 'workspace-write' : action.value.permissionMode === 'yolo' ? 'yolo' : ''
    if (!workspaceScope && !permissionMode) {
      const next = card('选择执行权限', 'YOLO 使用底层 Codex danger-full-access，拥有 CodyWork 服务账号可用的完整系统权限；Normal 使用 Codex 原生 workspace-write 与审批机制。此选择可在 CodyWork 页面后续调整。', [
        { text: 'YOLO（默认）', value: carryMode({ action: 'channel.pick_permission', inboxId, workspaceId, demandId, conversationId: string(action.value.conversationId), sessionAction: effectiveKind, permissionMode: 'yolo' }) },
        { text: 'Normal（每次审批）', value: carryMode({ action: 'channel.pick_permission', inboxId, workspaceId, demandId, conversationId: string(action.value.conversationId), sessionAction: effectiveKind, permissionMode: 'workspace-write' }) },
      ])
      await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `${inbox.id}:pick-permission:${effectiveKind}`, revision: 3 })
      return next
    }
    const conversation = isNew
      ? workspaceScope ? await this.conversations.createWorkspace(workspaceId, '飞书只读搜索', 'feishu') : await this.conversations.create(workspaceId, demandId, '飞书会话', 'feishu')
      : this.conversations.get(workspaceId, string(action.value.conversationId))
    if (workspaceScope && conversation.scope !== 'workspace') throw new Error('所选会话不是 Workspace 搜索会话')
    if (!workspaceScope && (conversation.scope !== 'demand' || conversation.demandId !== demandId)) throw new Error('所选会话不属于当前 Demand')
    const binding = this.repositories.bindings.create({
      message: groupMode === 'topic' ? asTopic(inbox.message) : inbox.message,
      targetType: workspaceScope ? 'codywork-workspace' : 'codywork-demand', workspaceId, demandId: workspaceScope ? null : demandId,
      conversationId: conversation.id, threadId: conversation.nativeId, ownerIdentity: inbox.message.sender.id,
      permissionMode: permissionMode as CodyWorkChannelBinding['permissionMode'], notificationPolicy: 'mirror-requests',
    })
    if (groupMode) this.repositories.bindings.saveGroupProfile({
      accountId, channelConversationId: inbox.message.conversation.id, conversationMode: groupMode,
      targetType: workspaceScope ? 'codywork-workspace' : 'codywork-demand', workspaceId, demandId: workspaceScope ? null : demandId,
      conversationId: groupMode === 'reply' ? conversation.id : null, permissionMode: permissionMode as ChannelGroupProfile['permissionMode'], ownerIdentity: inbox.message.sender.id,
    })
    this.repositories.inbox.update(inbox.id, 'ready', { bindingId: binding.id })
    await this.hooks.observe(binding, { emptyHistory: isNew })
    const openUrl = this.hooks.openUrl(binding)
    const scopeNote = workspaceScope ? 'Workspace 只读搜索；可运行查询命令，但不能修改文件。' : permissionMode === 'yolo' ? 'Demand Worktree 开发会话；YOLO 已启用。' : 'Demand Worktree 开发会话；Normal 审批模式。'
    const groupNote = groupMode === 'topic' ? '\n\n此群后续每条根消息都会创建独立会话。发送 `/setting` 可调整。' : groupMode === 'reply' ? '\n\n此群后续消息将共享本会话并回复原消息。发送 `/setting` 可调整。' : ''
    const next = feishuTextCard('CodyWork 已绑定', `已绑定到 **${conversation.title}**。${scopeNote}${groupNote}\n\n接下来在本对话发送的消息会进入同一个 Codex Thread。`, { color: 'green', ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}) })
    await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `${inbox.id}:bound`, revision: 3, terminal: true })
    this.repositories.audit.record(accountId, 'channel.binding.created', 'channel_binding', binding.id, true, { provider: inbox.message.provider, accountId, eventId: inbox.message.eventId, messageId: inbox.message.messageId, conversationKey: inbox.conversationKey, bindingId: binding.id, threadId: binding.threadId, inboxId: inbox.id })
    await this.hooks.submitInbox(inbox.id, binding)
    return next
  }

  async bindConfiguredTopic(inboxId: string, profile: ChannelGroupProfile): Promise<void> {
    const inbox = this.repositories.inbox.get(inboxId)
    const workspaceScope = profile.targetType === 'codywork-workspace'
    const conversation = workspaceScope ? await this.conversations.createWorkspace(profile.workspaceId, '飞书话题搜索', 'feishu') : await this.conversations.create(profile.workspaceId, profile.demandId!, '飞书话题', 'feishu')
    const binding = this.repositories.bindings.create({ message: inbox.message, targetType: profile.targetType, workspaceId: profile.workspaceId, demandId: profile.demandId, conversationId: conversation.id, threadId: conversation.nativeId, ownerIdentity: profile.ownerIdentity, permissionMode: profile.permissionMode, notificationPolicy: 'mirror-requests' })
    this.repositories.inbox.update(inbox.id, 'ready', { bindingId: binding.id })
    await this.hooks.observe(binding, { emptyHistory: true })
    await this.hooks.submitInbox(inbox.id, binding)
  }

  async bindConfiguredReply(inboxId: string, profile: ChannelGroupProfile): Promise<void> {
    if (!profile.conversationId) throw new Error('此群共享会话已不存在；请 @机器人重新完成绑定')
    const inbox = this.repositories.inbox.get(inboxId)
    const conversation = this.conversations.get(profile.workspaceId, profile.conversationId)
    const binding = this.repositories.bindings.create({ message: inbox.message, targetType: profile.targetType, workspaceId: profile.workspaceId, demandId: profile.demandId, conversationId: conversation.id, threadId: conversation.nativeId, ownerIdentity: profile.ownerIdentity, permissionMode: profile.permissionMode, notificationPolicy: 'mirror-requests' })
    this.repositories.inbox.update(inbox.id, 'ready', { bindingId: binding.id })
    await this.hooks.observe(binding)
    await this.hooks.submitInbox(inbox.id, binding)
  }

  private async handleGroupSettingAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const binding = this.repositories.bindings.get(string(action.value.bindingId))
    if (binding.accountId !== accountId || binding.ownerIdentity !== action.actorId) throw new Error('只有此群绑定的创建者可以修改设置')
    if (binding.channelScope === 'private') throw new Error('仅群聊支持此设置')
    const conversationMode = action.value.groupMode === 'topic' ? 'topic' : 'reply'
    this.repositories.bindings.saveGroupProfile({ accountId, channelConversationId: binding.channelConversationId, conversationMode, targetType: binding.targetType, workspaceId: binding.workspaceId, demandId: binding.demandId, conversationId: conversationMode === 'reply' ? binding.conversationId : null, permissionMode: binding.permissionMode, ownerIdentity: binding.ownerIdentity })
    const text = conversationMode === 'topic' ? '后续新的根消息会分别创建独立 CodyWork 会话。当前正在运行或已存在的会话不会被中断。' : '后续消息会继续使用本群已绑定的共享会话，并回复原消息。当前正在运行或已存在的会话不会被中断。'
    const next = feishuTextCard('CodyWork 群设置已保存', text, { color: 'green' })
    await this.hooks.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: next }, dedupeKey: `group-setting:${binding.id}:${conversationMode}`, terminal: true })
    return next
  }
}
