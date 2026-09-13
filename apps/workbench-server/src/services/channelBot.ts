import type { WorkbenchDb } from '../db/index.js'
import { ConversationService } from './conversations.js'
import { ChannelAccountManager, type ChannelProviderFactory } from './channelAccountManager.js'
import { ChannelAccessService } from './channelAccessService.js'
import { ChannelRequestBridge } from './channelRequestBridge.js'
import { ChannelRouter } from './channelRouter.js'
import { ChannelProjectionService } from './channelProjection.js'
import { ChannelCommandAdapter } from './channelCommandAdapter.js'
import { ChannelBindingService } from './channelBindingService.js'
import { ChannelRepositories } from './channelRepositories.js'
import { ChannelSessionSettingsService } from './channelSessionSettings.js'
import { WorkspaceRegistry } from './workspaceRegistry.js'
import { getDemand } from './demands.js'
import {
  buildConversationShareDocument,
  FeishuConversationDocumentPublisher,
  type ConversationDocumentPublisher,
} from './conversationSharing.js'
import {
  FeishuPermissionInspector,
  feishuPermissionTemplate,
  type FeishuPermissionStatus,
} from './feishuPermissions.js'
import {
  ChannelStore,
  type ChannelAccount,
  type ChannelAccountInput,
  type CodyWorkChannelBinding,
} from './channelStore.js'

export { feishuProjectionBody } from './channelFeishuRenderer.js'

export function codyWorkConversationUrl(publicOrigin: string | undefined, binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string {
  if (!publicOrigin?.trim()) return ''
  try {
    const url = new URL(publicOrigin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    url.searchParams.set('workspace', binding.workspaceId)
    if (binding.demandId) url.searchParams.set('demand', binding.demandId)
    url.searchParams.set('conversation', binding.conversationId)
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * CodyWork's embedded Channel Host. Core owns channel mechanics and Codex owns
 * the native Thread; this service only applies CodyWork authorization, target
 * binding, and presentation policy.
 */
export class CodyWorkChannelService {
  private readonly repositories: ChannelRepositories
  private readonly accounts: ChannelAccountManager
  private readonly access: ChannelAccessService
  private readonly requests: ChannelRequestBridge
  private readonly router: ChannelRouter
  private readonly projection: ChannelProjectionService
  private readonly commands: ChannelCommandAdapter
  private readonly bindings: ChannelBindingService
  private readonly settings: ChannelSessionSettingsService

  constructor(
    private readonly database: WorkbenchDb,
    private readonly conversations: ConversationService,
    private readonly workspaces: WorkspaceRegistry,
    private readonly options: {
      publicOrigin?: string
      now?: () => Date
      providerFactory?: ChannelProviderFactory
      documentPublisher?: ConversationDocumentPublisher
      permissionInspector?: { inspect(account: import('./channelStore.js').ChannelAccountSecret): Promise<FeishuPermissionStatus> }
    } = {},
  ) {
    this.repositories = new ChannelRepositories(new ChannelStore(database))
    this.settings = new ChannelSessionSettingsService(database, this.repositories, conversations, workspaces)
    this.accounts = new ChannelAccountManager(this.repositories, {
      onMessage: message => this.router.onMessage(message),
      onAction: (accountId, action) => this.router.onAction(accountId, action),
      recoverBindings: accountId => this.projection.recoverBindings(accountId),
      recoverInbox: accountId => this.commands.recoverInbox(accountId),
      reconcileDeliveredPresentations: accountId => this.projection.reconcileDeliveredPresentations(accountId),
      reconcileActiveTurns: accountId => this.projection.reconcileActiveTurns(accountId),
      detachAccountObservations: accountId => this.projection.detachAccount(accountId),
      validateLocalImage: (path, root) => this.projection.isAllowedImage(path, root),
    }, this.options.providerFactory)
    this.access = new ChannelAccessService(
      this.repositories,
      (accountId, input) => this.accounts.enqueue(accountId, input),
      accountId => this.accounts.resolveAdministrators(accountId),
      accountId => this.accounts.refreshAccount(accountId),
      () => this.now(),
    )
    this.requests = new ChannelRequestBridge(
      this.repositories,
      this.conversations,
      (accountId, input) => this.accounts.enqueue(accountId, input),
      binding => this.openUrl(binding),
      (accountId, action, error) => this.accounts.fail(accountId, action, error),
    )
    this.projection = new ChannelProjectionService(
      this.database,
      this.repositories,
      this.conversations,
      this.workspaces,
      this.requests,
      {
        enqueue: (accountId, input) => this.accounts.enqueue(accountId, input),
        queue: (accountId, input) => this.accounts.queue(accountId, input),
        fail: (accountId, action, error) => this.accounts.fail(accountId, action, error),
        isAccountActive: accountId => this.accounts.has(accountId),
        openUrl: binding => this.openUrl(binding),
      },
    )
    this.commands = new ChannelCommandAdapter(
      this.database,
      this.repositories,
      this.conversations,
      this.workspaces,
      this.projection,
      this.settings,
      {
        provider: accountId => this.accounts.provider(accountId),
        enqueue: (accountId, input) => this.accounts.enqueue(accountId, input),
        openUrl: binding => this.openUrl(binding),
      },
    )
    this.bindings = new ChannelBindingService(
      this.database,
      this.repositories,
      this.conversations,
      this.workspaces,
      {
        enqueue: (accountId, input) => this.accounts.enqueue(accountId, input),
        submitInbox: (inboxId, binding) => this.commands.submitInbox(inboxId, binding),
        observe: (binding, observeOptions) => this.projection.observe(binding, observeOptions),
        openUrl: binding => this.openUrl(binding),
      },
    )
    this.router = new ChannelRouter(
      this.repositories,
      this.conversations,
      this.access,
      this.requests,
      this.bindings,
      this.settings,
      {
        enqueue: (accountId, input) => this.accounts.enqueue(accountId, input),
        submitInbox: (inboxId, binding) => this.commands.submitInbox(inboxId, binding),
        observe: (binding, observeOptions) => this.projection.observe(binding, observeOptions),
        detachBindingObservation: binding => this.projection.detach(binding),
        openUrl: binding => this.openUrl(binding),
        accountState: accountId => this.accounts.state(accountId),
        retryOutbox: (accountId, outboxId) => this.accounts.retryOutbox(accountId, outboxId),
        fail: (accountId, action, error) => this.accounts.fail(accountId, action, error),
      },
    )
  }

  async start(): Promise<void> {
    await this.accounts.start()
  }

  async close(): Promise<void> {
    await this.accounts.close()
    this.projection.close()
  }

  listAccounts(): ChannelAccount[] { return this.repositories.accounts.list() }

  permissionTemplate() { return feishuPermissionTemplate() }

  async permissions(accountId: string) {
    const account = this.repositories.accounts.get(accountId)
    return (this.options.permissionInspector ?? new FeishuPermissionInspector()).inspect(account)
  }

  listBindings(accountId: string) { return this.repositories.bindings.list(accountId) }

  private now(): Date { return this.options.now?.() ?? new Date() }

  private openUrl(binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string {
    return codyWorkConversationUrl(this.options?.publicOrigin, binding)
  }

  private presentBindings(bindings: CodyWorkChannelBinding[]) {
    const accounts = new Map(this.repositories.accounts.list().map(account => [account.id, account]))
    return bindings.map(binding => {
      const account = accounts.get(binding.accountId)
      const diagnostics = this.repositories.diagnostics(binding.accountId)
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

  listConversationBindings(conversationId: string) {
    return this.presentBindings(this.repositories.bindings.listForConversation(conversationId))
  }

  listDemandBindings(workspaceId: string, demandId: string) {
    return this.presentBindings(this.repositories.bindings.listForDemand(workspaceId, demandId))
  }

  unbind(accountId: string, bindingId: string): boolean {
    const binding = this.repositories.bindings.deleteById(accountId, bindingId)
    if (!binding) return false
    this.projection.detach(binding)
    this.repositories.audit.record(accountId, 'channel.binding.removed', 'channel_binding', bindingId, true, { conversationId: binding.conversationId })
    return true
  }

  diagnostics(accountId: string) {
    const account = this.repositories.accounts.get(accountId)
    const bindingConversationIds = new Set(this.repositories.bindings.list(accountId).map(binding => binding.conversationId))
    return {
      account: { ...account, appSecret: undefined },
      runtime: this.projection.diagnostics(bindingConversationIds),
      ...this.repositories.diagnostics(accountId),
    }
  }

  async saveAccount(id: string | null, input: ChannelAccountInput): Promise<ChannelAccount> {
    return this.accounts.save(id, input)
  }

  async deleteAccount(id: string): Promise<void> {
    await this.accounts.delete(id)
  }

  async reconnect(accountId: string): Promise<void> {
    await this.accounts.reconnect(accountId)
  }

  retryOutbox(accountId: string, outboxId: string): void {
    this.accounts.retryOutbox(accountId, outboxId)
  }

  async shareConversation(input: { workspaceId: string; conversationId: string; accountId: string; title?: string }) {
    const workspace = this.workspaces.get(input.workspaceId)
    const conversation = this.conversations.get(workspace.id, input.conversationId)
    const account = this.repositories.accounts.get(input.accountId)
    if (!account.enabled) throw new Error('请选择已启用的飞书机器人')
    const demand = conversation.demandId ? getDemand(this.database, workspace, conversation.demandId) : null
    const snapshot = await this.conversations.historyCanonical(workspace.id, conversation.id)
    const document = buildConversationShareDocument({
      workspaceName: workspace.name,
      demandName: demand?.name,
      conversationTitle: conversation.title,
      events: snapshot.events,
      exportedAt: this.now(),
      title: input.title,
    })
    try {
      const published = await (this.options.documentPublisher ?? new FeishuConversationDocumentPublisher()).publish(account, document)
      this.repositories.audit.record(account.id, 'conversation.document.shared', 'conversation', conversation.id, true, {
        workspaceId: workspace.id,
        demandId: conversation.demandId,
        documentId: published.documentId,
        messageCount: document.messageCount,
      })
      return { ...published, title: document.title, messageCount: document.messageCount }
    } catch (error) {
      this.repositories.audit.record(account.id, 'conversation.document.share_failed', 'conversation', conversation.id, false, {
        workspaceId: workspace.id,
        demandId: conversation.demandId,
      }, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

}
