import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  ReliableChannelOutbox,
  type ChannelInboundMessage,
  type ChannelOutboxItem,
} from '@codycodeagent/cody-web-core/channel'
import {
  FeishuProvider,
  type FeishuCard,
  type FeishuCardAction,
} from '@codycodeagent/cody-web-core/feishu'
import { ChannelDeliveryWorker } from './channelDeliveryWorker.js'
import {
  type ChannelAccount,
  type ChannelAccountInput,
} from './channelStore.js'
import type { ChannelRepositoryPorts } from './channelRepositories.js'
import { makeId } from '../db/index.js'

type DeliveryPayload = {
  text?: string
  card?: FeishuCard
  imageKey?: string
  path?: string
  root?: string
  replyMessageId?: string
  replyInThread?: boolean
}

type AccountRuntime = {
  account: ChannelAccount
  provider: FeishuProvider
  delivery: ChannelDeliveryWorker
}

export type ChannelAccountManagerHooks = {
  onMessage(message: ChannelInboundMessage): Promise<void>
  onAction(accountId: string, action: FeishuCardAction): Promise<unknown>
  recoverBindings(accountId: string): Promise<void>
  recoverInbox(accountId: string): Promise<void>
  reconcileDeliveredPresentations(accountId: string): Promise<void>
  reconcileActiveTurns(accountId: string): Promise<void>
  detachAccountObservations(accountId: string): void
  validateLocalImage(path: string, root: string): Promise<boolean>
}

export type ChannelProviderFactory = (options: ConstructorParameters<typeof FeishuProvider>[0]) => FeishuProvider

export type ChannelAdministratorResolution = {
  identities: string[]
  ownerIdentity: string
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stableUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/**
 * Owns Feishu account/provider lifecycles. Conversation routing and projection
 * stay in higher-level services; this component only manages transport state,
 * durable delivery and reconnect policy.
 */
export class ChannelAccountManager {
  private readonly runtimes = new Map<string, AccountRuntime>()
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly repositories: ChannelRepositoryPorts,
    private readonly hooks: ChannelAccountManagerHooks,
    private readonly providerFactory: ChannelProviderFactory = options => new FeishuProvider(options),
  ) {}

  async start(): Promise<void> {
    for (const account of this.repositories.accounts.list()) {
      if (account.enabled) await this.startAccount(account.id).catch(error => this.fail(account.id, 'channel.start', error))
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.runtimes.values()].map(async runtime => {
      await runtime.delivery.close()
      runtime.provider.stop()
    }))
    this.runtimes.clear()
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
  }

  has(accountId: string): boolean { return this.runtimes.has(accountId) }

  provider(accountId: string): FeishuProvider | null { return this.runtimes.get(accountId)?.provider ?? null }

  state(accountId: string): string { return this.provider(accountId)?.getState() ?? 'offline' }

  refreshAccount(accountId: string): void {
    const runtime = this.runtimes.get(accountId)
    if (runtime) runtime.account = this.repositories.accounts.get(accountId)
  }

  async resolveAdministrators(accountId: string): Promise<ChannelAdministratorResolution> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) throw new Error('飞书机器人当前未连接')
    try {
      const application = await runtime.provider.applicationAdministrators()
      this.repositories.audit.record(accountId, 'channel.administrators.resolved', 'channel_account', accountId, true, {
        source: 'application', count: application.administratorIds.length, ownerConfigured: Boolean(application.ownerId),
      })
      return { identities: application.administratorIds, ownerIdentity: application.ownerId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repositories.audit.record(accountId, 'channel.administrators.resolve_failed', 'channel_account', accountId, false, {
        source: 'application',
      }, message)
      throw new Error(`无法读取当前飞书应用的所有者或管理员。请开通“管理应用自身资源”权限后重试。${message ? ` ${message}` : ''}`)
    }
  }

  async save(id: string | null, input: ChannelAccountInput): Promise<ChannelAccount> {
    this.repositories.accounts.validateInput(id, input)
    const previous = id ? this.repositories.accounts.get(id) : null
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
      const account = this.repositories.accounts.save(id, input)
      this.refreshAccount(id)
      this.repositories.audit.record(id, 'channel.account.updated', 'channel_account', id, true, { enabled: account.enabled, reconnected: false })
      return this.repositories.accounts.list().find(item => item.id === id)!
    }

    if (id) await this.stopAccount(id)
    let account: ChannelAccount | null = null
    try {
      account = this.repositories.accounts.save(id, input)
      if (account.enabled) await this.startAccount(account.id)
      this.repositories.audit.record(account.id, id ? 'channel.account.updated' : 'channel.account.created', 'channel_account', account.id, true, { enabled: account.enabled, reconnected: true })
      return this.repositories.accounts.list().find(item => item.id === account!.id)!
    } catch (error) {
      if (account && !previous) {
        await this.stopAccount(account.id).catch(() => undefined)
        this.repositories.accounts.delete(account.id)
      } else if (previous) {
        this.repositories.accounts.restore(previous)
        if (previous.enabled) {
          try { await this.startAccount(previous.id) }
          catch (restoreError) { this.fail(previous.id, 'channel.account.rollback', restoreError) }
        }
        this.repositories.audit.record(previous.id, 'channel.account.update_failed', 'channel_account', previous.id, false, { restored: true }, error instanceof Error ? error.message : String(error))
      }
      throw error
    }
  }

  async delete(accountId: string): Promise<void> {
    await this.stopAccount(accountId)
    this.repositories.accounts.delete(accountId)
  }

  async reconnect(accountId: string): Promise<void> {
    await this.stopAccount(accountId)
    await this.startAccount(accountId)
  }

  retryOutbox(accountId: string, outboxId: string): void {
    this.repositories.outbox.retry(accountId, outboxId)
    this.flushInBackground(accountId, 'channel.outbox.manual_retry')
  }

  async enqueue(accountId: string, input: Parameters<ReliableChannelOutbox['enqueue']>[0]): Promise<ChannelOutboxItem> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) throw new Error('飞书机器人当前未连接')
    const item = await runtime.delivery.enqueue(input)
    return this.repositories.outbox.get(item.id)
  }

  async queue(accountId: string, input: Parameters<ChannelDeliveryWorker['queue']>[0]): Promise<ChannelOutboxItem> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) throw new Error('飞书机器人当前未连接')
    return runtime.delivery.queue(input)
  }

  /** Persists proactive notifications even while the provider is reconnecting.
   * An active delivery worker picks them up immediately; otherwise the normal
   * account recovery flush delivers them after reconnect. */
  async queueDurable(accountId: string, input: Parameters<ChannelDeliveryWorker['queue']>[0]): Promise<ChannelOutboxItem> {
    const account = this.repositories.accounts.get(accountId)
    if (!account.enabled) throw new Error('飞书机器人未启用')
    const runtime = this.runtimes.get(accountId)
    if (runtime) return runtime.delivery.queue(input)
    return this.repositories.outbox.enqueue({
      id: makeId('outbox'), provider: 'feishu', accountId,
      kind: input.kind, targetId: input.targetId, payload: input.payload, dedupeKey: input.dedupeKey,
      ...(input.revision === undefined ? {} : { revision: input.revision }),
      ...(input.terminal === undefined ? {} : { terminal: input.terminal }),
    })
  }

  flushInBackground(accountId: string, action = 'channel.outbox.background_flush'): void {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) return
    void runtime.delivery.flush().catch(error => this.reportBackgroundFailure(accountId, action, error))
  }

  fail(accountId: string, action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[codywork] ${action} failed for ${accountId}: ${message}`)
    try {
      this.repositories.accounts.updateRuntime(accountId, { connectionState: this.state(accountId) === 'offline' ? 'failed' : this.state(accountId), error: message })
    } catch (reportError) {
      console.error(`[codywork] failed to persist ${action} runtime state for ${accountId}: ${reportError instanceof Error ? reportError.message : String(reportError)}`)
    }
    try {
      this.repositories.audit.record(accountId, action, 'channel_account', accountId, false, {}, message)
    } catch (reportError) {
      console.error(`[codywork] failed to persist ${action} audit for ${accountId}: ${reportError instanceof Error ? reportError.message : String(reportError)}`)
    }
  }

  private async startAccount(accountId: string): Promise<void> {
    if (this.runtimes.has(accountId)) return
    const account = this.repositories.accounts.get(accountId)
    if (!account.enabled) return
    const provider = this.createProvider(account)
    const outbox = new ReliableChannelOutbox({ provider: 'feishu', accountId }, this.repositories.outbox, {
      deliver: async item => this.deliver(provider, accountId, item),
      classifyError: error => provider.classifyError(error),
    })
    const delivery = new ChannelDeliveryWorker(outbox, {
      afterFlush: () => this.hooks.reconcileDeliveredPresentations(accountId),
      onBackgroundError: error => this.reportBackgroundFailure(accountId, 'channel.outbox.background_flush', error),
    })
    delivery.start()
    this.runtimes.set(accountId, { account, provider, delivery })
    try {
      await this.hooks.recoverBindings(accountId)
      const identity = await provider.identity()
      this.repositories.accounts.updateRuntime(accountId, { connectionState: 'connecting', botOpenId: identity.id, botName: identity.name })
      await this.hooks.recoverInbox(accountId)
      await delivery.flush()
      await this.hooks.reconcileActiveTurns(accountId)
      await provider.start({
        onMessage: message => this.hooks.onMessage(message),
        onAction: action => this.hooks.onAction(accountId, action),
        onState: (state, error, diagnostic) => {
          this.repositories.accounts.updateRuntime(accountId, {
            connectionState: state,
            ...(error ? { error: error.message } : state === 'connected' ? { error: '' } : {}),
            connected: state === 'connected',
            connectionDiagnostic: diagnostic,
          })
          if (state === 'failed') this.scheduleReconnect(accountId)
          if (state === 'connected') void this.hooks.reconcileActiveTurns(accountId)
        },
      })
    } catch (error) {
      await delivery.close()
      provider.stop()
      this.runtimes.delete(accountId)
      throw error
    }
  }

  private createProvider(account: Pick<ChannelAccount & { appSecret: string }, 'id' | 'appId' | 'appSecret' | 'domain' | 'botOpenId' | 'privateConversationMode'>): FeishuProvider {
    return this.providerFactory({
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
    try { await provider.identity() }
    finally { provider.stop() }
  }

  private async stopAccount(accountId: string): Promise<void> {
    const reconnectTimer = this.reconnectTimers.get(accountId)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    this.reconnectTimers.delete(accountId)
    this.hooks.detachAccountObservations(accountId)
    const runtime = this.runtimes.get(accountId)
    if (!runtime) return
    await runtime.delivery.close()
    runtime.provider.stop()
    this.runtimes.delete(accountId)
    this.repositories.accounts.updateRuntime(accountId, { connectionState: 'idle' })
  }

  private async deliver(provider: FeishuProvider, accountId: string, item: ChannelOutboxItem): Promise<{ remoteMessageId?: string }> {
    try {
      const payload = object(item.payload) as DeliveryPayload
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
        if (!await this.hooks.validateLocalImage(path, root)) throw new Error('Channel image is outside the bound Demand or uses an unsupported format')
        const imageKey = await provider.uploadImage(await readFile(path))
        remoteMessageId = payload.replyMessageId
          ? await provider.replyImage(payload.replyMessageId, imageKey, payload.replyInThread === true, uuid)
          : await provider.sendImage(item.targetId, imageKey, uuid)
      } else if (item.kind === 'reply_image') remoteMessageId = await provider.replyImage(item.targetId, payload.imageKey ?? '', Boolean(payload.replyInThread), uuid)
      else throw new Error(`Unsupported Feishu delivery kind: ${item.kind}`)
      this.repositories.accounts.updateRuntime(accountId, { delivery: true })
      this.auditDelivery('channel.outbox.delivered', item, true)
      return remoteMessageId ? { remoteMessageId } : {}
    } catch (error) {
      this.auditDelivery('channel.outbox.delivery_failed', item, false, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  private auditDelivery(action: string, item: ChannelOutboxItem, success: boolean, error = ''): void {
    try {
      this.repositories.audit.record(item.accountId, action, 'channel_outbox', item.id, success, {
        provider: item.provider,
        accountId: item.accountId,
        outboxId: item.id,
      }, error)
    } catch (auditError) {
      console.error(`[codywork] failed to persist ${action} audit for ${item.id}: ${auditError instanceof Error ? auditError.message : String(auditError)}`)
    }
  }

  private reportBackgroundFailure(accountId: string, action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[codywork] ${action} failed for ${accountId}: ${message}`)
    try {
      this.repositories.audit.record(accountId, action, 'channel_account', accountId, false, {}, message)
    } catch (reportError) {
      console.error(`[codywork] failed to persist ${action} audit for ${accountId}: ${reportError instanceof Error ? reportError.message : String(reportError)}`)
    }
  }

  private scheduleReconnect(accountId: string): void {
    if (this.reconnectTimers.has(accountId)) return
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(accountId)
      const enabled = this.repositories.accounts.list().find(account => account.id === accountId)?.enabled
      if (!enabled) return
      void this.stopAccount(accountId).then(() => this.startAccount(accountId)).catch(error => {
        this.fail(accountId, 'channel.reconnect', error)
        this.scheduleReconnect(accountId)
      })
    }, 10_000)
    timer.unref?.()
    this.reconnectTimers.set(accountId, timer)
  }
}
