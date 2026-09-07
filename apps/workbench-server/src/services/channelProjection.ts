import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative } from 'node:path'
import { projectChannelTurn } from '@codycodeagent/cody-web-core/channel'
import type { ConversationState } from '@codycodeagent/cody-web-core/conversation'
import type { FeishuCard } from '@codycodeagent/cody-web-core/feishu'
import type { WorkbenchDb } from '../db/index.js'
import type { ConversationEvent, ConversationService } from './conversations.js'
import type { ChannelAccountManager } from './channelAccountManager.js'
import type { ChannelRequestBridge } from './channelRequestBridge.js'
import { ConversationProjectionHost } from './conversationProjectionHost.js'
import { listDemands } from './demands.js'
import type { WorkspaceRegistry } from './workspaceRegistry.js'
import type { ChannelPresentation, CodyWorkChannelBinding } from './channelStore.js'
import type { ChannelRepositoryPorts } from './channelRepositories.js'
import { commandFailureCard, executionContextFromState, projectionCard } from './channelFeishuRenderer.js'

const PROJECTION_THROTTLE_MS = 700
const FEISHU_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'])

type CodyWorkInboundMessage = {
  sourceMessageId?: string
  replyMessageId?: string
}

type ChannelProjectionHooks = {
  enqueue(accountId: string, input: Parameters<ChannelAccountManager['enqueue']>[1]): ReturnType<ChannelAccountManager['enqueue']>
  queue(accountId: string, input: Parameters<ChannelAccountManager['queue']>[1]): ReturnType<ChannelAccountManager['queue']>
  fail(accountId: string, action: string, error: unknown): void
  isAccountActive(accountId: string): boolean
  openUrl(binding: Pick<CodyWorkChannelBinding, 'workspaceId' | 'demandId' | 'conversationId'>): string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Canonical conversation events -> durable channel presentations. */
export class ChannelProjectionService {
  private readonly host: ConversationProjectionHost
  private readonly bindings = new Map<string, Set<string>>()
  private readonly renderTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly renderInFlight = new Map<string, Promise<void>>()
  private readonly reconciliationInFlight = new Set<string>()

  constructor(
    private readonly database: WorkbenchDb,
    private readonly repositories: ChannelRepositoryPorts,
    private readonly conversations: ConversationService,
    private readonly workspaces: WorkspaceRegistry,
    private readonly requests: ChannelRequestBridge,
    private readonly hooks: ChannelProjectionHooks,
  ) {
    this.host = new ConversationProjectionHost(this.conversations.events, (conversationId, event, state) => {
      this.onConversationEventSafely(conversationId, event, state)
    })
  }

  close(): void {
    this.host.close()
    this.bindings.clear()
    this.reconciliationInFlight.clear()
    for (const timer of this.renderTimers.values()) clearTimeout(timer)
    this.renderTimers.clear()
    this.renderInFlight.clear()
  }

  diagnostics(conversationIds: Set<string>): { observedConversations: number; initializingConversations: number; bufferedEvents: number } {
    return {
      observedConversations: [...conversationIds].filter(id => this.host.has(id)).length,
      initializingConversations: [...conversationIds].filter(id => this.host.isInitializing(id)).length,
      bufferedEvents: [...conversationIds].reduce((count, id) => count + this.host.bufferedCount(id), 0),
    }
  }

  async observe(binding: CodyWorkChannelBinding, options: { emptyHistory?: boolean } = {}): Promise<void> {
    const bindingIds = this.bindings.get(binding.conversationId) ?? new Set<string>()
    const firstBinding = bindingIds.size === 0
    bindingIds.add(binding.id)
    this.bindings.set(binding.conversationId, bindingIds)
    try {
      const attachment = await this.host.attach({
        conversationId: binding.conversationId,
        threadId: binding.threadId,
        emptyHistory: options.emptyHistory,
        readSnapshot: () => this.conversations.historyCanonical(binding.workspaceId, binding.conversationId),
      })
      if (!firstBinding || !attachment.initialized) return
      const state = attachment.state
      for (const turn of Object.values(state.turns)) {
        if (turn.lifecycle === 'completed' || turn.lifecycle === 'failed' || turn.lifecycle === 'interrupted') {
          this.requests.expireTurn(binding.conversationId, turn.id, `turn.${turn.lifecycle}` as ConversationEvent['type'])
        }
      }
      const pendingRequestIds = new Set(state.pendingRequests.map(request => request.id))
      for (const event of attachment.snapshotEvents) {
        if (event.type !== 'approval.requested' && event.type !== 'question.requested') continue
        const requestId = string(event.data.requestId ?? event.data.approvalId ?? event.id)
        if (pendingRequestIds.has(requestId)) this.publishRequestEvent(binding.conversationId, event)
      }
    } catch (error) {
      bindingIds.delete(binding.id)
      if (bindingIds.size === 0) {
        this.bindings.delete(binding.conversationId)
        this.host.detach(binding.conversationId)
      }
      throw error
    }
  }

  detach(binding: CodyWorkChannelBinding): void {
    const bindingIds = this.bindings.get(binding.conversationId)
    if (!bindingIds) return
    bindingIds.delete(binding.id)
    if (bindingIds.size > 0) return
    this.bindings.delete(binding.conversationId)
    this.host.detach(binding.conversationId)
  }

  detachAccount(accountId: string): void {
    for (const binding of this.repositories.bindings.list(accountId)) this.detach(binding)
  }

  private bindingOrDetach(conversationId: string, bindingId: string): CodyWorkChannelBinding | null {
    try { return this.repositories.bindings.get(bindingId) } catch {
      this.bindings.get(conversationId)?.delete(bindingId)
      return null
    }
  }

  private onConversationEventSafely(conversationId: string, event: ConversationEvent, state: ConversationState): void {
    try {
      this.onConversationEvent(conversationId, event, state)
    } catch (error) {
      const accountIds = new Set<string>()
      for (const bindingId of this.bindings.get(conversationId) ?? []) {
        const binding = this.bindingOrDetach(conversationId, bindingId)
        if (binding) accountIds.add(binding.accountId)
      }
      for (const accountId of accountIds) {
        try { this.hooks.fail(accountId, 'channel.conversation_event', error) } catch { /* owner event listeners must never fail */ }
      }
    }
  }

  private onConversationEvent(conversationId: string, event: ConversationEvent, state: ConversationState): void {
    const bindingIds = this.bindings.get(conversationId)
    if (!bindingIds) return
    if (event.type === 'command.bound' && event.itemId && event.turnId) {
      const link = this.repositories.projections.turnByCommand(event.itemId)
      if (link) {
        this.repositories.projections.updateTurnLink(link.clientCommandId, { turnId: event.turnId, status: 'running' })
        this.repositories.inbox.update(link.inboxId, 'submitted', { turnId: event.turnId })
        const binding = this.repositories.bindings.get(link.bindingId)
        const inbox = this.repositories.inbox.get(link.inboxId)
        this.repositories.audit.record(binding.accountId, 'channel.turn.bound', 'channel_turn_link', link.id, true, {
          provider: inbox.message.provider, accountId: binding.accountId, eventId: inbox.message.eventId, messageId: inbox.message.messageId,
          conversationKey: inbox.conversationKey, bindingId: binding.id, threadId: binding.threadId, turnId: event.turnId,
          inboxId: inbox.id,
        })
      }
    }
    if (event.type === 'command.failed' && event.itemId) {
      const link = this.repositories.projections.turnByCommand(event.itemId)
      if (link) {
        const error = string(event.data.error || event.data.message) || 'Codex 未接受这条消息。'
        this.repositories.projections.updateTurnLink(link.clientCommandId, { status: 'failed' })
        this.repositories.inbox.update(link.inboxId, 'failed', { lastError: error })
        void this.renderCommandFailure(link.id, error).catch(renderError => {
          const binding = this.bindingOrDetach(conversationId, link.bindingId)
          if (binding) this.hooks.fail(binding.accountId, 'channel.command_failure.render', renderError)
        })
      }
    }
    const sourceLink = event.turnId ? this.repositories.projections.turnByConversation(conversationId, event.turnId) : null
    const sourceBinding = sourceLink ? this.bindingOrDetach(conversationId, sourceLink.bindingId) : null
    if (event.type === 'approval.requested' || event.type === 'question.requested') this.publishRequestEvent(conversationId, event, sourceBinding)
    if (event.type === 'approval.resolved' || event.type === 'question.resolved') {
      const requestId = string(event.data.requestId ?? event.data.approvalId)
      const requests = requestId ? this.repositories.requests.listByConversation(conversationId, requestId, event.turnId ?? '') : []
      for (const request of requests) {
        const requestBinding = this.bindingOrDetach(conversationId, request.bindingId)
        if (requestBinding) void this.requests.resolve(requestBinding, event, request).catch(error => this.hooks.fail(requestBinding.accountId, 'channel.request.resolve', error))
      }
    }
    if (event.turnId && (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.interrupted' || event.type === 'turn.disconnected')) {
      this.requests.expireTurn(conversationId, event.turnId, event.type)
    }
    for (const bindingId of [...bindingIds]) {
      const binding = this.bindingOrDetach(conversationId, bindingId)
      if (!binding) continue
      if (event.turnId) this.scheduleRender(binding, event.turnId, event.type.startsWith('turn.') && ['turn.completed', 'turn.failed', 'turn.interrupted', 'turn.disconnected'].includes(event.type))
    }
    if (bindingIds.size === 0) {
      this.bindings.delete(conversationId)
      this.host.detach(conversationId)
    }
  }

  private publishRequestEvent(conversationId: string, event: ConversationEvent, knownSourceBinding?: CodyWorkChannelBinding | null): void {
    const sourceLink = event.turnId ? this.repositories.projections.turnByConversation(conversationId, event.turnId) : null
    const sourceBinding = knownSourceBinding === undefined ? (sourceLink ? this.bindingOrDetach(conversationId, sourceLink.bindingId) : null) : knownSourceBinding
    const requestBindings = sourceBinding
      ? [sourceBinding]
      : [...(this.bindings.get(conversationId) ?? [])].reduce<CodyWorkChannelBinding[]>((rows, bindingId) => {
          const binding = this.bindingOrDetach(conversationId, bindingId)
          if (binding?.notificationPolicy === 'mirror-requests' && !rows.some(row => row.accountId === binding.accountId)) rows.push(binding)
          return rows
        }, [])
    for (const binding of requestBindings) void this.requests.publish(binding, event).catch(error => this.hooks.fail(binding.accountId, 'channel.request.publish', error))
  }

  scheduleRender(binding: CodyWorkChannelBinding, turnId: string, immediate = false): void {
    const key = `${binding.id}:${turnId}`
    const previous = this.renderTimers.get(key)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.renderTimers.delete(key)
      const prior = this.renderInFlight.get(key) ?? Promise.resolve()
      const current = prior.catch(() => undefined).then(() => this.render(binding, turnId))
      this.renderInFlight.set(key, current)
      void current.catch(error => this.hooks.fail(binding.accountId, 'channel.render', error)).finally(() => {
        if (this.renderInFlight.get(key) === current) this.renderInFlight.delete(key)
      })
    }, immediate ? 0 : PROJECTION_THROTTLE_MS)
    this.renderTimers.set(key, timer)
  }

  private async render(binding: CodyWorkChannelBinding, turnId: string): Promise<void> {
    if (!turnId) return
    const state = this.host.state(binding.conversationId)
    const link = this.repositories.projections.turnByBinding(binding.id, turnId)
    if (!state || !link) return
    const presentation = this.findTurnPresentation(link.id)
    if (!presentation) return
    const projection = projectChannelTurn(state, turnId, presentation.revision + 1)
    const prompt = string(presentation.state.prompt)
    const card = projectionCard(projection, prompt, this.hooks.openUrl(binding), executionContextFromState(presentation.state.executionContext))
    let remoteMessageId = presentation.remoteMessageId
    if (!remoteMessageId) {
      const outboxId = string(presentation.state.outboxId)
      if (outboxId) remoteMessageId = this.repositories.outbox.get(outboxId).remoteMessageId ?? ''
    }
    if (!remoteMessageId) {
      this.repositories.projections.updatePresentation(presentation.id, { revision: projection.revision, state: { ...presentation.state, pendingCard: card, projection } })
      return
    }
    await this.hooks.enqueue(binding.accountId, {
      kind: 'update_card', targetId: remoteMessageId, payload: { card }, dedupeKey: `${presentation.id}:revision:${projection.revision}`,
      revision: projection.revision, terminal: projection.terminal,
    })
    this.repositories.projections.updatePresentation(presentation.id, { remoteMessageId, status: projection.status, revision: projection.revision, terminal: projection.terminal, state: { ...presentation.state, projection } })
    if (projection.terminal) {
      this.repositories.inbox.update(link.inboxId, projection.status === 'completed' ? 'completed' : 'failed', { turnId, lastError: projection.error || null })
      this.repositories.projections.updateTurnLink(link.clientCommandId, { turnId, status: projection.status })
      if (projection.status === 'completed') await this.publishAssistantImages(binding, projection, presentation, link.inboxId)
    }
  }

  async renderCommandFailure(turnLinkId: string, error: string): Promise<void> {
    const presentation = this.findTurnPresentation(turnLinkId)
    if (!presentation) return
    let openUrl = ''
    try { openUrl = this.hooks.openUrl(this.repositories.bindings.get(presentation.bindingId)) } catch { /* removed binding */ }
    const card = commandFailureCard(error, openUrl, executionContextFromState(presentation.state.executionContext))
    let remoteMessageId = presentation.remoteMessageId
    if (!remoteMessageId) {
      const outboxId = string(presentation.state.outboxId)
      if (outboxId) remoteMessageId = this.repositories.outbox.get(outboxId).remoteMessageId ?? ''
    }
    if (!remoteMessageId) {
      this.repositories.projections.updatePresentation(presentation.id, { status: 'pending_failure', state: { ...presentation.state, pendingFailureCard: card, error } })
      return
    }
    await this.hooks.enqueue(presentation.accountId, { kind: 'update_card', targetId: remoteMessageId, payload: { card }, dedupeKey: `${presentation.id}:command-failed`, terminal: true })
    this.repositories.projections.updatePresentation(presentation.id, { remoteMessageId, status: 'failed', terminal: true, state: { ...presentation.state, error } })
  }

  private findTurnPresentation(turnLinkId: string): ChannelPresentation | null {
    const row = this.database.db.prepare('SELECT id FROM channel_presentations WHERE turn_link_id = ? AND purpose = \'turn\' ORDER BY created_at DESC LIMIT 1').get(turnLinkId) as { id?: string } | undefined
    return row?.id ? this.repositories.projections.getPresentation(row.id) : null
  }

  private async publishAssistantImages(binding: CodyWorkChannelBinding, projection: ReturnType<typeof projectChannelTurn>, presentation: ChannelPresentation, inboxId: string): Promise<void> {
    const workspace = this.workspaces.get(binding.workspaceId)
    const rootPath = binding.targetType === 'codywork-workspace' ? workspace.path : listDemands(this.database, workspace).find(item => item.id === binding.demandId)?.path
    if (!rootPath) return
    const root = await realpath(rootPath).catch(() => '')
    if (!root) return
    const inbox = this.repositories.inbox.get(inboxId)
    const source = inbox.message as typeof inbox.message & CodyWorkInboundMessage
    const replyMessageId = source.replyMessageId || inbox.message.messageId
    const paths = await this.channelImagePaths(root, projection.assistantImages)
    for (const [index, path] of paths.entries()) {
      await this.hooks.enqueue(binding.accountId, {
        kind: 'send_local_image', targetId: binding.channelConversationId,
        payload: { path, root, ...(inbox.message.conversation.scope === 'topic' ? { replyMessageId, replyInThread: true } : {}) },
        dedupeKey: `${presentation.id}:image:${index}`, terminal: true,
      })
    }
  }

  private async channelImagePaths(root: string, candidates: string[]): Promise<string[]> {
    const paths: string[] = []
    for (const candidate of [...new Set(candidates)]) {
      if (!isAbsolute(candidate) || !FEISHU_IMAGE_EXTENSIONS.has(extname(candidate).toLowerCase())) continue
      const path = await realpath(candidate).catch(() => '')
      if (!path || !await this.isAllowedImage(path, root)) continue
      paths.push(path)
    }
    return paths
  }

  async isAllowedImage(path: string, root: string): Promise<boolean> {
    if (!isAbsolute(path) || !isAbsolute(root) || !FEISHU_IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return false
    const [realRoot, realPath] = await Promise.all([realpath(root).catch(() => ''), realpath(path).catch(() => '')])
    if (!realRoot || !realPath) return false
    const inside = relative(realRoot, realPath)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) return false
    return stat(realPath).then(metadata => metadata.isFile() && metadata.size > 0 && metadata.size <= 10 * 1024 * 1024).catch(() => false)
  }

  async recoverBindings(accountId: string): Promise<void> {
    await Promise.all(this.repositories.bindings.list(accountId).map(async binding => {
      try { await this.observe(binding) } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.repositories.audit.record(accountId, 'channel.binding.recovery_failed', 'channel_binding', binding.id, false, {}, message)
      }
    }))
  }

  async reconcileDeliveredPresentations(accountId: string): Promise<void> {
    if (!this.hooks.isAccountActive(accountId)) return
    const rows = this.database.db.prepare("SELECT id, state_json FROM channel_presentations WHERE account_id = ? AND remote_message_id IS NULL AND terminal = 0").all(accountId) as Array<{ id: string; state_json: string }>
    for (const row of rows) {
      const state = JSON.parse(String(row.state_json || '{}')) as Record<string, unknown>
      const outboxId = string(state.outboxId)
      if (!outboxId) continue
      const outbox = this.repositories.outbox.get(outboxId)
      if (!outbox.remoteMessageId) continue
      const presentation = this.repositories.projections.updatePresentation(row.id, { remoteMessageId: outbox.remoteMessageId, status: 'sent' })
      const pendingFailureCard = record(state.pendingFailureCard) as FeishuCard
      if (Object.keys(pendingFailureCard).length > 0) {
        await this.hooks.queue(accountId, { kind: 'update_card', targetId: outbox.remoteMessageId, payload: { card: pendingFailureCard }, dedupeKey: `${presentation.id}:command-failed`, terminal: true })
        this.repositories.projections.updatePresentation(presentation.id, { remoteMessageId: outbox.remoteMessageId, status: 'failed', terminal: true, state })
        continue
      }
      const linkRow = this.database.db.prepare('SELECT turn_id, binding_id FROM channel_turn_links WHERE id = ?').get(presentation.turnLinkId) as { turn_id?: string; binding_id?: string } | undefined
      if (linkRow?.turn_id && linkRow.binding_id) this.scheduleRender(this.repositories.bindings.get(linkRow.binding_id), linkRow.turn_id, true)
    }
  }

  async reconcileActiveTurns(accountId: string): Promise<void> {
    await Promise.all(this.repositories.bindings.list(accountId).flatMap(binding => this.repositories.projections.activeTurns(binding.id).map(link => this.reconcileActiveTurn(binding, link.clientCommandId, link.turnId))))
  }

  private async reconcileActiveTurn(binding: CodyWorkChannelBinding, clientCommandId: string, knownTurnId: string): Promise<void> {
    const key = `${binding.id}:${clientCommandId}`
    if (this.reconciliationInFlight.has(key)) return
    this.reconciliationInFlight.add(key)
    try {
      const snapshot = await this.conversations.historyCanonical(binding.workspaceId, binding.conversationId)
      await this.host.refresh({ conversationId: binding.conversationId, threadId: binding.threadId, readSnapshot: async () => snapshot })
      const bound = snapshot.events.find(event => event.type === 'command.bound' && event.itemId === clientCommandId && event.turnId)
      const turnId = knownTurnId || bound?.turnId || ''
      if (!turnId) return
      const link = this.repositories.projections.turnByCommand(clientCommandId)
      if (link && !link.turnId) {
        this.repositories.projections.updateTurnLink(clientCommandId, { turnId, status: 'running' })
        this.repositories.inbox.update(link.inboxId, 'submitted', { turnId })
      }
      this.scheduleRender(binding, turnId, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repositories.audit.record(binding.accountId, 'channel.turn.reconcile_failed', 'channel_binding', binding.id, false, { clientCommandId }, message)
    } finally {
      this.reconciliationInFlight.delete(key)
    }
  }
}
