import type { ChannelInboundMessage, ChannelOutboxStore } from '@codycodeagent/cody-web-core/channel'
import type { FeishuConnectionDiagnostic } from '@codycodeagent/cody-web-core/feishu'
import type {
  ChannelAccountInput,
  ChannelAccountSecret,
  ChannelStore,
  ChannelGroupProfile,
  CodyWorkChannelBinding,
} from './channelStore.js'

/** Narrow persistence ports around the shared SQLite transaction boundary. */
export class AccountRepository {
  constructor(private readonly store: ChannelStore) {}
  validateInput(id: string | null, input: ChannelAccountInput) { return this.store.validateAccountInput(id, input) }
  list() { return this.store.listAccounts() }
  get(id: string) { return this.store.getAccount(id) }
  save(id: string | null, input: ChannelAccountInput) { return this.store.saveAccount(id, input) }
  restore(account: ChannelAccountSecret) { return this.store.restoreAccount(account) }
  delete(id: string) { return this.store.deleteAccount(id) }
  updateRuntime(id: string, input: { connectionState?: string; error?: string; botOpenId?: string; botName?: string; connected?: boolean; event?: boolean; delivery?: boolean; connectionDiagnostic?: FeishuConnectionDiagnostic }) { return this.store.updateRuntime(id, input) }
}

export class BindingRepository {
  constructor(private readonly store: ChannelStore) {}
  find(accountId: string, conversationKey: string) { return this.store.findBinding(accountId, conversationKey) }
  get(id: string) { return this.store.getBinding(id) }
  list(accountId: string) { return this.store.listBindings(accountId) }
  listForConversation(conversationId: string) { return this.store.listBindingsForConversation(conversationId) }
  listForDemand(workspaceId: string, demandId: string) { return this.store.listBindingsForDemand(workspaceId, demandId) }
  hasForConversation(conversationId: string) { return this.store.hasBindingForConversation(conversationId) }
  groupProfile(accountId: string, channelConversationId: string) { return this.store.getGroupProfile(accountId, channelConversationId) }
  saveGroupProfile(input: Omit<ChannelGroupProfile, 'createdAtIso' | 'updatedAtIso'>) { return this.store.saveGroupProfile(input) }
  create(input: Parameters<ChannelStore['createBinding']>[0]) { return this.store.createBinding(input) }
  delete(accountId: string, conversationKey: string) { return this.store.deleteBinding(accountId, conversationKey) }
  deleteById(accountId: string, bindingId: string) { return this.store.deleteBindingById(accountId, bindingId) }
}

export class InboxRepository {
  constructor(private readonly store: ChannelStore) {}
  claim(message: ChannelInboundMessage) { return this.store.claimInbound(message) }
  claimAction(accountId: string, eventId: string, payload: unknown) { return this.store.claimAction(accountId, eventId, payload) }
  finishAction(id: string, status: 'action_completed' | 'action_failed', error = '') { return this.store.finishAction(id, status, error) }
  get(id: string) { return this.store.getInbox(id) }
  update(id: string, status: Parameters<ChannelStore['updateInbox']>[1], patch?: Parameters<ChannelStore['updateInbox']>[2]) { return this.store.updateInbox(id, status, patch) }
  pending(accountId: string) { return this.store.pendingInbox(accountId) }
  latestFailed(accountId: string, conversationKey: string) { return this.store.latestFailedInbox(accountId, conversationKey) }
}

export class ProjectionRepository {
  constructor(private readonly store: ChannelStore) {}
  createTurnLink(input: Parameters<ChannelStore['createTurnLink']>[0]) { return this.store.createTurnLink(input) }
  updateTurnLink(clientCommandId: string, patch: Parameters<ChannelStore['updateTurnLink']>[1]) { return this.store.updateTurnLink(clientCommandId, patch) }
  turnByCommand(clientCommandId: string) { return this.store.getTurnLinkByCommand(clientCommandId) }
  turnByBinding(bindingId: string, turnId: string) { return this.store.getTurnLinkByTurn(bindingId, turnId) }
  turnByConversation(conversationId: string, turnId: string) { return this.store.getTurnLinkByConversationTurn(conversationId, turnId) }
  activeTurns(bindingId: string) { return this.store.listActiveTurnLinks(bindingId) }
  createPresentation(input: Parameters<ChannelStore['createPresentation']>[0]) { return this.store.createPresentation(input) }
  getPresentation(id: string) { return this.store.getPresentation(id) }
  updatePresentation(id: string, patch: Parameters<ChannelStore['updatePresentation']>[1]) { return this.store.updatePresentation(id, patch) }
}

export class OutboxRepository implements ChannelOutboxStore {
  constructor(private readonly store: ChannelStore) {}
  enqueue(input: Parameters<ChannelOutboxStore['enqueue']>[0]) { return this.store.enqueue(input) }
  claim(input: Parameters<ChannelOutboxStore['claim']>[0]) { return this.store.claim(input) }
  markSending(id: string) { return this.store.markSending(id) }
  markSent(id: string, remoteMessageId?: string) { return this.store.markSent(id, remoteMessageId) }
  markRetry(id: string, error: string, availableAtIso: string) { return this.store.markRetry(id, error, availableAtIso) }
  markDeadLetter(id: string, error: string) { return this.store.markDeadLetter(id, error) }
  markSuperseded(input: Parameters<NonNullable<ChannelOutboxStore['markSuperseded']>>[0]) { return this.store.markSuperseded(input) }
  get(id: string) { return this.store.getOutbox(id) }
  retry(accountId: string, id: string) { return this.store.retryOutbox(accountId, id) }
  listFailed(accountId: string, limit = 20) { return this.store.listFailedDeliveries(accountId, limit) }
}

export class InteractiveRequestRepository {
  constructor(private readonly store: ChannelStore) {}
  createAccess(input: Parameters<ChannelStore['createAccessRequest']>[0]) { return this.store.createAccessRequest(input) }
  getAccess(accountId: string, id: string) { return this.store.getAccessRequest(accountId, id) }
  updateAccessRemote(accountId: string, id: string, remoteMessageId: string) { return this.store.updateAccessRequestRemoteMessage(accountId, id, remoteMessageId) }
  resolveAccess(input: Parameters<ChannelStore['resolveAccessRequest']>[0]) { return this.store.resolveAccessRequest(input) }
  save(input: Parameters<ChannelStore['saveInteractiveRequest']>[0]) { return this.store.saveInteractiveRequest(input) }
  get(accountId: string, requestId: string) { return this.store.getInteractiveRequest(accountId, requestId) }
  getById(accountId: string, id: string) { return this.store.getInteractiveRequestById(accountId, id) }
  byConversation(conversationId: string, requestId: string, turnId = '') { return this.store.getInteractiveRequestByConversation(conversationId, requestId, turnId) }
  listByConversation(conversationId: string, requestId: string, turnId = '') { return this.store.listInteractiveRequestsByConversation(conversationId, requestId, turnId) }
  pendingForTurn(conversationId: string, turnId: string) { return this.store.listPendingInteractiveRequestsForTurn(conversationId, turnId) }
  update(accountId: string, id: string, patch: Parameters<ChannelStore['updateInteractiveRequest']>[2]) { return this.store.updateInteractiveRequest(accountId, id, patch) }
}

export class AuditRepository {
  constructor(private readonly store: ChannelStore) {}
  record(accountId: string | null, action: string, targetType: string, targetId: string, success: boolean, metadata: unknown = {}, error = '') {
    return this.store.audit(accountId, action, targetType, targetId, success, metadata, error)
  }
}

export type AccountRepositoryPort = Pick<AccountRepository, 'validateInput' | 'list' | 'get' | 'save' | 'restore' | 'delete' | 'updateRuntime'>
export type BindingRepositoryPort = Pick<BindingRepository, 'find' | 'get' | 'list' | 'listForConversation' | 'listForDemand' | 'hasForConversation' | 'groupProfile' | 'saveGroupProfile' | 'create' | 'delete' | 'deleteById'>
export type InboxRepositoryPort = Pick<InboxRepository, 'claim' | 'claimAction' | 'finishAction' | 'get' | 'update' | 'pending' | 'latestFailed'>
export type ProjectionRepositoryPort = Pick<ProjectionRepository, 'createTurnLink' | 'updateTurnLink' | 'turnByCommand' | 'turnByBinding' | 'turnByConversation' | 'activeTurns' | 'createPresentation' | 'getPresentation' | 'updatePresentation'>
export type OutboxRepositoryPort = Pick<OutboxRepository, keyof ChannelOutboxStore | 'get' | 'retry' | 'listFailed'>
export type InteractiveRequestRepositoryPort = Pick<InteractiveRequestRepository, 'createAccess' | 'getAccess' | 'updateAccessRemote' | 'resolveAccess' | 'save' | 'get' | 'getById' | 'byConversation' | 'listByConversation' | 'pendingForTurn' | 'update'>
export type AuditRepositoryPort = Pick<AuditRepository, 'record'>

export interface ChannelRepositoryPorts {
  readonly accounts: AccountRepositoryPort
  readonly bindings: BindingRepositoryPort
  readonly inbox: InboxRepositoryPort
  readonly projections: ProjectionRepositoryPort
  readonly outbox: OutboxRepositoryPort
  readonly requests: InteractiveRequestRepositoryPort
  readonly audit: AuditRepositoryPort
  diagnostics(accountId: string): ReturnType<ChannelStore['diagnostics']>
}

/** SQLite adapter that assembles the narrow repository ports. */
export class ChannelRepositories implements ChannelRepositoryPorts {
  readonly accounts: AccountRepository
  readonly bindings: BindingRepository
  readonly inbox: InboxRepository
  readonly projections: ProjectionRepository
  readonly outbox: OutboxRepository
  readonly requests: InteractiveRequestRepository
  readonly audit: AuditRepository

  constructor(private readonly store: ChannelStore) {
    this.accounts = new AccountRepository(store)
    this.bindings = new BindingRepository(store)
    this.inbox = new InboxRepository(store)
    this.projections = new ProjectionRepository(store)
    this.outbox = new OutboxRepository(store)
    this.requests = new InteractiveRequestRepository(store)
    this.audit = new AuditRepository(store)
  }

  /** Cross-table operational read used only by the channel composition facade. */
  diagnostics(accountId: string) { return this.store.diagnostics(accountId) }
}
