import type { ChannelBinding, ChannelInboundMessage, ChannelInboxItem, ChannelInboxStatus, ChannelOutboxItem, ChannelOutboxStore } from '@codycodeagent/cody-web-core/channel'
import { channelConversationKey } from '@codycodeagent/cody-web-core/channel'
import { makeId, nowIso, type WorkbenchDb } from '../db/index.js'
import { openChannelCredential, sealChannelCredential } from './channelCredentials.js'
import type { FeishuConnectionDiagnostic } from '@codycodeagent/cody-web-core/feishu'

export type ChannelAccountInput = {
  name: string
  appId: string
  appSecret?: string
  domain?: 'feishu' | 'lark'
  enabled?: boolean
  allowAllUsers?: boolean
  allowedUserIds?: string[]
  allowedConversationIds?: string[]
  groupMentionMode?: 'always' | 'bound'
  privateConversationMode?: 'topic' | 'chat'
}

export type ChannelAccount = {
  id: string
  provider: 'feishu'
  name: string
  appId: string
  appSecretConfigured: boolean
  domain: 'feishu' | 'lark'
  enabled: boolean
  allowAllUsers: boolean
  allowedUserIds: string[]
  allowedConversationIds: string[]
  groupMentionMode: 'always' | 'bound'
  privateConversationMode: 'topic' | 'chat'
  botOpenId: string
  botName: string
  connectionState: string
  lastError: string
  lastCloseCode: number | null
  lastCloseReason: string
  lastDisconnectedAt: string | null
  reconnectAttempts: number
  nextReconnectAt: string | null
  connectedAt: string | null
  lastEventAt: string | null
  lastDeliveryAt: string | null
  createdAt: string
  updatedAt: string
}

export type ChannelAccountSecret = ChannelAccount & { appSecret: string }

type AccountRow = {
  id: string; provider: string; name: string; app_id: string; secret_cipher: string; domain: string; enabled: number
  allow_all_users: number; allowed_user_ids_json: string; allowed_conversation_ids_json: string
  group_mention_mode: string; private_conversation_mode: string; bot_open_id: string | null; bot_name: string | null
  connection_state: string; last_error: string | null; connected_at: string | null; last_event_at: string | null
  last_close_code: number | null; last_close_reason: string | null; last_disconnected_at: string | null
  reconnect_attempts: number; next_reconnect_at: string | null
  last_delivery_at: string | null; created_at: string; updated_at: string
}

type BindingRow = {
  id: string; provider: string; account_id: string; conversation_key: string; channel_conversation_id: string
  channel_scope: string; channel_root_id: string | null; target_type: string; target_id: string; thread_id: string
  owner_identity: string; workspace_id: string; demand_id: string | null; conversation_id: string; conversation_title?: string | null; created_at: string; updated_at: string
}

type InboxRow = {
  id: string; message_json: string; conversation_key: string; status: string; binding_id: string | null
  client_command_id: string | null; turn_id: string | null; last_error: string | null; created_at: string; updated_at: string
}

export type ChannelActionClaim = {
  id: string
  created: boolean
  status: string
}

type OutboxRow = {
  id: string; provider: string; account_id: string; kind: string; target_id: string; payload_json: string
  dedupe_key: string; status: string; attempts: number; available_at: string; lease_expires_at: string | null
  remote_message_id: string | null; revision: number | null; terminal: number; last_error: string | null
  created_at: string; updated_at: string
}

export type ChannelFailedDelivery = {
  id: string
  kind: string
  targetId: string
  status: 'retry_wait' | 'dead_letter'
  attempts: number
  lastError: string
  updatedAt: string
}

export type CodyWorkChannelBinding = ReturnType<typeof toBinding>

export type ChannelPresentation = {
  id: string
  accountId: string
  bindingId: string
  turnLinkId: string
  purpose: string
  remoteMessageId: string
  status: string
  revision: number
  terminal: boolean
  state: Record<string, unknown>
}

export type ChannelInteractiveRequest = {
  id: string
  accountId: string
  bindingId: string
  requestKey: string
  requestId: string
  turnId: string
  kind: 'approval' | 'question'
  remoteMessageId: string
  requesterIdentity: string
  status: string
  request: Record<string, unknown>
}

export type ChannelTurnLink = {
  id: string
  inboxId: string
  bindingId: string
  clientCommandId: string
  turnId: string
  status: string
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))].slice(0, 500) : []
}

function parseStringList(value: string): string[] {
  try { return stringList(JSON.parse(value) as unknown) } catch { return [] }
}

function toAccount(row: AccountRow): ChannelAccount {
  return {
    id: row.id, provider: 'feishu', name: row.name, appId: row.app_id, appSecretConfigured: Boolean(row.secret_cipher),
    domain: row.domain === 'lark' ? 'lark' : 'feishu', enabled: Boolean(row.enabled), allowAllUsers: Boolean(row.allow_all_users),
    allowedUserIds: parseStringList(row.allowed_user_ids_json), allowedConversationIds: parseStringList(row.allowed_conversation_ids_json),
    groupMentionMode: row.group_mention_mode === 'bound' ? 'bound' : 'always', privateConversationMode: row.private_conversation_mode === 'topic' ? 'topic' : 'chat',
    botOpenId: row.bot_open_id ?? '', botName: row.bot_name ?? '', connectionState: row.connection_state,
    lastError: row.last_error ?? '', lastCloseCode: row.last_close_code, lastCloseReason: row.last_close_reason ?? '',
    lastDisconnectedAt: row.last_disconnected_at, reconnectAttempts: row.reconnect_attempts, nextReconnectAt: row.next_reconnect_at,
    connectedAt: row.connected_at, lastEventAt: row.last_event_at, lastDeliveryAt: row.last_delivery_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toBinding(row: BindingRow): ChannelBinding & { targetType: 'codywork-demand' | 'codywork-workspace'; workspaceId: string; demandId: string | null; conversationId: string; conversationTitle: string; channelConversationId: string; channelScope: string; channelRootId: string } {
  return {
    id: row.id, provider: row.provider, accountId: row.account_id, conversationKey: row.conversation_key,
    targetType: row.target_type === 'codywork-workspace' ? 'codywork-workspace' : 'codywork-demand', targetId: row.target_id, threadId: row.thread_id, ownerIdentity: row.owner_identity,
    createdAtIso: row.created_at, updatedAtIso: row.updated_at, workspaceId: row.workspace_id, demandId: row.demand_id,
    conversationTitle: row.conversation_title ?? '未命名会话',
    conversationId: row.conversation_id, channelConversationId: row.channel_conversation_id, channelScope: row.channel_scope,
    channelRootId: row.channel_root_id ?? '',
  }
}

function toInbox(row: InboxRow): ChannelInboxItem {
  return {
    id: row.id, message: JSON.parse(row.message_json) as ChannelInboundMessage, conversationKey: row.conversation_key,
    status: row.status as ChannelInboxStatus, ...(row.binding_id ? { bindingId: row.binding_id } : {}),
    ...(row.client_command_id ? { clientCommandId: row.client_command_id } : {}), ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}), createdAtIso: row.created_at, updatedAtIso: row.updated_at,
  }
}

function toOutbox(row: OutboxRow): ChannelOutboxItem {
  return {
    id: row.id, provider: row.provider, accountId: row.account_id, kind: row.kind, targetId: row.target_id,
    payload: JSON.parse(row.payload_json) as unknown, dedupeKey: row.dedupe_key, status: row.status as ChannelOutboxItem['status'],
    attempts: row.attempts, availableAtIso: row.available_at, ...(row.lease_expires_at ? { leaseExpiresAtIso: row.lease_expires_at } : {}),
    ...(row.remote_message_id ? { remoteMessageId: row.remote_message_id } : {}), ...(row.revision === null ? {} : { revision: row.revision }),
    terminal: Boolean(row.terminal), ...(row.last_error ? { lastError: row.last_error } : {}),
  }
}

export class ChannelStore implements ChannelOutboxStore {
  constructor(private readonly database: WorkbenchDb) {}

  validateAccountInput(id: string | null, input: ChannelAccountInput): void {
    const name = input.name.trim()
    const appId = input.appId.trim()
    if (!name) throw new Error('机器人名称不能为空')
    if (!/^cli_[A-Za-z0-9_-]+$/u.test(appId)) throw new Error('App ID 格式无效')
    const users = stringList(input.allowedUserIds)
    if (input.allowAllUsers !== true && input.enabled && users.length === 0) {
      throw new Error('启用机器人前至少配置一个允许用户，或明确允许所有用户')
    }
    if (id) this.getAccount(id)
    else {
      if (this.listAccounts().length > 0) throw new Error('一期只支持一个 CodyWork 飞书机器人；请更新或删除现有配置')
      if (!input.appSecret?.trim()) throw new Error('App Secret 不能为空')
    }
  }

  listAccounts(): ChannelAccount[] {
    return (this.database.db.prepare('SELECT * FROM channel_accounts ORDER BY created_at').all() as unknown as AccountRow[]).map(toAccount)
  }

  getAccount(id: string): ChannelAccountSecret {
    const row = this.database.db.prepare('SELECT * FROM channel_accounts WHERE id = ?').get(id) as AccountRow | undefined
    if (!row) throw new Error('飞书机器人不存在')
    return { ...toAccount(row), appSecret: openChannelCredential(row.secret_cipher, row.id, this.database.path) }
  }

  saveAccount(id: string | null, input: ChannelAccountInput): ChannelAccount {
    this.validateAccountInput(id, input)
    const name = input.name.trim(); const appId = input.appId.trim(); const now = nowIso()
    const users = stringList(input.allowedUserIds); const conversations = stringList(input.allowedConversationIds)
    if (!id) {
      const accountId = makeId('channel')
      const secret = input.appSecret?.trim() ?? ''
      this.database.db.prepare(`INSERT INTO channel_accounts (
        id, provider, name, app_id, secret_cipher, domain, enabled, allow_all_users, allowed_user_ids_json,
        allowed_conversation_ids_json, group_mention_mode, private_conversation_mode, connection_state, created_at, updated_at
      ) VALUES (?, 'feishu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`)
        .run(accountId, name, appId, sealChannelCredential(secret, accountId, this.database.path), input.domain === 'lark' ? 'lark' : 'feishu', input.enabled ? 1 : 0,
          input.allowAllUsers ? 1 : 0, JSON.stringify(users), JSON.stringify(conversations), input.groupMentionMode === 'bound' ? 'bound' : 'always',
          input.privateConversationMode === 'topic' ? 'topic' : 'chat', now, now)
      return toAccount(this.database.db.prepare('SELECT * FROM channel_accounts WHERE id = ?').get(accountId) as AccountRow)
    }
    const current = this.getAccount(id)
    const secretCipher = input.appSecret?.trim() ? sealChannelCredential(input.appSecret.trim(), id, this.database.path)
      : (this.database.db.prepare('SELECT secret_cipher FROM channel_accounts WHERE id = ?').get(id) as { secret_cipher: string }).secret_cipher
    this.database.db.prepare(`UPDATE channel_accounts SET name = ?, app_id = ?, secret_cipher = ?, domain = ?, enabled = ?, allow_all_users = ?,
      allowed_user_ids_json = ?, allowed_conversation_ids_json = ?, group_mention_mode = ?, private_conversation_mode = ?,
      bot_open_id = CASE WHEN app_id = ? THEN bot_open_id ELSE NULL END, bot_name = CASE WHEN app_id = ? THEN bot_name ELSE NULL END,
      connection_state = CASE WHEN app_id = ? THEN connection_state ELSE 'idle' END, last_error = NULL,
      last_close_code = CASE WHEN app_id = ? THEN last_close_code ELSE NULL END,
      last_close_reason = CASE WHEN app_id = ? THEN last_close_reason ELSE NULL END,
      last_disconnected_at = CASE WHEN app_id = ? THEN last_disconnected_at ELSE NULL END,
      reconnect_attempts = CASE WHEN app_id = ? THEN reconnect_attempts ELSE 0 END,
      next_reconnect_at = CASE WHEN app_id = ? THEN next_reconnect_at ELSE NULL END,
      updated_at = ? WHERE id = ?`)
      .run(name, appId, secretCipher, input.domain === 'lark' ? 'lark' : 'feishu', input.enabled ? 1 : 0, input.allowAllUsers ? 1 : 0,
        JSON.stringify(users), JSON.stringify(conversations), input.groupMentionMode === 'bound' ? 'bound' : 'always', input.privateConversationMode === 'topic' ? 'topic' : 'chat',
        current.appId, current.appId, current.appId, current.appId, current.appId, current.appId, current.appId, current.appId, now, id)
    return toAccount(this.database.db.prepare('SELECT * FROM channel_accounts WHERE id = ?').get(id) as AccountRow)
  }

  restoreAccount(account: ChannelAccountSecret): void {
    const result = this.database.db.prepare(`UPDATE channel_accounts SET
      name = ?, app_id = ?, secret_cipher = ?, domain = ?, enabled = ?, allow_all_users = ?,
      allowed_user_ids_json = ?, allowed_conversation_ids_json = ?, group_mention_mode = ?, private_conversation_mode = ?,
      bot_open_id = ?, bot_name = ?, connection_state = ?, last_error = ?, connected_at = ?, last_event_at = ?,
      last_delivery_at = ?, last_close_code = ?, last_close_reason = ?, last_disconnected_at = ?, reconnect_attempts = ?,
      next_reconnect_at = ?, updated_at = ? WHERE id = ?`)
      .run(account.name, account.appId, sealChannelCredential(account.appSecret, account.id, this.database.path), account.domain,
        account.enabled ? 1 : 0, account.allowAllUsers ? 1 : 0, JSON.stringify(account.allowedUserIds),
        JSON.stringify(account.allowedConversationIds), account.groupMentionMode, account.privateConversationMode,
        account.botOpenId || null, account.botName || null, account.connectionState, account.lastError || null,
        account.connectedAt, account.lastEventAt, account.lastDeliveryAt, account.lastCloseCode, account.lastCloseReason || null,
        account.lastDisconnectedAt, account.reconnectAttempts, account.nextReconnectAt, account.updatedAt, account.id)
    if (result.changes === 0) throw new Error('飞书机器人不存在')
  }

  deleteAccount(id: string): void {
    const result = this.database.db.prepare('DELETE FROM channel_accounts WHERE id = ?').run(id)
    if (result.changes === 0) throw new Error('飞书机器人不存在')
  }

  updateRuntime(id: string, input: { connectionState?: string; error?: string; botOpenId?: string; botName?: string; connected?: boolean; event?: boolean; delivery?: boolean; connectionDiagnostic?: FeishuConnectionDiagnostic }): void {
    const now = nowIso()
    this.database.db.prepare(`UPDATE channel_accounts SET connection_state = COALESCE(?, connection_state),
      last_error = CASE WHEN ? THEN ? ELSE last_error END,
      bot_open_id = COALESCE(?, bot_open_id), bot_name = COALESCE(?, bot_name),
      connected_at = CASE WHEN ? THEN ? ELSE connected_at END, last_event_at = CASE WHEN ? THEN ? ELSE last_event_at END,
      last_delivery_at = CASE WHEN ? THEN ? ELSE last_delivery_at END, updated_at = ? WHERE id = ?`)
      .run(input.connectionState ?? null, input.error !== undefined ? 1 : 0, input.error?.slice(0, 1_000) || null, input.botOpenId || null, input.botName || null,
        input.connected ? 1 : 0, now, input.event ? 1 : 0, now, input.delivery ? 1 : 0, now, now, id)
    const diagnostic = input.connectionDiagnostic
    if (diagnostic) {
      const disconnected = diagnostic.state === 'reconnecting' || diagnostic.state === 'failed'
      this.database.db.prepare(`UPDATE channel_accounts SET reconnect_attempts = ?, next_reconnect_at = ?,
        last_close_code = CASE WHEN ? THEN ? ELSE last_close_code END,
        last_close_reason = CASE WHEN ? THEN ? ELSE last_close_reason END,
        last_disconnected_at = CASE WHEN ? THEN ? ELSE last_disconnected_at END WHERE id = ?`)
        .run(diagnostic.reconnectAttempts, diagnostic.nextConnectAtIso, disconnected ? 1 : 0, diagnostic.closeCode,
          disconnected ? 1 : 0, diagnostic.closeReason.slice(0, 1_000) || null,
          disconnected ? 1 : 0, diagnostic.atIso, id)
    }
  }

  findBinding(accountId: string, conversationKey: string) {
    const row = this.database.db.prepare('SELECT channel_bindings.*, conversations.title AS conversation_title FROM channel_bindings JOIN conversations ON conversations.id = channel_bindings.conversation_id WHERE channel_bindings.account_id = ? AND channel_bindings.conversation_key = ?').get(accountId, conversationKey) as BindingRow | undefined
    return row ? toBinding(row) : null
  }

  getBinding(id: string): CodyWorkChannelBinding {
    const row = this.database.db.prepare('SELECT channel_bindings.*, conversations.title AS conversation_title FROM channel_bindings JOIN conversations ON conversations.id = channel_bindings.conversation_id WHERE channel_bindings.id = ?').get(id) as BindingRow | undefined
    if (!row) throw new Error('飞书绑定不存在')
    return toBinding(row)
  }

  listBindings(accountId: string) {
    return (this.database.db.prepare('SELECT channel_bindings.*, conversations.title AS conversation_title FROM channel_bindings JOIN conversations ON conversations.id = channel_bindings.conversation_id WHERE channel_bindings.account_id = ? ORDER BY channel_bindings.updated_at DESC').all(accountId) as unknown as BindingRow[]).map(toBinding)
  }

  listBindingsForConversation(conversationId: string) {
    return (this.database.db.prepare('SELECT channel_bindings.*, conversations.title AS conversation_title FROM channel_bindings JOIN conversations ON conversations.id = channel_bindings.conversation_id WHERE channel_bindings.conversation_id = ? ORDER BY channel_bindings.updated_at DESC').all(conversationId) as unknown as BindingRow[]).map(toBinding)
  }

  listBindingsForDemand(workspaceId: string, demandId: string) {
    return (this.database.db.prepare('SELECT channel_bindings.*, conversations.title AS conversation_title FROM channel_bindings JOIN conversations ON conversations.id = channel_bindings.conversation_id WHERE channel_bindings.workspace_id = ? AND channel_bindings.demand_id = ? ORDER BY channel_bindings.updated_at DESC').all(workspaceId, demandId) as unknown as BindingRow[]).map(toBinding)
  }

  hasBindingForConversation(conversationId: string): boolean {
    return Boolean(this.database.db.prepare('SELECT 1 FROM channel_bindings WHERE conversation_id = ? LIMIT 1').get(conversationId))
  }

  createBinding(input: { message: ChannelInboundMessage; targetType: 'codywork-demand' | 'codywork-workspace'; workspaceId: string; demandId: string | null; conversationId: string; threadId: string; ownerIdentity: string }): ReturnType<typeof toBinding> {
    const key = channelConversationKey(input.message); const now = nowIso(); const id = makeId('binding')
    if (input.targetType === 'codywork-demand' && !input.demandId) throw new Error('Demand 绑定缺少需求')
    if (input.targetType === 'codywork-workspace' && input.demandId) throw new Error('Workspace 绑定不能关联 Demand')
    const targetId = input.targetType === 'codywork-workspace' ? input.workspaceId : input.demandId!
    this.database.db.prepare(`INSERT INTO channel_bindings (
      id, provider, account_id, conversation_key, channel_conversation_id, channel_scope, channel_root_id,
      target_type, target_id, thread_id, owner_identity, workspace_id, demand_id, conversation_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, account_id, conversation_key) DO UPDATE SET target_type = excluded.target_type, target_id = excluded.target_id, thread_id = excluded.thread_id,
      owner_identity = excluded.owner_identity, workspace_id = excluded.workspace_id, demand_id = excluded.demand_id,
      conversation_id = excluded.conversation_id, updated_at = excluded.updated_at`)
      .run(id, input.message.provider, input.message.accountId, key, input.message.conversation.id, input.message.conversation.scope,
        input.message.conversation.rootId ?? null, input.targetType, targetId, input.threadId, input.ownerIdentity, input.workspaceId, input.demandId, input.conversationId, now, now)
    return this.findBinding(input.message.accountId, key)!
  }

  deleteBinding(accountId: string, conversationKey: string): boolean {
    return this.database.db.prepare('DELETE FROM channel_bindings WHERE account_id = ? AND conversation_key = ?').run(accountId, conversationKey).changes > 0
  }

  deleteBindingById(accountId: string, bindingId: string): CodyWorkChannelBinding | null {
    const binding = this.database.db.prepare('SELECT * FROM channel_bindings WHERE id = ? AND account_id = ?').get(bindingId, accountId) as BindingRow | undefined
    if (!binding) return null
    this.database.db.prepare('DELETE FROM channel_bindings WHERE id = ? AND account_id = ?').run(bindingId, accountId)
    return toBinding(binding)
  }

  claimInbound(message: ChannelInboundMessage): { item: ChannelInboxItem; created: boolean } {
    const id = makeId('inbox'); const now = nowIso(); const key = channelConversationKey(message)
    const result = this.database.db.prepare(`INSERT OR IGNORE INTO channel_inbox (
      id, provider, account_id, external_event_id, external_message_id, conversation_key, message_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`)
      .run(id, message.provider, message.accountId, message.eventId, message.messageId, key, JSON.stringify(message), now, now)
    const row = this.database.db.prepare(`SELECT id, message_json, conversation_key, status, binding_id, client_command_id, turn_id, last_error, created_at, updated_at
      FROM channel_inbox WHERE provider = ? AND account_id = ? AND (external_event_id = ? OR external_message_id = ?)
      ORDER BY CASE WHEN external_event_id = ? THEN 0 ELSE 1 END LIMIT 1`)
      .get(message.provider, message.accountId, message.eventId, message.messageId, message.eventId) as InboxRow | undefined
    if (!row) throw new Error('入站消息去重记录不存在')
    return { item: toInbox(row), created: result.changes > 0 }
  }

  /**
   * Claims a Feishu card action before any external side effect. Action rows
   * intentionally live in the durable Inbox table, but use their own statuses
   * so message recovery can never submit them as Codex prompts.
   */
  claimAction(accountId: string, eventId: string, payload: unknown): ChannelActionClaim {
    const id = makeId('action'); const now = nowIso(); const externalId = `action:${eventId}`
    const result = this.database.db.prepare(`INSERT OR IGNORE INTO channel_inbox (
      id, provider, account_id, external_event_id, external_message_id, conversation_key, message_json, status, created_at, updated_at
    ) VALUES (?, 'feishu', ?, ?, ?, ?, ?, 'action_processing', ?, ?)`)
      .run(id, accountId, externalId, externalId, externalId, JSON.stringify(payload ?? {}), now, now)
    const row = this.database.db.prepare('SELECT id, status FROM channel_inbox WHERE provider = \'feishu\' AND account_id = ? AND external_event_id = ?')
      .get(accountId, externalId) as { id: string; status: string } | undefined
    if (!row) throw new Error('卡片操作去重记录不存在')
    return { id: row.id, status: row.status, created: result.changes > 0 }
  }

  finishAction(id: string, status: 'action_completed' | 'action_failed', error = ''): boolean {
    const result = this.database.db.prepare(`UPDATE channel_inbox SET status = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'action_processing'`)
      .run(status, error.slice(0, 1_000) || null, nowIso(), id)
    return result.changes > 0
  }

  getInbox(id: string): ChannelInboxItem {
    const row = this.database.db.prepare('SELECT id, message_json, conversation_key, status, binding_id, client_command_id, turn_id, last_error, created_at, updated_at FROM channel_inbox WHERE id = ?').get(id) as InboxRow | undefined
    if (!row) throw new Error('入站消息不存在')
    return toInbox(row)
  }

  updateInbox(id: string, status: ChannelInboxStatus, patch: { bindingId?: string | null; clientCommandId?: string; turnId?: string; lastError?: string | null } = {}): ChannelInboxItem {
    this.database.db.prepare(`UPDATE channel_inbox SET status = ?, binding_id = COALESCE(?, binding_id), client_command_id = COALESCE(?, client_command_id),
      turn_id = COALESCE(?, turn_id), last_error = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?`)
      .run(status, patch.bindingId ?? null, patch.clientCommandId ?? null, patch.turnId ?? null, patch.lastError ?? null, nowIso(), id)
    return this.getInbox(id)
  }

  pendingInbox(accountId: string): ChannelInboxItem[] {
    const rows = this.database.db.prepare(`SELECT id, message_json, conversation_key, status, binding_id, client_command_id, turn_id, last_error, created_at, updated_at
      FROM channel_inbox WHERE account_id = ? AND status IN ('received','ready','submitting','submitted') ORDER BY created_at`).all(accountId) as unknown as InboxRow[]
    return rows.map(toInbox)
  }

  latestFailedInbox(accountId: string, conversationKey: string): ChannelInboxItem | null {
    const row = this.database.db.prepare(`SELECT id, message_json, conversation_key, status, binding_id, client_command_id, turn_id, last_error, created_at, updated_at
      FROM channel_inbox WHERE account_id = ? AND conversation_key = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 1`).get(accountId, conversationKey) as InboxRow | undefined
    return row ? toInbox(row) : null
  }

  getOutbox(id: string): ChannelOutboxItem {
    const row = this.database.db.prepare('SELECT * FROM channel_outbox WHERE id = ?').get(id) as OutboxRow | undefined
    if (!row) throw new Error('投递不存在')
    return toOutbox(row)
  }

  createTurnLink(input: { inboxId: string; bindingId: string; clientCommandId: string }): string {
    const id = makeId('turnlink'); const now = nowIso()
    this.database.db.prepare(`INSERT INTO channel_turn_links (id, inbox_id, binding_id, client_command_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'submitting', ?, ?) ON CONFLICT(client_command_id) DO NOTHING`)
      .run(id, input.inboxId, input.bindingId, input.clientCommandId, now, now)
    const row = this.database.db.prepare('SELECT id FROM channel_turn_links WHERE client_command_id = ?').get(input.clientCommandId) as { id: string }
    return row.id
  }

  updateTurnLink(clientCommandId: string, patch: { turnId?: string; status: string }): void {
    this.database.db.prepare('UPDATE channel_turn_links SET turn_id = COALESCE(?, turn_id), status = ?, updated_at = ? WHERE client_command_id = ?')
      .run(patch.turnId ?? null, patch.status, nowIso(), clientCommandId)
  }

  getTurnLinkByCommand(clientCommandId: string): ChannelTurnLink | null {
    const row = this.database.db.prepare('SELECT * FROM channel_turn_links WHERE client_command_id = ?').get(clientCommandId) as Record<string, unknown> | undefined
    return row ? { id: String(row.id), inboxId: String(row.inbox_id), bindingId: String(row.binding_id), clientCommandId: String(row.client_command_id), turnId: String(row.turn_id ?? ''), status: String(row.status) } : null
  }

  getTurnLinkByTurn(bindingId: string, turnId: string): ChannelTurnLink | null {
    const row = this.database.db.prepare('SELECT * FROM channel_turn_links WHERE binding_id = ? AND turn_id = ?').get(bindingId, turnId) as Record<string, unknown> | undefined
    return row ? { id: String(row.id), inboxId: String(row.inbox_id), bindingId: String(row.binding_id), clientCommandId: String(row.client_command_id), turnId: String(row.turn_id ?? ''), status: String(row.status) } : null
  }

  getTurnLinkByConversationTurn(conversationId: string, turnId: string): ChannelTurnLink | null {
    const row = this.database.db.prepare(`SELECT links.* FROM channel_turn_links AS links
      JOIN channel_bindings AS bindings ON bindings.id = links.binding_id
      WHERE bindings.conversation_id = ? AND links.turn_id = ?
      ORDER BY links.created_at LIMIT 1`).get(conversationId, turnId) as Record<string, unknown> | undefined
    return row ? { id: String(row.id), inboxId: String(row.inbox_id), bindingId: String(row.binding_id), clientCommandId: String(row.client_command_id), turnId: String(row.turn_id ?? ''), status: String(row.status) } : null
  }

  listActiveTurnLinks(bindingId: string): ChannelTurnLink[] {
    const rows = this.database.db.prepare("SELECT * FROM channel_turn_links WHERE binding_id = ? AND status IN ('submitting','submitted','running') ORDER BY created_at").all(bindingId) as Array<Record<string, unknown>>
    return rows.map(row => ({ id: String(row.id), inboxId: String(row.inbox_id), bindingId: String(row.binding_id), clientCommandId: String(row.client_command_id), turnId: String(row.turn_id ?? ''), status: String(row.status) }))
  }

  createPresentation(input: { accountId: string; bindingId: string; turnLinkId?: string; purpose: string; state?: Record<string, unknown> }): ChannelPresentation {
    const id = makeId('presentation'); const now = nowIso()
    this.database.db.prepare(`INSERT INTO channel_presentations (id, account_id, binding_id, turn_link_id, purpose, status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(id, input.accountId, input.bindingId, input.turnLinkId ?? null, input.purpose, JSON.stringify(input.state ?? {}), now, now)
    return this.getPresentation(id)
  }

  getPresentation(id: string): ChannelPresentation {
    const row = this.database.db.prepare('SELECT * FROM channel_presentations WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('飞书展示记录不存在')
    return {
      id: String(row.id), accountId: String(row.account_id), bindingId: String(row.binding_id), turnLinkId: String(row.turn_link_id ?? ''),
      purpose: String(row.purpose), remoteMessageId: String(row.remote_message_id ?? ''), status: String(row.status),
      revision: Number(row.revision), terminal: Boolean(row.terminal), state: JSON.parse(String(row.state_json || '{}')) as Record<string, unknown>,
    }
  }

  updatePresentation(id: string, patch: { remoteMessageId?: string; status?: string; revision?: number; terminal?: boolean; state?: Record<string, unknown> }): ChannelPresentation {
    const current = this.getPresentation(id)
    this.database.db.prepare(`UPDATE channel_presentations SET remote_message_id = ?, status = ?, revision = ?, terminal = ?, state_json = ?, updated_at = ? WHERE id = ?`)
      .run((patch.remoteMessageId ?? current.remoteMessageId) || null, patch.status ?? current.status, patch.revision ?? current.revision,
        patch.terminal ?? current.terminal ? 1 : 0, JSON.stringify(patch.state ?? current.state), nowIso(), id)
    return this.getPresentation(id)
  }

  saveInteractiveRequest(input: { accountId: string; bindingId: string; requestKey: string; requestId: string; turnId: string; kind: 'approval' | 'question'; requesterIdentity: string; request: Record<string, unknown> }): ChannelInteractiveRequest {
    const id = makeId('request'); const now = nowIso()
    this.database.db.prepare(`INSERT INTO channel_interactive_requests (id, account_id, binding_id, request_key, request_id, turn_id, kind, requester_identity, status, request_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(account_id, request_key) DO NOTHING`)
      .run(id, input.accountId, input.bindingId, input.requestKey, input.requestId, input.turnId, input.kind, input.requesterIdentity, JSON.stringify(input.request), now, now)
    return this.getInteractiveRequestByKey(input.accountId, input.requestKey)
  }

  /** Legacy/raw request-id lookup used by the text /answer command and cards
   * sent by an older deployment. Prefer the newest pending row because native
   * request counters restart with App Server. */
  getInteractiveRequest(accountId: string, requestId: string): ChannelInteractiveRequest {
    const row = this.database.db.prepare("SELECT * FROM channel_interactive_requests WHERE account_id = ? AND request_id = ? ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").get(accountId, requestId) as Record<string, unknown> | undefined
    if (!row) throw new Error('交互请求不存在或已过期')
    return this.toInteractiveRequest(row)
  }

  getInteractiveRequestById(accountId: string, id: string): ChannelInteractiveRequest {
    const row = this.database.db.prepare('SELECT * FROM channel_interactive_requests WHERE account_id = ? AND id = ?').get(accountId, id) as Record<string, unknown> | undefined
    if (!row) throw new Error('交互请求不存在或已过期')
    return this.toInteractiveRequest(row)
  }

  private getInteractiveRequestByKey(accountId: string, requestKey: string): ChannelInteractiveRequest {
    const row = this.database.db.prepare('SELECT * FROM channel_interactive_requests WHERE account_id = ? AND request_key = ?').get(accountId, requestKey) as Record<string, unknown> | undefined
    if (!row) throw new Error('交互请求不存在或已过期')
    return this.toInteractiveRequest(row)
  }

  private toInteractiveRequest(row: Record<string, unknown>): ChannelInteractiveRequest {
    return {
      id: String(row.id), accountId: String(row.account_id), bindingId: String(row.binding_id), requestKey: String(row.request_key),
      requestId: String(row.request_id), turnId: String(row.turn_id ?? ''),
      kind: row.kind === 'question' ? 'question' : 'approval', remoteMessageId: String(row.remote_message_id ?? ''),
      requesterIdentity: String(row.requester_identity), status: String(row.status), request: JSON.parse(String(row.request_json || '{}')) as Record<string, unknown>,
    }
  }

  getInteractiveRequestByConversation(conversationId: string, requestId: string, turnId = ''): ChannelInteractiveRequest | null {
    const row = this.database.db.prepare(`SELECT requests.* FROM channel_interactive_requests AS requests
      JOIN channel_bindings AS bindings ON bindings.id = requests.binding_id
      WHERE bindings.conversation_id = ? AND requests.request_id = ? AND (? = '' OR requests.turn_id = ?)
      ORDER BY CASE WHEN requests.status = 'pending' THEN 0 ELSE 1 END, requests.created_at DESC LIMIT 1`).get(conversationId, requestId, turnId, turnId) as Record<string, unknown> | undefined
    if (!row) return null
    return this.toInteractiveRequest(row)
  }

  listInteractiveRequestsByConversation(conversationId: string, requestId: string, turnId = ''): ChannelInteractiveRequest[] {
    const rows = this.database.db.prepare(`SELECT requests.* FROM channel_interactive_requests AS requests
      JOIN channel_bindings AS bindings ON bindings.id = requests.binding_id
      WHERE bindings.conversation_id = ? AND requests.request_id = ? AND (? = '' OR requests.turn_id = ?)
      ORDER BY requests.created_at DESC`).all(conversationId, requestId, turnId, turnId) as Array<Record<string, unknown>>
    return rows.map(row => this.toInteractiveRequest(row))
  }

  listPendingInteractiveRequestsForTurn(conversationId: string, turnId: string): ChannelInteractiveRequest[] {
    const rows = this.database.db.prepare(`SELECT requests.* FROM channel_interactive_requests AS requests
      JOIN channel_bindings AS bindings ON bindings.id = requests.binding_id
      WHERE bindings.conversation_id = ? AND requests.turn_id = ? AND requests.status = 'pending'
      ORDER BY requests.created_at`).all(conversationId, turnId) as Array<Record<string, unknown>>
    return rows.map(row => this.toInteractiveRequest(row))
  }

  updateInteractiveRequest(accountId: string, id: string, patch: { status: string; remoteMessageId?: string }): void {
    this.database.db.prepare('UPDATE channel_interactive_requests SET status = ?, remote_message_id = COALESCE(?, remote_message_id), updated_at = ? WHERE account_id = ? AND id = ?')
      .run(patch.status, patch.remoteMessageId ?? null, nowIso(), accountId, id)
  }

  async enqueue(input: Parameters<ChannelOutboxStore['enqueue']>[0]): Promise<ChannelOutboxItem> {
    const now = nowIso()
    this.database.db.prepare(`INSERT OR IGNORE INTO channel_outbox (
      id, provider, account_id, kind, target_id, payload_json, dedupe_key, status, attempts, available_at, revision, terminal, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`)
      .run(input.id, input.provider, input.accountId, input.kind, input.targetId, JSON.stringify(input.payload), input.dedupeKey,
        input.availableAtIso ?? now, input.revision ?? null, input.terminal ? 1 : 0, now, now)
    const row = this.database.db.prepare('SELECT * FROM channel_outbox WHERE provider = ? AND account_id = ? AND dedupe_key = ?').get(input.provider, input.accountId, input.dedupeKey) as OutboxRow
    return toOutbox(row)
  }

  async claim(input: Parameters<ChannelOutboxStore['claim']>[0]): Promise<ChannelOutboxItem[]> {
    const leaseUntil = new Date(Date.parse(input.nowIso) + input.leaseMs).toISOString()
    this.database.db.exec('BEGIN IMMEDIATE')
    try {
      const rows = this.database.db.prepare(`SELECT * FROM channel_outbox WHERE provider = ? AND account_id = ?
        AND ((status IN ('pending','retry_wait') AND available_at <= ?) OR (status IN ('leased','sending') AND lease_expires_at <= ?))
        ORDER BY available_at, created_at LIMIT ?`).all(input.provider, input.accountId, input.nowIso, input.nowIso, input.limit) as unknown as OutboxRow[]
      const claim = this.database.db.prepare("UPDATE channel_outbox SET status = 'leased', attempts = attempts + 1, lease_expires_at = ?, updated_at = ? WHERE id = ?")
      for (const row of rows) claim.run(leaseUntil, input.nowIso, row.id)
      this.database.db.exec('COMMIT')
      return rows.map(row => toOutbox({ ...row, status: 'leased', attempts: row.attempts + 1, lease_expires_at: leaseUntil }))
    } catch (error) {
      this.database.db.exec('ROLLBACK'); throw error
    }
  }

  async markSending(id: string): Promise<void> {
    const result = this.database.db.prepare("UPDATE channel_outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'leased'").run(nowIso(), id)
    if (result.changes === 0) throw new Error('投递 lease 已失效，不能开始发送')
  }

  async markSent(id: string, remoteMessageId?: string): Promise<void> {
    this.database.db.prepare("UPDATE channel_outbox SET status = 'sent', remote_message_id = COALESCE(?, remote_message_id), lease_expires_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?")
      .run(remoteMessageId ?? null, nowIso(), id)
  }

  async markRetry(id: string, error: string, availableAtIso: string): Promise<void> {
    this.database.db.prepare("UPDATE channel_outbox SET status = 'retry_wait', last_error = ?, available_at = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?")
      .run(error.slice(0, 1_000), availableAtIso, nowIso(), id)
  }

  async markDeadLetter(id: string, error: string): Promise<void> {
    this.database.db.prepare("UPDATE channel_outbox SET status = 'dead_letter', last_error = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?")
      .run(error.slice(0, 1_000), nowIso(), id)
  }

  async markSuperseded(input: Parameters<NonNullable<ChannelOutboxStore['markSuperseded']>>[0]): Promise<string[]> {
    const rows = this.database.db.prepare(`SELECT id FROM channel_outbox WHERE provider = ? AND account_id = ? AND kind = ? AND target_id = ?
      AND id <> ? AND status IN ('pending','retry_wait','leased') AND COALESCE(revision, -1) < ?`).all(input.provider, input.accountId, input.kind, input.targetId, input.keepId, input.revision) as Array<{ id: string }>
    const update = this.database.db.prepare("UPDATE channel_outbox SET status = 'superseded', lease_expires_at = NULL, updated_at = ? WHERE id = ?")
    for (const row of rows) update.run(nowIso(), row.id)
    return rows.map(row => row.id)
  }

  retryOutbox(accountId: string, id: string): void {
    const result = this.database.db.prepare("UPDATE channel_outbox SET status = 'pending', attempts = 0, available_at = ?, lease_expires_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND account_id = ? AND status IN ('retry_wait','dead_letter')")
      .run(nowIso(), nowIso(), id, accountId)
    if (result.changes === 0) throw new Error('投递不存在或当前不可重试')
  }

  diagnostics(accountId: string) {
    const count = (table: string, status?: string) => Number((this.database.db.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE account_id = ?${status ? ' AND status = ?' : ''}`).get(accountId, ...(status ? [status] : [])) as { value: number }).value)
    return {
      bindings: count('channel_bindings'), inbox: {
        waiting: count('channel_inbox', 'waiting_binding'), failed: count('channel_inbox', 'failed'), submitted: count('channel_inbox', 'submitted'),
        queued: count('channel_inbox', 'ready') + count('channel_inbox', 'submitting') + count('channel_inbox', 'submitted'),
      },
      outbox: {
        pending: count('channel_outbox', 'pending') + count('channel_outbox', 'leased') + count('channel_outbox', 'sending') + count('channel_outbox', 'retry_wait'),
        deadLetter: count('channel_outbox', 'dead_letter'),
        failures: this.listFailedDeliveries(accountId),
      },
    }
  }

  listFailedDeliveries(accountId: string, limit = 20): ChannelFailedDelivery[] {
    const rows = this.database.db.prepare(`SELECT id, kind, target_id, status, attempts, last_error, updated_at
      FROM channel_outbox WHERE account_id = ? AND status IN ('retry_wait','dead_letter')
      ORDER BY updated_at DESC LIMIT ?`).all(accountId, Math.max(1, Math.min(100, limit))) as Array<Pick<OutboxRow, 'id' | 'kind' | 'target_id' | 'status' | 'attempts' | 'last_error' | 'updated_at'>>
    return rows.map(row => ({
      id: row.id,
      kind: row.kind,
      targetId: row.target_id,
      status: row.status === 'retry_wait' ? 'retry_wait' : 'dead_letter',
      attempts: row.attempts,
      lastError: row.last_error ?? '',
      updatedAt: row.updated_at,
    }))
  }

  audit(accountId: string | null, action: string, targetType: string, targetId: string, success: boolean, metadata: unknown = {}, error = ''): void {
    this.database.db.prepare('INSERT INTO channel_audit_events (account_id, action, target_type, target_id, success, metadata_json, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(accountId, action, targetType, targetId, success ? 1 : 0, JSON.stringify(metadata), error.slice(0, 1_000) || null, nowIso())
  }
}
