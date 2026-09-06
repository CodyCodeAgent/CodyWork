import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ReliableChannelOutbox, ChannelInboundMessage, ChannelOutboxItem } from '@codycodeagent/cody-web-core/channel'
import { feishuTextCard, type FeishuCard, type FeishuCardAction } from '@codycodeagent/cody-web-core/feishu'
import {
  type ChannelAccessRequest,
  type ChannelAccount,
} from './channelStore.js'
import type { ChannelRepositoryPorts } from './channelRepositories.js'

const ACCESS_REQUEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000

type SignedAccessRequest = {
  v: 1
  requestId: string
  accountId: string
  requesterIdentity: string
  administratorIdentity: string
  expiresAtMs: number
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function signAccessRequest(request: ChannelAccessRequest, appSecret: string): string {
  const payload: SignedAccessRequest = {
    v: 1,
    requestId: request.id,
    accountId: request.accountId,
    requesterIdentity: request.requesterIdentity,
    administratorIdentity: request.administratorIdentity,
    expiresAtMs: Date.parse(request.expiresAtIso),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', appSecret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function verifyAccessRequestToken(account: ChannelAccount & { appSecret: string }, token: string, nowMs: number): SignedAccessRequest | null {
  const [encoded, suppliedSignature, extra] = token.split('.')
  if (!encoded || !suppliedSignature || extra) return null
  const expectedSignature = createHmac('sha256', account.appSecret).update(encoded).digest('base64url')
  const supplied = Buffer.from(suppliedSignature)
  const expected = Buffer.from(expectedSignature)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SignedAccessRequest>
    if (payload.v !== 1 || payload.accountId !== account.id || typeof payload.requestId !== 'string') return null
    if (!/^ou_[A-Za-z0-9_-]+$/u.test(payload.requesterIdentity ?? '') || !/^ou_[A-Za-z0-9_-]+$/u.test(payload.administratorIdentity ?? '')) return null
    if (typeof payload.expiresAtMs !== 'number' || payload.expiresAtMs > nowMs + ACCESS_REQUEST_MAX_AGE_MS + 60_000) return null
    return payload as SignedAccessRequest
  } catch {
    return null
  }
}

function accessRequestCard(request: ChannelAccessRequest, token: string): FeishuCard {
  const source = request.sourceScope === 'private' ? '私聊' : `${request.sourceScope === 'topic' ? '话题' : '群聊'} \`${request.sourceConversationId.slice(0, 80)}\``
  return feishuTextCard('飞书机器人访问申请', `用户 \`${request.requesterIdentity.slice(0, 100)}\` 在${source}中请求使用 CodyWork。\n\n批准只会精确加入这个 Open ID，不会开启全员访问。`, {
    color: 'orange',
    actions: [
      { text: '允许访问', value: { action: 'channel.access_approve', accessRequestToken: token }, type: 'primary' },
      { text: '拒绝', value: { action: 'channel.access_reject', accessRequestToken: token }, type: 'danger' },
    ],
    note: `申请将在 ${request.expiresAtIso} 失效`,
  })
}

function resolvedAccessRequestCard(request: ChannelAccessRequest): FeishuCard {
  const approved = request.status === 'approved'
  return feishuTextCard(approved ? '已允许访问' : request.status === 'expired' ? '访问申请已失效' : '已拒绝访问', approved
    ? `已将 \`${request.requesterIdentity.slice(0, 100)}\` 精确加入机器人白名单。对方现在可以回到原会话重试。`
    : request.status === 'expired'
      ? '这项访问申请已经过期，请让对方重新发送消息申请。'
      : `未向 \`${request.requesterIdentity.slice(0, 100)}\` 开放机器人访问。`, {
    color: approved ? 'green' : request.status === 'expired' ? 'grey' : 'red',
    note: request.resolvedAtIso ? `操作人：${request.resolvedByIdentity} · ${request.resolvedAtIso}` : undefined,
  })
}

/** Handles access-request policy and cards; it never routes normal messages. */
export class ChannelAccessService {
  constructor(
    private readonly repositories: ChannelRepositoryPorts,
    private readonly enqueue: (accountId: string, input: Parameters<ReliableChannelOutbox['enqueue']>[0]) => Promise<ChannelOutboxItem>,
    private readonly refreshAccount: (accountId: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async request(account: ChannelAccount, message: ChannelInboundMessage, inboxId: string): Promise<void> {
    const administratorIdentity = account.allowedUserIds[0]
    if (!/^ou_[A-Za-z0-9_-]+$/u.test(message.sender.id) || !/^ou_[A-Za-z0-9_-]+$/u.test(administratorIdentity ?? '')) {
      this.repositories.inbox.update(inboxId, 'ignored', { lastError: 'sender_denied_no_administrator' })
      this.repositories.audit.record(account.id, 'channel.access.request_skipped', 'channel_inbox', inboxId, false, {
        requesterIdentity: message.sender.id, sourceConversationId: message.conversation.id, reason: 'no_administrator',
      }, '机器人没有可接收授权申请的有效管理员 Open ID')
      return
    }
    const now = this.now()
    const createdAtIso = now.toISOString()
    const result = this.repositories.requests.createAccess({
      accountId: account.id,
      requesterIdentity: message.sender.id,
      administratorIdentity,
      sourceInboxId: inboxId,
      sourceConversationId: message.conversation.id,
      sourceScope: message.conversation.scope,
      sourceMessageId: message.messageId,
      createdAtIso,
      expiresAtIso: new Date(now.getTime() + ACCESS_REQUEST_MAX_AGE_MS).toISOString(),
    })
    if (result.created) {
      const secret = this.repositories.accounts.get(account.id).appSecret
      const sent = await this.enqueue(account.id, {
        kind: 'send_user_card', targetId: administratorIdentity,
        payload: { card: accessRequestCard(result.request, signAccessRequest(result.request, secret)) },
        dedupeKey: `access-request:${result.request.id}:administrator`, terminal: true,
      })
      if (sent.remoteMessageId) this.repositories.requests.updateAccessRemote(account.id, result.request.id, sent.remoteMessageId)
    }
    await this.enqueue(account.id, {
      kind: 'reply_text', targetId: message.messageId,
      payload: {
        text: result.created
          ? '当前账号尚未加入机器人白名单，已向管理员发送访问申请。批准后请重新发送原消息。'
          : '访问申请仍在等待管理员处理。批准后请重新发送原消息。',
        replyInThread: message.conversation.scope === 'topic',
      },
      dedupeKey: `${inboxId}:access-request-feedback`, terminal: true,
    })
    this.repositories.inbox.update(inboxId, 'ignored', { lastError: result.created ? 'access_requested' : 'access_request_pending' })
    this.repositories.audit.record(account.id, result.created ? 'channel.access.requested' : 'channel.access.request_reused', 'channel_access_request', result.request.id, true, {
      requesterIdentity: message.sender.id, administratorIdentity, sourceConversationId: message.conversation.id,
      sourceScope: message.conversation.scope, inboxId,
    })
  }

  async handleAction(accountId: string, action: FeishuCardAction): Promise<FeishuCard> {
    const account = this.repositories.accounts.get(accountId)
    const signed = verifyAccessRequestToken(account, string(action.value.accessRequestToken), this.now().getTime())
    if (!signed) throw new Error('访问申请已失效或校验失败，请让对方重新申请')
    if (signed.administratorIdentity !== action.actorId) throw new Error('只有机器人管理员可以处理访问申请')
    const persisted = this.repositories.requests.getAccess(accountId, signed.requestId)
    if (persisted.requesterIdentity !== signed.requesterIdentity || persisted.administratorIdentity !== signed.administratorIdentity
      || Date.parse(persisted.expiresAtIso) !== signed.expiresAtMs) throw new Error('访问申请身份校验失败')
    const decision = string(action.value.action) === 'channel.access_approve' ? 'approved' : 'rejected'
    const resolved = this.repositories.requests.resolveAccess({
      accountId, id: persisted.id, actorIdentity: action.actorId, decision, resolvedAtIso: this.now().toISOString(),
    })
    if (resolved.request.status !== 'expired' && decision !== resolved.request.status) {
      throw new Error(resolved.request.status === 'approved' ? '访问申请已经批准' : '访问申请已经拒绝')
    }
    if (resolved.request.status === 'approved') this.refreshAccount(accountId)
    const card = resolvedAccessRequestCard(resolved.request)
    const remoteMessageId = action.remoteMessageId || resolved.request.adminRemoteMessageId
    if (remoteMessageId) {
      await this.enqueue(accountId, {
        kind: 'update_card', targetId: remoteMessageId, payload: { card },
        dedupeKey: `access-request:${resolved.request.id}:resolved`, terminal: true,
      })
    }
    if (resolved.request.status !== 'expired') {
      await this.enqueue(accountId, {
        kind: 'send_user_card', targetId: resolved.request.requesterIdentity,
        payload: { card: feishuTextCard(
          resolved.request.status === 'approved' ? 'CodyWork 访问申请已通过' : 'CodyWork 访问申请未通过',
          resolved.request.status === 'approved' ? '你现在可以回到原会话重新发送消息。' : '管理员未开放本次访问。',
          { color: resolved.request.status === 'approved' ? 'green' : 'grey' },
        ) },
        dedupeKey: `access-request:${resolved.request.id}:requester:${resolved.request.status}`, terminal: true,
      })
    }
    if (resolved.changed) {
      const auditAction = resolved.request.status === 'approved' ? 'channel.access.granted'
        : resolved.request.status === 'rejected' ? 'channel.access.rejected' : 'channel.access.expired'
      this.repositories.audit.record(accountId, auditAction, 'channel_access_request', resolved.request.id, true, {
        requesterIdentity: resolved.request.requesterIdentity, administratorIdentity: action.actorId,
      })
    }
    return card
  }
}
