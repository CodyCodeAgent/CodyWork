import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import {
  ReliableChannelOutbox,
  channelCommandId,
  channelConversationKey,
  projectChannelTurn,
  stripMarkdownImages,
  type ChannelInboundMessage,
  type ChannelOutboxItem,
} from '@codycodeagent/cody-web-core/channel'
import { createConversationState, reduceConversationEvent, reduceConversationEvents, type ConversationState } from '@codycodeagent/cody-web-core/conversation'
import { FeishuProvider, feishuSelectionCard, feishuTextCard, type FeishuCard, type FeishuCardAction, type FeishuCardButton } from '@codycodeagent/cody-web-core/feishu'
import type { ConversationEvent } from './conversations.js'
import type { WorkbenchDb } from '../db/index.js'
import { ConversationService } from './conversations.js'
import { listDemands } from './demands.js'
import { WorkspaceRegistry } from './workspaceRegistry.js'
import {
  ChannelStore,
  type ChannelAccount,
  type ChannelAccountInput,
  type ChannelInteractiveRequest,
  type CodyWorkChannelBinding,
  type ChannelPresentation,
} from './channelStore.js'

type Runtime = {
  account: ChannelAccount
  provider: FeishuProvider
  outbox: ReliableChannelOutbox
  flushTimer: ReturnType<typeof setInterval>
}

type ObservedConversation = {
  state: ConversationState
  bindingIds: Set<string>
}

type DeliveryPayload = {
  text?: string
  card?: FeishuCard
  imageKey?: string
  path?: string
  root?: string
  replyMessageId?: string
  replyInThread?: boolean
}

type CodyWorkInboundMessage = ChannelInboundMessage & {
  /** Original Feishu message that owns attachment resource keys. */
  sourceMessageId?: string
  /** Real Feishu message that should receive the retry receipt. */
  replyMessageId?: string
}

const PROJECTION_THROTTLE_MS = 700
const FEISHU_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stableUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function statusLabel(status: ReturnType<typeof projectChannelTurn>['status']): string {
  return ({ queued: '排队中', running: '执行中', retrying: '上游恢复中', disconnected: '上游已断开', completed: '已完成', failed: '失败', interrupted: '已停止' } as const)[status]
}

function statusColor(status: ReturnType<typeof projectChannelTurn>['status']): string {
  if (status === 'completed') return 'green'
  if (status === 'failed' || status === 'disconnected') return 'red'
  if (status === 'interrupted') return 'grey'
  if (status === 'retrying') return 'orange'
  return 'blue'
}

export function feishuProjectionBody(projection: ReturnType<typeof projectChannelTurn>): string {
  return stripMarkdownImages(projection.assistantText, image => image.alt ? `🖼️ ${image.alt}` : '🖼️ 图片')
}

function projectionCard(projection: ReturnType<typeof projectChannelTurn>, prompt: string, openUrl = ''): FeishuCard {
  const body = feishuProjectionBody(projection) || (projection.error ? `**${projection.error}**` : 'CodyWork 已接收消息，正在等待 Codex 输出…')
  return feishuTextCard(`CodyWork · ${statusLabel(projection.status)}`, body, {
    color: statusColor(projection.status),
    ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
    note: `问题：${prompt.slice(0, 180)}${prompt.length > 180 ? '…' : ''}`,
  })
}

export function codyWorkConversationUrl(publicOrigin: string | undefined, binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string {
  if (!publicOrigin?.trim()) return ''
  try {
    const url = new URL(publicOrigin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    url.searchParams.set('workspace', binding.workspaceId)
    url.searchParams.set('demand', binding.demandId)
    url.searchParams.set('conversation', binding.conversationId)
    return url.toString()
  } catch {
    return ''
  }
}

function selectionCard(title: string, text: string, actions: Array<{ text: string; value: Record<string, unknown> }>): FeishuCard {
  return feishuSelectionCard(title, text, actions)
}

function markdownCode(value: string, limit = 1_600): string {
  const compact = value.trim().slice(0, limit).replaceAll('```', '``\u200b`')
  return compact ? `\n\n\`\`\`text\n${compact}${value.trim().length > limit ? '\n…' : ''}\n\`\`\`` : ''
}

function interactiveRequestSummary(kind: 'approval' | 'question', method: string, data: Record<string, unknown>): string {
  const params = record(data.params)
  if (kind === 'approval') {
    const commandValue = params.command
    const command = Array.isArray(commandValue) ? commandValue.map(string).filter(Boolean).join(' ') : string(commandValue)
    const cwd = string(params.cwd)
    const reason = string(params.reason || params.justification || data.reason || data.justification)
    const lines = [`**${method}**`, 'Codex 请求执行以下操作。']
    if (command) lines.push(markdownCode(command))
    if (cwd) lines.push(`工作目录：\`${cwd.slice(0, 1_000)}\``)
    if (reason) lines.push(`原因：${reason.slice(0, 1_000)}`)
    return lines.filter(Boolean).join('\n\n')
  }
  const questions = Array.isArray(params.questions) ? params.questions : []
  const first = record(questions[0])
  const prompt = string(first.question || first.prompt || first.header || params.question || params.prompt)
  const header = string(first.header)
  return [`**${method}**`, header && header !== prompt ? header : '', prompt || 'Codex 正在等待你的回答。'].filter(Boolean).join('\n\n')
}

/**
 * CodyWork's embedded Channel Host. Core owns channel mechanics and Codex owns
 * the native Thread; this service only applies CodyWork authorization, target
 * binding, and presentation policy.
 */
export class CodyWorkChannelService {
  private readonly store: ChannelStore
  private readonly runtimes = new Map<string, Runtime>()
  private readonly observed = new Map<string, ObservedConversation>()
  private readonly observationInitializations = new Map<string, Promise<void>>()
  private readonly pendingConversationEvents = new Map<string, ConversationEvent[]>()
  private readonly renderTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly unsubscribeConversationEvents: () => void

  constructor(
    private readonly database: WorkbenchDb,
    private readonly conversations: ConversationService,
    private readonly workspaces: WorkspaceRegistry,
    private readonly options: { publicOrigin?: string } = {},
  ) {
    this.store = new ChannelStore(database)
    // One process-lifetime subscription follows ConversationService's owner
    // event bus. Per-conversation Runtime handles may be resumed/replaced; the
    // channel projection must not disappear with one of those handles.
    this.unsubscribeConversationEvents = this.conversations.subscribeAllChannels(event => this.receiveConversationEvent(event))
  }

  async start(): Promise<void> {
    for (const account of this.store.listAccounts()) {
      if (account.enabled) await this.startAccount(account.id).catch(error => this.failAccount(account.id, 'channel.start', error))
    }
  }

  async close(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      clearInterval(runtime.flushTimer)
      runtime.provider.stop()
    }
    this.runtimes.clear()
    this.unsubscribeConversationEvents()
    this.observed.clear()
    this.observationInitializations.clear()
    this.pendingConversationEvents.clear()
    for (const timer of this.renderTimers.values()) clearTimeout(timer)
    this.renderTimers.clear()
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
  }

  listAccounts(): ChannelAccount[] { return this.store.listAccounts() }

  listBindings(accountId: string) { return this.store.listBindings(accountId) }

  private openUrl(binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string {
    return codyWorkConversationUrl(this.options?.publicOrigin, binding)
  }

  private auditDelivery(action: string, item: ChannelOutboxItem, success: boolean, error = ''): void {
    // Delivery has already crossed the external side-effect boundary. An audit
    // write must never turn a successful Feishu call into a retryable Outbox
    // failure (and therefore risk a duplicate remote message).
    try {
      this.store.audit(item.accountId, action, 'channel_outbox', item.id, success, {
        provider: item.provider,
        accountId: item.accountId,
        outboxId: item.id,
      }, error)
    } catch (auditError) {
      console.error(`[codywork] failed to persist ${action} audit for ${item.id}: ${auditError instanceof Error ? auditError.message : String(auditError)}`)
    }
  }

  listConversationBindings(conversationId: string) {
    const accounts = new Map(this.store.listAccounts().map(account => [account.id, account]))
    return this.store.listBindingsForConversation(conversationId).map(binding => {
      const account = accounts.get(binding.accountId)
      const diagnostics = this.store.diagnostics(binding.accountId)
      return {
        ...binding,
        accountName: account?.name ?? '飞书机器人',
        botName: account?.botName ?? '',
        connectionState: account?.connectionState ?? 'idle',
        lastError: account?.lastError ?? '',
        pendingDeliveries: diagnostics.outbox.pending,
        deadLetters: diagnostics.outbox.deadLetter,
      }
    })
  }

  unbind(accountId: string, bindingId: string): boolean {
    const binding = this.store.deleteBindingById(accountId, bindingId)
    if (!binding) return false
    this.detachBindingObservation(binding)
    this.store.audit(accountId, 'channel.binding.removed', 'channel_binding', bindingId, true, { conversationId: binding.conversationId })
    return true
  }

  diagnostics(accountId: string) {
    const account = this.store.getAccount(accountId)
    const bindingConversationIds = new Set(this.store.listBindings(accountId).map(binding => binding.conversationId))
    return {
      account: { ...account, appSecret: undefined },
      runtime: {
        observedConversations: [...bindingConversationIds].filter(id => this.observed.has(id)).length,
        initializingConversations: [...bindingConversationIds].filter(id => this.observationInitializations.has(id)).length,
        bufferedEvents: [...bindingConversationIds].reduce((count, id) => count + (this.pendingConversationEvents.get(id)?.length ?? 0), 0),
      },
      ...this.store.diagnostics(accountId),
    }
  }

  async saveAccount(id: string | null, input: ChannelAccountInput): Promise<ChannelAccount> {
    this.store.validateAccountInput(id, input)
    const previous = id ? this.store.getAccount(id) : null
    const candidate = {
      appId: input.appId.trim(),
      appSecret: input.appSecret?.trim() || previous?.appSecret || '',
      domain: input.domain === 'lark' ? 'lark' as const : 'feishu' as const,
      enabled: Boolean(input.enabled),
      privateConversationMode: input.privateConversationMode === 'topic' ? 'topic' as const : 'chat' as const,
    }
    const runtimeChanged = !previous
      || previous.appId !== candidate.appId
      || previous.appSecret !== candidate.appSecret
      || previous.domain !== candidate.domain
      || previous.enabled !== candidate.enabled
      || previous.privateConversationMode !== candidate.privateConversationMode
      || (candidate.enabled && !this.runtimes.has(previous.id))

    if (candidate.enabled && (!previous
      || previous.appId !== candidate.appId
      || previous.appSecret !== candidate.appSecret
      || previous.domain !== candidate.domain)) {
      await this.probeAccount(candidate)
    }

    if (id && !runtimeChanged) {
      const account = this.store.saveAccount(id, input)
      const runtime = this.runtimes.get(id)
      if (runtime) runtime.account = this.store.getAccount(id)
      this.store.audit(id, 'channel.account.updated', 'channel_account', id, true, { enabled: account.enabled, reconnected: false })
      return this.store.listAccounts().find(item => item.id === id)!
    }

    if (id) await this.stopAccount(id)
    let account: ChannelAccount | null = null
    try {
      account = this.store.saveAccount(id, input)
      const accountId = account.id
      if (account.enabled) await this.startAccount(accountId)
      this.store.audit(accountId, id ? 'channel.account.updated' : 'channel.account.created', 'channel_account', accountId, true, { enabled: account.enabled, reconnected: true })
      return this.store.listAccounts().find(item => item.id === accountId)!
    } catch (error) {
      if (account && !previous) {
        await this.stopAccount(account.id).catch(() => undefined)
        this.store.deleteAccount(account.id)
      } else if (previous) {
        this.store.restoreAccount(previous)
        if (previous.enabled) {
          try {
            await this.startAccount(previous.id)
          } catch (restoreError) {
            this.failAccount(previous.id, 'channel.account.rollback', restoreError)
          }
        }
        this.store.audit(previous.id, 'channel.account.update_failed', 'channel_account', previous.id, false, { restored: true }, error instanceof Error ? error.message : String(error))
      }
      throw error
    }
  }

  async deleteAccount(id: string): Promise<void> {
    await this.stopAccount(id)
    this.store.deleteAccount(id)
  }

  async reconnect(accountId: string): Promise<void> {
    await this.stopAccount(accountId)
    await this.startAccount(accountId)
  }

  retryOutbox(accountId: string, outboxId: string): void {
    this.store.retryOutbox(accountId, outboxId)
    void this.runtimes.get(accountId)?.outbox.flush()
  }

  private async startAccount(accountId: string): Promise<void> {
    if (this.runtimes.has(accountId)) return
    const account = this.store.getAccount(accountId)
    if (!account.enabled) return
    const provider = this.createProvider(account)
    const outbox = new ReliableChannelOutbox({ provider: 'feishu', accountId }, this.store, {
      deliver: async item => this.deliver(provider, accountId, item),
      classifyError: error => provider.classifyError(error),
    })
    const flushTimer = setInterval(() => { void this.flushAndReconcile(accountId) }, 2_000)
    flushTimer.unref?.()
    this.runtimes.set(accountId, { account, provider, outbox, flushTimer })
    try {
      // Browser Turns can start as soon as the HTTP server accepts traffic.
      // Attach every persisted binding before the first network await so a
      // transient approval/question cannot fall into the account-start gap.
      // The process-lifetime owner event tap buffers events while each history
      // snapshot establishes its reducer baseline.
      await this.recoverBindings(accountId)
      const identity = await provider.identity()
      this.store.updateRuntime(accountId, { connectionState: 'connecting', botOpenId: identity.id, botName: identity.name })
      await this.recoverInbox(accountId)
      await this.flushAndReconcile(accountId)
      // New external events are consumed only after durable state converges.
      // This keeps startup recovery deterministic and prevents fresh traffic
      // from overtaking older Inbox/Outbox work.
      await provider.start({
        onMessage: message => this.onMessage(message),
        onAction: action => this.onAction(accountId, action),
        onState: (state, error, diagnostic) => {
          this.store.updateRuntime(accountId, {
            connectionState: state,
            ...(error ? { error: error.message } : state === 'connected' ? { error: '' } : {}),
            connected: state === 'connected',
            connectionDiagnostic: diagnostic,
          })
          if (state === 'failed') this.scheduleAccountReconnect(accountId)
        },
      })
    } catch (error) {
      clearInterval(flushTimer)
      provider.stop()
      this.runtimes.delete(accountId)
      throw error
    }
  }

  private createProvider(account: Pick<ChannelAccount & { appSecret: string }, 'id' | 'appId' | 'appSecret' | 'domain' | 'botOpenId' | 'privateConversationMode'>): FeishuProvider {
    return new FeishuProvider({
      accountId: account.id,
      appId: account.appId,
      appSecret: account.appSecret,
      domain: account.domain,
      botOpenId: account.botOpenId,
      privateConversationMode: account.privateConversationMode,
    })
  }

  private async probeAccount(account: { appId: string; appSecret: string; domain: 'feishu' | 'lark'; privateConversationMode: 'topic' | 'chat' }): Promise<void> {
    const provider = this.createProvider({ ...account, id: 'candidate', botOpenId: '' })
    try {
      await provider.identity()
    } finally {
      provider.stop()
    }
  }

  private async stopAccount(accountId: string): Promise<void> {
    const reconnectTimer = this.reconnectTimers.get(accountId)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    this.reconnectTimers.delete(accountId)
    this.detachAccountObservations(accountId)
    const runtime = this.runtimes.get(accountId)
    if (!runtime) return
    clearInterval(runtime.flushTimer)
    runtime.provider.stop()
    this.runtimes.delete(accountId)
    this.store.updateRuntime(accountId, { connectionState: 'idle' })
  }

  private async deliver(provider: FeishuProvider, accountId: string, item: ChannelOutboxItem): Promise<{ remoteMessageId?: string }> {
    try {
      const payload = record(item.payload) as DeliveryPayload
      const uuid = stableUuid(item.dedupeKey)
      let remoteMessageId = ''
      if (item.kind === 'send_text') remoteMessageId = await provider.sendText(item.targetId, payload.text ?? '', uuid)
      else if (item.kind === 'reply_text') remoteMessageId = await provider.replyText(item.targetId, payload.text ?? '', Boolean(payload.replyInThread), uuid)
      else if (item.kind === 'send_card') remoteMessageId = await provider.sendCard(item.targetId, payload.card ?? {}, uuid)
      else if (item.kind === 'reply_card') remoteMessageId = await provider.replyCard(item.targetId, payload.card ?? {}, Boolean(payload.replyInThread), uuid)
      else if (item.kind === 'send_user_card') remoteMessageId = await provider.sendUserCard(item.targetId, payload.card ?? {}, uuid)
      else if (item.kind === 'update_card') await provider.updateCard(item.targetId, payload.card ?? {})
      else if (item.kind === 'send_image') remoteMessageId = await provider.sendImage(item.targetId, payload.imageKey ?? '', uuid)
      else if (item.kind === 'send_local_image') {
        const path = payload.path ?? ''
        const root = payload.root ?? ''
        if (!await this.isAllowedChannelImage(path, root)) throw new Error('Channel image is outside the bound Demand or uses an unsupported format')
        const imageKey = await provider.uploadImage(await readFile(path))
        remoteMessageId = payload.replyMessageId
          ? await provider.replyImage(payload.replyMessageId, imageKey, payload.replyInThread === true, uuid)
          : await provider.sendImage(item.targetId, imageKey, uuid)
      }
      else if (item.kind === 'reply_image') remoteMessageId = await provider.replyImage(item.targetId, payload.imageKey ?? '', Boolean(payload.replyInThread), uuid)
      else throw new Error(`Unsupported Feishu delivery kind: ${item.kind}`)
      this.store.updateRuntime(accountId, { delivery: true })
      this.auditDelivery('channel.outbox.delivered', item, true)
      return remoteMessageId ? { remoteMessageId } : {}
    } catch (error) {
      this.auditDelivery('channel.outbox.delivery_failed', item, false, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  private async enqueue(accountId: string, input: Parameters<ReliableChannelOutbox['enqueue']>[0]): Promise<ChannelOutboxItem> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) throw new Error('飞书机器人当前未连接')
    const item = await runtime.outbox.enqueue(input)
    await runtime.outbox.flush()
    return this.store.getOutbox(item.id)
  }

  private allowed(account: ChannelAccount, message: ChannelInboundMessage, binding: CodyWorkChannelBinding | null): { allowed: boolean; reason: string } {
    if (message.sender.type !== 'user') return { allowed: false, reason: 'non_user' }
    if (!message.sender.id) return { allowed: false, reason: 'missing_sender' }
    if (!account.allowAllUsers && !account.allowedUserIds.includes(message.sender.id)) return { allowed: false, reason: 'sender_denied' }
    if (message.conversation.scope !== 'private' && !account.allowedConversationIds.includes(message.conversation.id)) return { allowed: false, reason: 'conversation_denied' }
    if (message.mentionsOtherRecipient && !message.addressedToAgent) return { allowed: false, reason: 'addressed_elsewhere' }
    if (message.conversation.scope !== 'private' && account.groupMentionMode === 'always' && !message.addressedToAgent) return { allowed: false, reason: 'mention_required' }
    if (message.conversation.scope !== 'private' && account.groupMentionMode === 'bound' && !binding && !message.addressedToAgent) return { allowed: false, reason: 'mention_required' }
    return { allowed: true, reason: '' }
  }

  private async onMessage(message: ChannelInboundMessage): Promise<void> {
    const claimed = this.store.claimInbound(message)
    if (!claimed.created) return
    const command = message.text.trim()
    try {
      const account = this.store.listAccounts().find(item => item.id === message.accountId)
      if (!account?.enabled) return void this.store.updateInbox(claimed.item.id, 'ignored', { lastError: 'account_disabled' })
      this.store.updateRuntime(account.id, { connectionState: this.runtimes.get(account.id)?.provider.getState() ?? 'failed', event: true })
      const key = channelConversationKey(message)
      const binding = this.store.findBinding(account.id, key)
      const decision = this.allowed(account, message, binding)
      if (!decision.allowed) {
        this.store.updateInbox(claimed.item.id, 'ignored', { lastError: decision.reason })
        this.store.audit(account.id, 'channel.inbound.ignored', 'channel_inbox', claimed.item.id, true, {
          provider: message.provider, accountId: message.accountId, eventId: message.eventId, messageId: message.messageId,
          conversationKey: key, inboxId: claimed.item.id, ...(binding ? { bindingId: binding.id, threadId: binding.threadId } : {}), reason: decision.reason,
        })
        return
      }
      if (binding && command.startsWith('/')) return void await this.handleCommand(binding, claimed.item.id, command)
      if (!binding) return void await this.requestWorkspace(claimed.item.id)
      this.store.updateInbox(claimed.item.id, 'ready', { bindingId: binding.id })
      await this.submitInbox(claimed.item.id, binding)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.store.updateInbox(claimed.item.id, 'failed', { lastError: detail })
      this.store.audit(message.accountId, 'channel.inbound.failed', 'channel_inbox', claimed.item.id, false, {
        provider: message.provider, accountId: message.accountId, eventId: message.eventId, messageId: message.messageId,
        conversationKey: claimed.item.conversationKey, inboxId: claimed.item.id, command: command.startsWith('/'),
      }, detail)
      if (command.startsWith('/')) {
        await this.enqueue(message.accountId, {
          kind: 'reply_text', targetId: message.messageId,
          payload: { text: `命令执行失败：${detail}` }, dedupeKey: `${claimed.item.id}:command-error`, terminal: true,
        }).catch(replyError => this.failAccount(message.accountId, 'channel.command.error_reply', replyError))
      }
    }
  }

  private async requestWorkspace(inboxId: string): Promise<void> {
    const inbox = this.store.updateInbox(inboxId, 'waiting_binding')
    const choices = this.workspaces.list()
    const card = selectionCard('绑定 CodyWork Workspace', '首次使用需要选择消息要进入的 Workspace。原消息已保留，完成绑定后会自动提交。', choices.map(workspace => ({
      text: workspace.name, value: { action: 'channel.pick_workspace', inboxId, workspaceId: workspace.id },
    })))
    await this.enqueue(inbox.message.accountId, {
      kind: 'reply_card', targetId: inbox.message.messageId, payload: { card, replyInThread: inbox.message.conversation.scope === 'topic' }, dedupeKey: `${inbox.id}:pick-workspace`, terminal: true,
    })
  }

  private async onAction(accountId: string, action: FeishuCardAction): Promise<unknown> {
    const kind = string(action.value.action)
    const eventId = action.eventId || createHash('sha256')
      .update([accountId, action.remoteMessageId, action.actorId, kind, JSON.stringify(action.value)].join('\u0000'))
      .digest('hex')
    const claim = this.store.claimAction(accountId, eventId, {
      kind, actorId: action.actorId, remoteMessageId: action.remoteMessageId, value: action.value,
    })
    if (!claim.created) {
      return { toast: { type: claim.status === 'action_failed' ? 'error' : 'success', content: claim.status === 'action_failed' ? '该操作此前执行失败，请重新点击后再试' : '该操作已经处理' } }
    }
    try {
      let card: FeishuCard | null = null
      if (kind.startsWith('channel.pick_')) card = await this.handleBindingAction(accountId, action)
      else if (kind === 'channel.approval') await this.handleApprovalAction(accountId, action)
      else if (kind === 'channel.question') await this.handleQuestionAction(accountId, action)
      else if (kind === 'channel.retry_outbox') this.retryOutbox(accountId, string(action.value.outboxId))
      else throw new Error('未知或已过期的操作')
      this.store.finishAction(claim.id, 'action_completed')
      // Returning the next card in the callback is the only reliable way to
      // advance select menus in every Feishu client. The durable Outbox patch
      // remains the recovery path for reconnects and other devices.
      return card ? { card: { type: 'raw', data: card } } : { toast: { type: 'success', content: '已处理' } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.finishAction(claim.id, 'action_failed', message)
      this.store.audit(accountId, 'channel.action.failed', 'feishu_action', action.eventId, false, { action: kind }, message)
      return { toast: { type: 'error', content: message.slice(0, 100) } }
    }
  }

  private assertActionOwner(inboxId: string, actorId: string): ReturnType<ChannelStore['getInbox']> {
    const inbox = this.store.getInbox(inboxId)
    if (inbox.message.sender.id !== actorId) throw new Error('只有发起人可以完成这次绑定')
    return inbox
  }

  private async handleBindingAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const inboxId = string(action.value.inboxId)
    const inbox = this.assertActionOwner(inboxId, action.actorId)
    if (inbox.message.accountId !== accountId || inbox.status !== 'waiting_binding') throw new Error('绑定请求已失效')
    const kind = string(action.value.action)
    if (kind === 'channel.pick_workspace') {
      const workspaceId = string(action.value.workspaceId)
      const workspace = this.workspaces.get(workspaceId)
      const demands = listDemands(this.database, workspace)
      const card = selectionCard('选择 CodyWork 需求', `Workspace：**${workspace.name}**`, demands.map(demand => ({
        text: demand.name, value: { action: 'channel.pick_demand', inboxId, workspaceId, demandId: demand.id },
      })))
      await this.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card }, dedupeKey: `${inbox.id}:pick-demand:${workspaceId}`, revision: 1 })
      return card
    }
    const workspaceId = string(action.value.workspaceId)
    const demandId = string(action.value.demandId)
    if (kind === 'channel.pick_demand') {
      const workspace = this.workspaces.get(workspaceId)
      const demand = listDemands(this.database, workspace).find(item => item.id === demandId)
      if (!demand) throw new Error('需求不存在')
      const sessions = this.conversations.list(workspaceId, demandId)
      const actions = sessions.map(session => ({ text: session.title, value: { action: 'channel.pick_session', inboxId, workspaceId, demandId, conversationId: session.id } }))
      actions.unshift({ text: '+ 新建会话', value: { action: 'channel.pick_new_session', inboxId, workspaceId, demandId, conversationId: '' } })
      const card = selectionCard('选择 CodyWork 会话', `需求：**${demand.name}**\n\n飞书与浏览器将共享同一个原生 Codex Thread。`, actions)
      await this.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card }, dedupeKey: `${inbox.id}:pick-session:${demandId}`, revision: 2 })
      return card
    }
    if (kind !== 'channel.pick_session' && kind !== 'channel.pick_new_session') throw new Error('未知绑定步骤')
    const isNewSession = kind === 'channel.pick_new_session'
    const conversation = isNewSession
      ? await this.conversations.create(workspaceId, demandId, '飞书会话')
      : this.conversations.get(workspaceId, string(action.value.conversationId))
    const binding = this.store.createBinding({
      message: inbox.message, workspaceId, demandId, conversationId: conversation.id, threadId: conversation.nativeId, ownerIdentity: inbox.message.sender.id,
    })
    this.store.updateInbox(inbox.id, 'ready', { bindingId: binding.id })
    // A thread created by this callback is known to have no history.  Do not
    // immediately read it back: older Codex App Servers cannot list turns for
    // a brand-new empty thread and would otherwise leave a durable binding in
    // place while the Feishu card reports a failed action.
    await this.observe(binding, { emptyHistory: isNewSession })
    const openUrl = this.openUrl(binding)
    const card = feishuTextCard('CodyWork 已绑定', `已绑定到 **${conversation.title}**。接下来在本对话发送的消息会进入同一个 Codex Thread。`, {
      color: 'green', ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
    })
    await this.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card }, dedupeKey: `${inbox.id}:bound`, revision: 3, terminal: true })
    this.store.audit(accountId, 'channel.binding.created', 'channel_binding', binding.id, true, {
      provider: inbox.message.provider, accountId, eventId: inbox.message.eventId, messageId: inbox.message.messageId,
      conversationKey: inbox.conversationKey, bindingId: binding.id, threadId: binding.threadId, inboxId: inbox.id,
    })
    await this.submitInbox(inbox.id, binding)
    return card
  }

  private async submitInbox(inboxId: string, binding: CodyWorkChannelBinding): Promise<void> {
    const inbox = this.store.getInbox(inboxId)
    if (inbox.status !== 'ready' && inbox.status !== 'received') return
    const runtime = this.runtimes.get(inbox.message.accountId)
    if (!runtime) throw new Error('飞书机器人当前未连接')
    const localImages: Array<{ path: string }> = []
    const paths: string[] = []
    const channelMessage = inbox.message as CodyWorkInboundMessage
    const sourceMessageId = channelMessage.sourceMessageId || inbox.message.messageId
    const replyMessageId = channelMessage.replyMessageId || inbox.message.messageId
    if (inbox.message.attachments.length) {
      const workspace = this.workspaces.get(binding.workspaceId)
      const demand = listDemands(this.database, workspace).find(item => item.id === binding.demandId)
      if (!demand) throw new Error('绑定的需求不存在')
      const root = resolve(demand.path, 'docs', '.channel-attachments', sourceMessageId)
      for (const attachment of inbox.message.attachments) {
        const downloaded = await runtime.provider.downloadAttachment(sourceMessageId, attachment, root)
        if (attachment.type === 'image') localImages.push({ path: downloaded.path })
        else paths.push(downloaded.path)
      }
    }
    const prompt = [inbox.message.text, paths.length ? `\n附件路径：\n${paths.map(path => `- ${path}`).join('\n')}` : ''].join('').trim()
    const commandId = channelCommandId(inbox.message)
    const turnLinkId = this.store.createTurnLink({ inboxId, bindingId: binding.id, clientCommandId: commandId })
    const presentation = this.store.createPresentation({ accountId: inbox.message.accountId, bindingId: binding.id, turnLinkId, purpose: 'turn', state: { prompt } })
    this.store.updateInbox(inboxId, 'submitting', { bindingId: binding.id, clientCommandId: commandId })
    await this.observe(binding)
    const initial = projectionCard({ threadId: binding.threadId, turnId: '', status: 'queued', assistantText: '', assistantImages: [], error: '', terminal: false, revision: 0 }, prompt, this.openUrl(binding))
    const sent = await this.enqueue(inbox.message.accountId, {
      kind: 'reply_card', targetId: replyMessageId, payload: { card: initial, replyInThread: inbox.message.conversation.scope === 'topic' }, dedupeKey: `${inbox.id}:turn-card`, revision: 0,
    })
    this.store.updatePresentation(presentation.id, { remoteMessageId: sent.remoteMessageId, status: sent.status, state: { prompt, outboxId: sent.id } })
    try {
      await this.conversations.send(binding.workspaceId, binding.conversationId, prompt, 'queue', undefined, commandId, localImages)
      this.store.updateInbox(inboxId, 'submitted', { clientCommandId: commandId })
      this.store.updateTurnLink(commandId, { status: 'submitted' })
      this.store.audit(binding.accountId, 'channel.inbound.submitted', 'channel_inbox', inbox.id, true, {
        provider: inbox.message.provider, accountId: binding.accountId, eventId: inbox.message.eventId, messageId: inbox.message.messageId,
        conversationKey: inbox.conversationKey, bindingId: binding.id, threadId: binding.threadId, inboxId: inbox.id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.updateInbox(inboxId, 'failed', { lastError: message })
      this.store.updateTurnLink(commandId, { status: 'failed' })
      await this.renderCommandFailure(turnLinkId, message)
      throw error
    }
  }

  private async observe(binding: CodyWorkChannelBinding, options: { emptyHistory?: boolean } = {}): Promise<void> {
    const existing = this.observed.get(binding.conversationId)
    if (existing) { existing.bindingIds.add(binding.id); return }
    const pending = this.observationInitializations.get(binding.conversationId)
    if (pending) {
      await pending
      this.observed.get(binding.conversationId)?.bindingIds.add(binding.id)
      return
    }
    const initialization = this.initializeObservation(binding, options)
    this.observationInitializations.set(binding.conversationId, initialization)
    try {
      await initialization
    } finally {
      if (this.observationInitializations.get(binding.conversationId) === initialization) this.observationInitializations.delete(binding.conversationId)
    }
  }

  private async initializeObservation(binding: CodyWorkChannelBinding, options: { emptyHistory?: boolean } = {}): Promise<void> {
    try {
      const snapshot = options.emptyHistory
        ? { events: [] as ConversationEvent[], watermark: 0 }
        : await this.conversations.history(binding.workspaceId, binding.conversationId)
      const state = reduceConversationEvents(createConversationState(binding.threadId), snapshot.events)
      const observation: ObservedConversation = { state, bindingIds: new Set([binding.id]) }
      this.observed.set(binding.conversationId, observation)
      const buffered = this.pendingConversationEvents.get(binding.conversationId) ?? []
      this.pendingConversationEvents.delete(binding.conversationId)
      for (const turn of Object.values(state.turns)) {
        if (turn.lifecycle === 'completed' || turn.lifecycle === 'failed' || turn.lifecycle === 'interrupted') {
          this.expireTurnRequests(binding.conversationId, turn.id, `turn.${turn.lifecycle}` as ConversationEvent['type'])
        }
      }
      const snapshotEventIds = new Set(snapshot.events.map(event => event.id))
      const pendingRequestIds = new Set(state.pendingRequests.map(request => request.id))
      for (const event of snapshot.events) {
        if (event.type !== 'approval.requested' && event.type !== 'question.requested') continue
        const requestId = string(event.data.requestId ?? event.data.approvalId ?? event.id)
        if (pendingRequestIds.has(requestId)) this.publishRequestEvent(binding.conversationId, event, observation)
      }
      for (const event of buffered) {
        const ownerRevision = typeof event.ownerRevision === 'number' ? event.ownerRevision : null
        if (ownerRevision !== null ? ownerRevision <= snapshot.watermark : snapshotEventIds.has(event.id)) continue
        this.onConversationEventSafely(binding.conversationId, event)
      }
    } catch (error) {
      throw error
    }
  }

  private receiveConversationEvent(event: ConversationEvent): void {
    if (this.observed.has(event.conversationId)) {
      this.onConversationEventSafely(event.conversationId, event)
      return
    }
    if (!this.observationInitializations.has(event.conversationId) && !this.store.hasBindingForConversation(event.conversationId)) return
    const buffered = this.pendingConversationEvents.get(event.conversationId) ?? []
    buffered.push(event)
    // The snapshot will reconcile old history. Keep only a bounded tail to
    // prevent a broken binding recovery from becoming an unbounded queue.
    if (buffered.length > 2_000) buffered.splice(0, buffered.length - 2_000)
    this.pendingConversationEvents.set(event.conversationId, buffered)
  }

  private onConversationEventSafely(conversationId: string, event: ConversationEvent): void {
    try {
      this.onConversationEvent(conversationId, event)
    } catch (error) {
      const observation = this.observed.get(conversationId)
      const accountIds = new Set<string>()
      for (const bindingId of observation?.bindingIds ?? []) {
        try { accountIds.add(this.store.getBinding(bindingId).accountId) } catch { observation?.bindingIds.delete(bindingId) }
      }
      for (const accountId of accountIds) {
        try { this.failAccount(accountId, 'channel.conversation_event', error) } catch { /* never break the owner Runtime listener */ }
      }
    }
  }

  private onConversationEvent(conversationId: string, event: ConversationEvent): void {
    const observation = this.observed.get(conversationId)
    if (!observation) return
    observation.state = reduceConversationEvent(observation.state, event)
    if (event.type === 'command.bound' && event.itemId && event.turnId) {
      const link = this.store.getTurnLinkByCommand(event.itemId)
      if (link) {
        this.store.updateTurnLink(link.clientCommandId, { turnId: event.turnId, status: 'running' })
        this.store.updateInbox(link.inboxId, 'submitted', { turnId: event.turnId })
        const binding = this.store.getBinding(link.bindingId)
        const inbox = this.store.getInbox(link.inboxId)
        this.store.audit(binding.accountId, 'channel.turn.bound', 'channel_turn_link', link.id, true, {
          provider: inbox.message.provider, accountId: binding.accountId, eventId: inbox.message.eventId, messageId: inbox.message.messageId,
          conversationKey: inbox.conversationKey, bindingId: binding.id, threadId: binding.threadId, turnId: event.turnId,
          inboxId: inbox.id,
        })
      }
    }
    if (event.type === 'command.failed' && event.itemId) {
      const link = this.store.getTurnLinkByCommand(event.itemId)
      if (link) {
        const error = string(event.data.error || event.data.message) || 'Codex 未接受这条消息。'
        this.store.updateTurnLink(link.clientCommandId, { status: 'failed' })
        this.store.updateInbox(link.inboxId, 'failed', { lastError: error })
        void this.renderCommandFailure(link.id, error).catch(renderError => {
          const binding = this.bindingOrDetach(observation, link.bindingId)
          if (binding) this.failAccount(binding.accountId, 'channel.command_failure.render', renderError)
        })
      }
    }
    const sourceLink = event.turnId ? this.store.getTurnLinkByConversationTurn(conversationId, event.turnId) : null
    const sourceBinding = sourceLink ? this.bindingOrDetach(observation, sourceLink.bindingId) : null
    if (event.type === 'approval.requested' || event.type === 'question.requested') {
      this.publishRequestEvent(conversationId, event, observation, sourceBinding)
    }
    if (event.type === 'approval.resolved' || event.type === 'question.resolved') {
      const requestId = string(event.data.requestId ?? event.data.approvalId)
      const requests = requestId ? this.store.listInteractiveRequestsByConversation(conversationId, requestId, event.turnId ?? '') : []
      for (const request of requests) {
        const requestBinding = this.bindingOrDetach(observation, request.bindingId)
        if (requestBinding) void this.resolveRequest(requestBinding, event, request).catch(error => this.failAccount(requestBinding.accountId, 'channel.request.resolve', error))
      }
    }
    if (event.turnId && (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.interrupted' || event.type === 'turn.disconnected')) {
      this.expireTurnRequests(conversationId, event.turnId, event.type)
    }
    for (const bindingId of [...observation.bindingIds]) {
      const binding = this.bindingOrDetach(observation, bindingId)
      if (!binding) continue
      if (event.turnId) this.scheduleRender(binding, event.turnId, event.type.startsWith('turn.') && ['turn.completed', 'turn.failed', 'turn.interrupted', 'turn.disconnected'].includes(event.type))
    }
    if (observation.bindingIds.size === 0) {
      this.observed.delete(conversationId)
    }
  }

  private publishRequestEvent(
    conversationId: string,
    event: ConversationEvent,
    observation: ObservedConversation,
    knownSourceBinding?: CodyWorkChannelBinding | null,
  ): void {
    const sourceLink = event.turnId ? this.store.getTurnLinkByConversationTurn(conversationId, event.turnId) : null
    const sourceBinding = knownSourceBinding === undefined
      ? (sourceLink ? this.bindingOrDetach(observation, sourceLink.bindingId) : null)
      : knownSourceBinding
    // A channel-originated Turn replies only to its source binding. A Turn
    // started in the browser has no source link, so bridge the request to one
    // binding per connected account. This keeps Web and Feishu resolution
    // symmetric without duplicating cards when one account has several chats
    // bound to the same native Thread.
    const requestBindings = sourceBinding
      ? [sourceBinding]
      : [...observation.bindingIds].reduce<CodyWorkChannelBinding[]>((rows, bindingId) => {
          const binding = this.bindingOrDetach(observation, bindingId)
          if (binding && !rows.some(row => row.accountId === binding.accountId)) rows.push(binding)
          return rows
        }, [])
    for (const binding of requestBindings) {
      void this.publishRequest(binding, event).catch(error => this.failAccount(binding.accountId, 'channel.request.publish', error))
    }
  }

  private bindingOrDetach(observation: ObservedConversation, bindingId: string): CodyWorkChannelBinding | null {
    try { return this.store.getBinding(bindingId) } catch {
      observation.bindingIds.delete(bindingId)
      return null
    }
  }

  private detachBindingObservation(binding: CodyWorkChannelBinding): void {
    const observation = this.observed.get(binding.conversationId)
    if (!observation) return
    observation.bindingIds.delete(binding.id)
    if (observation.bindingIds.size > 0) return
    this.observed.delete(binding.conversationId)
    this.pendingConversationEvents.delete(binding.conversationId)
  }

  private detachAccountObservations(accountId: string): void {
    for (const binding of this.store.listBindings(accountId)) this.detachBindingObservation(binding)
  }

  private scheduleRender(binding: CodyWorkChannelBinding, turnId: string, immediate = false): void {
    const key = `${binding.id}:${turnId}`
    const previous = this.renderTimers.get(key)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.renderTimers.delete(key)
      void this.render(binding, turnId).catch(error => this.failAccount(binding.accountId, 'channel.render', error))
    }, immediate ? 0 : PROJECTION_THROTTLE_MS)
    this.renderTimers.set(key, timer)
  }

  private async render(binding: CodyWorkChannelBinding, turnId: string): Promise<void> {
    if (!turnId) return
    const observation = this.observed.get(binding.conversationId)
    const link = this.store.getTurnLinkByTurn(binding.id, turnId)
    if (!observation || !link) return
    const presentation = this.findTurnPresentation(link.id)
    if (!presentation) return
    const projection = projectChannelTurn(observation.state, turnId, presentation.revision + 1)
    const prompt = string(presentation.state.prompt)
    const card = projectionCard(projection, prompt, this.openUrl(binding))
    let remoteMessageId = presentation.remoteMessageId
    if (!remoteMessageId) {
      const outboxId = string(presentation.state.outboxId)
      if (outboxId) remoteMessageId = this.store.getOutbox(outboxId).remoteMessageId ?? ''
    }
    if (!remoteMessageId) {
      this.store.updatePresentation(presentation.id, { revision: projection.revision, state: { ...presentation.state, pendingCard: card, projection } })
      return
    }
    await this.enqueue(binding.accountId, {
      kind: 'update_card', targetId: remoteMessageId, payload: { card }, dedupeKey: `${presentation.id}:revision:${projection.revision}`,
      revision: projection.revision, terminal: projection.terminal,
    })
    this.store.updatePresentation(presentation.id, { remoteMessageId, status: projection.status, revision: projection.revision, terminal: projection.terminal, state: { ...presentation.state, projection } })
    if (projection.terminal) {
      const inboxStatus = projection.status === 'completed' ? 'completed' : 'failed'
      this.store.updateInbox(link.inboxId, inboxStatus, { turnId, lastError: projection.error || null })
      this.store.updateTurnLink(link.clientCommandId, { turnId, status: projection.status })
      if (projection.status === 'completed') await this.publishAssistantImages(binding, projection, presentation, link.inboxId)
    }
  }

  private async renderCommandFailure(turnLinkId: string, error: string): Promise<void> {
    const presentation = this.findTurnPresentation(turnLinkId)
    if (!presentation) return
    let openUrl = ''
    try { openUrl = this.openUrl(this.store.getBinding(presentation.bindingId)) } catch { /* a removed binding has no valid deep link */ }
    const card = feishuTextCard('CodyWork · 提交失败', `**${error}**\n\n消息未被静默重发。请发送 \`/retry\` 明确重试。`, {
      color: 'red', ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
    })
    let remoteMessageId = presentation.remoteMessageId
    if (!remoteMessageId) {
      const outboxId = string(presentation.state.outboxId)
      if (outboxId) remoteMessageId = this.store.getOutbox(outboxId).remoteMessageId ?? ''
    }
    if (!remoteMessageId) {
      this.store.updatePresentation(presentation.id, { status: 'pending_failure', state: { ...presentation.state, pendingFailureCard: card, error } })
      return
    }
    await this.enqueue(presentation.accountId, { kind: 'update_card', targetId: remoteMessageId, payload: { card }, dedupeKey: `${presentation.id}:command-failed`, terminal: true })
    this.store.updatePresentation(presentation.id, { remoteMessageId, status: 'failed', terminal: true, state: { ...presentation.state, error } })
  }

  private findTurnPresentation(turnLinkId: string): ChannelPresentation | null {
    const row = this.database.db
      .prepare('SELECT id FROM channel_presentations WHERE turn_link_id = ? AND purpose = \'turn\' ORDER BY created_at DESC LIMIT 1').get(turnLinkId)
    const typed = row as { id?: string } | undefined
    return typed?.id ? this.store.getPresentation(typed.id) : null
  }

  private async publishAssistantImages(
    binding: CodyWorkChannelBinding,
    projection: ReturnType<typeof projectChannelTurn>,
    presentation: ChannelPresentation,
    inboxId: string,
  ): Promise<void> {
    const workspace = this.workspaces.get(binding.workspaceId)
    const demand = listDemands(this.database, workspace).find(item => item.id === binding.demandId)
    if (!demand) return
    const root = await realpath(demand.path).catch(() => '')
    if (!root) return
    const inbox = this.store.getInbox(inboxId)
    const source = inbox.message as CodyWorkInboundMessage
    const replyMessageId = source.replyMessageId || inbox.message.messageId
    const paths = await this.channelImagePaths(root, projection.assistantImages)
    for (const [index, path] of paths.entries()) {
      await this.enqueue(binding.accountId, {
        kind: 'send_local_image',
        targetId: binding.channelConversationId,
        payload: {
          path,
          root,
          ...(inbox.message.conversation.scope === 'topic' ? { replyMessageId, replyInThread: true } : {}),
        },
        dedupeKey: `${presentation.id}:image:${index}`,
        terminal: true,
      })
    }
  }

  private async channelImagePaths(root: string, candidates: string[]): Promise<string[]> {
    const paths: string[] = []
    for (const candidate of [...new Set(candidates)]) {
      if (!isAbsolute(candidate) || !FEISHU_IMAGE_EXTENSIONS.has(extname(candidate).toLowerCase())) continue
      const path = await realpath(candidate).catch(() => '')
      if (!path || !await this.isAllowedChannelImage(path, root)) continue
      paths.push(path)
    }
    return paths
  }

  private async isAllowedChannelImage(path: string, root: string): Promise<boolean> {
    if (!isAbsolute(path) || !isAbsolute(root) || !FEISHU_IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return false
    const [realRoot, realPath] = await Promise.all([realpath(root).catch(() => ''), realpath(path).catch(() => '')])
    if (!realRoot || !realPath) return false
    const inside = relative(realRoot, realPath)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) return false
    return stat(realPath).then(metadata => metadata.isFile() && metadata.size > 0 && metadata.size <= 10 * 1024 * 1024).catch(() => false)
  }

  private async publishRequest(binding: CodyWorkChannelBinding, event: ConversationEvent): Promise<void> {
    const requestId = string(event.data.requestId ?? event.data.approvalId ?? event.id)
    const kind = event.type === 'approval.requested' ? 'approval' : 'question'
    const requestKey = [binding.id, event.threadId, event.turnId ?? 'no-turn', kind, requestId].join(':')
    const request = this.store.saveInteractiveRequest({
      accountId: binding.accountId, bindingId: binding.id, requestKey, requestId, turnId: event.turnId ?? '', kind,
      requesterIdentity: binding.ownerIdentity,
      // Resolution needs only native identity; never persist raw params because
      // command approvals may carry inherited environment variables.
      request: { method: string(event.data.method) },
    })
    if (request.status !== 'pending' || request.remoteMessageId) return
    const method = string(event.data.method) || (kind === 'approval' ? '工具调用' : '需要输入')
    const actions: FeishuCardButton[] = kind === 'approval'
      ? [
          { text: '允许一次', value: { action: 'channel.approval', interactiveRequestId: request.id, requestId, outcome: 'allowed-once' }, type: 'primary' as const },
          { text: '拒绝', value: { action: 'channel.approval', interactiveRequestId: request.id, requestId, outcome: 'rejected' }, type: 'danger' as const },
        ]
      : this.questionActions(request.id, requestId, event.data)
    const openUrl = this.openUrl(binding)
    if (openUrl) actions.push({ text: '在 CodyWork 中打开', url: openUrl })
    const card = feishuTextCard(
      kind === 'approval' ? 'CodyWork 请求审批' : 'CodyWork 等待回答',
      interactiveRequestSummary(kind, method, event.data),
      { color: 'orange', actions, note: kind === 'question' && !actions.length ? `请回复：/answer ${requestId} <答案>` : undefined },
    )
    const sent = await this.enqueue(binding.accountId, { kind: 'send_user_card', targetId: binding.ownerIdentity, payload: { card }, dedupeKey: `request:${request.id}` })
    if (sent.remoteMessageId) this.store.updateInteractiveRequest(binding.accountId, request.id, { status: 'pending', remoteMessageId: sent.remoteMessageId })
  }

  private questionActions(interactiveRequestId: string, requestId: string, data: Record<string, unknown>): Array<{ text: string; value: Record<string, unknown>; type?: 'primary' }> {
    const params = record(data.params)
    const questions = Array.isArray(params.questions) ? params.questions : []
    const first = record(questions[0])
    const options = Array.isArray(first.options) ? first.options : Array.isArray(params.options) ? params.options : []
    const questionId = string(first.id || first.questionId || params.questionId)
    return options.slice(0, 8).flatMap(option => {
      const row = record(option); const label = string(row.label || row.text || option)
      return label ? [{ text: label, value: { action: 'channel.question', interactiveRequestId, requestId, questionId, answer: label }, type: 'primary' as const }] : []
    })
  }

  private async handleApprovalAction(accountId: string, action: FeishuCardAction): Promise<void> {
    const requestId = string(action.value.requestId)
    const interactiveRequestId = string(action.value.interactiveRequestId)
    const request = interactiveRequestId
      ? this.store.getInteractiveRequestById(accountId, interactiveRequestId)
      : this.store.getInteractiveRequest(accountId, requestId)
    if (request.status !== 'pending') throw new Error('审批已经处理')
    if (request.requesterIdentity !== action.actorId) throw new Error('只有绑定人可以处理审批')
    const binding = this.store.getBinding(request.bindingId)
    const outcome = action.value.outcome === 'rejected' ? 'rejected' : 'allowed-once'
    await this.conversations.approve(binding.workspaceId, binding.conversationId, requestId, outcome)
    this.store.updateInteractiveRequest(accountId, request.id, { status: outcome })
    if (action.remoteMessageId) await this.enqueue(accountId, { kind: 'update_card', targetId: action.remoteMessageId, payload: { card: feishuTextCard('审批已处理', outcome === 'allowed-once' ? '已允许一次。' : '已拒绝。', { color: outcome === 'allowed-once' ? 'green' : 'red' }) }, dedupeKey: `request:${request.id}:resolved`, terminal: true })
  }

  private async handleQuestionAction(accountId: string, action: FeishuCardAction): Promise<void> {
    const requestId = string(action.value.requestId)
    const interactiveRequestId = string(action.value.interactiveRequestId)
    const request = interactiveRequestId
      ? this.store.getInteractiveRequestById(accountId, interactiveRequestId)
      : this.store.getInteractiveRequest(accountId, requestId)
    if (request.status !== 'pending') throw new Error('问题已经回答')
    if (request.requesterIdentity !== action.actorId) throw new Error('只有绑定人可以回答')
    const binding = this.store.getBinding(request.bindingId)
    const questionId = string(action.value.questionId)
    const answer = string(action.value.answer || action.option)
    await this.conversations.answer(binding.workspaceId, binding.conversationId, requestId, questionId ? { answers: { [questionId]: { answers: [answer] } } } : answer)
    this.store.updateInteractiveRequest(accountId, request.id, { status: 'answered' })
  }

  private async resolveRequest(binding: CodyWorkChannelBinding, event: ConversationEvent, knownRequest?: ChannelInteractiveRequest): Promise<void> {
    const requestId = string(event.data.requestId ?? event.data.approvalId)
    if (!requestId) return
    try {
      const request = knownRequest ?? this.store.getInteractiveRequest(binding.accountId, requestId)
      if (request.status !== 'pending') return
      this.store.updateInteractiveRequest(binding.accountId, request.id, { status: 'resolved' })
      if (request.remoteMessageId) {
        await this.enqueue(binding.accountId, { kind: 'update_card', targetId: request.remoteMessageId, payload: { card: feishuTextCard('CodyWork 请求已处理', '该请求已在 CodyWork 浏览器或飞书端完成。', { color: 'green' }) }, dedupeKey: `request:${request.id}:externally-resolved`, terminal: true })
      }
    } catch { /* browser may have resolved a request not mirrored to Feishu */ }
  }

  private expireTurnRequests(conversationId: string, turnId: string, terminalType: ConversationEvent['type']): void {
    const requests = this.store.listPendingInteractiveRequestsForTurn(conversationId, turnId)
    const message = terminalType === 'turn.interrupted'
      ? '对应回复已停止，不能再处理这项请求。'
      : terminalType === 'turn.completed'
        ? '对应回复已经结束，这项请求已失效。'
        : '对应回复未能继续，这项请求已失效。'
    for (const request of requests) {
      this.store.updateInteractiveRequest(request.accountId, request.id, { status: 'expired' })
      if (!request.remoteMessageId) continue
      void this.enqueue(request.accountId, {
        kind: 'update_card',
        targetId: request.remoteMessageId,
        payload: { card: feishuTextCard('CodyWork 请求已结束', message, { color: terminalType === 'turn.interrupted' ? 'grey' : 'red' }) },
        dedupeKey: `request:${request.id}:terminal:${terminalType}`,
        terminal: true,
      }).catch(error => this.failAccount(request.accountId, 'channel.request.expire', error))
    }
  }

  private async handleCommand(binding: CodyWorkChannelBinding, inboxId: string, command: string): Promise<void> {
    const inbox = this.store.getInbox(inboxId)
    const [name, ...args] = command.split(/\s+/u)
    if (name === '/status') {
      const conversation = this.conversations.get(binding.workspaceId, binding.conversationId)
      const openUrl = this.openUrl(binding)
      await this.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text: `已绑定：${conversation.title}\nThread：${binding.threadId}\n连接：${this.runtimes.get(binding.accountId)?.provider.getState() ?? 'offline'}${openUrl ? `\n在 CodyWork 中打开：${openUrl}` : ''}` }, dedupeKey: `${inbox.id}:status`, terminal: true })
      this.store.updateInbox(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/unbind') {
      this.detachBindingObservation(binding)
      this.store.deleteBinding(binding.accountId, inbox.conversationKey)
      await this.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text: '已解除 CodyWork 绑定。下一条消息会重新选择 Workspace、需求和会话。' }, dedupeKey: `${inbox.id}:unbind`, terminal: true })
      this.store.updateInbox(inbox.id, 'completed'); return
    }
    if (name === '/stop') {
      const result = await this.conversations.interrupt(binding.workspaceId, binding.conversationId)
      const text = result.supported ? '已请求停止当前回复。' : '当前没有正在执行、可停止的回复。'
      await this.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text }, dedupeKey: `${inbox.id}:stop`, terminal: true })
      this.store.updateInbox(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/retry') {
      const failed = this.store.latestFailedInbox(binding.accountId, inbox.conversationKey)
      if (!failed) throw new Error('没有可重试的失败消息')
      // A retry is a new explicit command. Reusing the retained payload without
      // a new event id would collide with the original idempotency key.
      const failedMessage = failed.message as CodyWorkInboundMessage
      const retried: CodyWorkInboundMessage = {
        ...failed.message,
        eventId: `${failed.message.eventId}:retry:${inbox.id}`,
        messageId: `${failed.message.messageId}:retry:${inbox.id}`,
        sourceMessageId: failedMessage.sourceMessageId || failed.message.messageId,
        replyMessageId: inbox.message.messageId,
      }
      const claimed = this.store.claimInbound(retried)
      this.store.updateInbox(claimed.item.id, 'ready', { bindingId: binding.id })
      await this.submitInbox(claimed.item.id, binding)
      this.store.updateInbox(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    if (name === '/answer') {
      const [requestId, ...answerParts] = args
      const answer = answerParts.join(' ').trim()
      if (!requestId || !answer) throw new Error('用法：/answer <requestId> <答案>')
      const request = this.store.getInteractiveRequest(binding.accountId, requestId)
      if (request.requesterIdentity !== inbox.message.sender.id || request.status !== 'pending') throw new Error('问题不存在、已回答或无权处理')
      await this.conversations.answer(binding.workspaceId, binding.conversationId, requestId, answer)
      this.store.updateInteractiveRequest(binding.accountId, request.id, { status: 'answered' })
      this.store.updateInbox(inbox.id, 'completed', { bindingId: binding.id }); return
    }
    await this.enqueue(binding.accountId, { kind: 'reply_text', targetId: inbox.message.messageId, payload: { text: '可用命令：/status、/stop、/retry、/unbind、/answer <requestId> <答案>' }, dedupeKey: `${inbox.id}:help`, terminal: true })
    this.store.updateInbox(inbox.id, 'completed', { bindingId: binding.id })
  }

  private async recoverBindings(accountId: string): Promise<void> {
    // Construct every observation promise before awaiting any of them. Each
    // observe() synchronously installs its listener, so all bound Threads are
    // protected even while one history snapshot is still loading.
    await Promise.all(this.store.listBindings(accountId).map(async binding => {
      try {
        await this.observe(binding)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.store.audit(accountId, 'channel.binding.recovery_failed', 'channel_binding', binding.id, false, {}, message)
      }
    }))
  }

  private async recoverInbox(accountId: string): Promise<void> {
    for (const inbox of this.store.pendingInbox(accountId)) {
      try {
        if (inbox.status === 'waiting_binding') continue
        if (inbox.message.text.trim().startsWith('/')) {
          this.store.updateInbox(inbox.id, 'failed', { lastError: '控制命令未完成，重启后不会作为普通消息重放。请重新发送该命令。' })
          continue
        }
        const binding = inbox.bindingId ? this.store.getBinding(inbox.bindingId) : this.store.findBinding(accountId, inbox.conversationKey)
        if (!binding) {
          this.store.updateInbox(inbox.id, 'failed', { lastError: 'CodyWork 重启后未找到绑定，未自动提交。' })
          continue
        }
        await this.observe(binding)
        if (inbox.status === 'received' || inbox.status === 'ready') {
          this.store.updateInbox(inbox.id, 'ready', { bindingId: binding.id })
          await this.submitInbox(inbox.id, binding)
        } else if (inbox.status === 'submitting' && !inbox.turnId) {
          this.store.updateInbox(inbox.id, 'failed', { lastError: '提交结果不确定，未自动重发。请使用 /retry 明确重试。' })
        } else if (inbox.turnId) {
          this.scheduleRender(binding, inbox.turnId, true)
        } else {
          this.store.updateInbox(inbox.id, 'failed', { lastError: '缺少原生 Turn 关联，未自动重发。请使用 /retry 明确重试。' })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.store.updateInbox(inbox.id, 'failed', { lastError: `恢复失败，未自动重发：${message}` })
        this.store.audit(accountId, 'channel.inbox.recovery_failed', 'channel_inbox', inbox.id, false, {}, message)
      }
    }
  }

  private async flushAndReconcile(accountId: string): Promise<void> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) return
    await runtime.outbox.flush()
    // Initial reply cards may have been retried asynchronously. Persist the
    // eventual remote id before applying the newest projection.
    const rows = this.database.db.prepare("SELECT id, state_json FROM channel_presentations WHERE account_id = ? AND remote_message_id IS NULL AND terminal = 0").all(accountId) as Array<{ id: string; state_json: string }>
    for (const row of rows) {
      const state = JSON.parse(String(row.state_json || '{}')) as Record<string, unknown>
      const outboxId = string(state.outboxId)
      if (!outboxId) continue
      const outbox = this.store.getOutbox(outboxId)
      if (!outbox.remoteMessageId) continue
      const presentation = this.store.updatePresentation(row.id, { remoteMessageId: outbox.remoteMessageId, status: 'sent' })
      const pendingFailureCard = record(state.pendingFailureCard) as FeishuCard
      if (Object.keys(pendingFailureCard).length > 0) {
        await this.enqueue(accountId, {
          kind: 'update_card', targetId: outbox.remoteMessageId, payload: { card: pendingFailureCard },
          dedupeKey: `${presentation.id}:command-failed`, terminal: true,
        })
        this.store.updatePresentation(presentation.id, { remoteMessageId: outbox.remoteMessageId, status: 'failed', terminal: true, state })
        continue
      }
      const linkRow = this.database.db.prepare('SELECT turn_id, binding_id FROM channel_turn_links WHERE id = ?').get(presentation.turnLinkId) as { turn_id?: string; binding_id?: string } | undefined
      if (linkRow?.turn_id && linkRow.binding_id) this.scheduleRender(this.store.getBinding(linkRow.binding_id), linkRow.turn_id, true)
    }
  }

  private failAccount(accountId: string, action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.store.updateRuntime(accountId, { connectionState: this.runtimes.get(accountId)?.provider.getState() ?? 'failed', error: message })
    this.store.audit(accountId, action, 'channel_account', accountId, false, {}, message)
  }

  private scheduleAccountReconnect(accountId: string): void {
    if (this.reconnectTimers.has(accountId)) return
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(accountId)
      const enabled = this.store.listAccounts().find(account => account.id === accountId)?.enabled
      if (!enabled) return
      void this.stopAccount(accountId).then(() => this.startAccount(accountId)).catch(error => {
        this.failAccount(accountId, 'channel.reconnect', error)
        this.scheduleAccountReconnect(accountId)
      })
    }, 10_000)
    timer.unref?.()
    this.reconnectTimers.set(accountId, timer)
  }
}
