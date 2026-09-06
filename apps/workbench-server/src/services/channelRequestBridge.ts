import type { ReliableChannelOutbox, ChannelOutboxItem } from '@codycodeagent/cody-web-core/channel'
import { feishuTextCard, type FeishuCardAction, type FeishuCardButton } from '@codycodeagent/cody-web-core/feishu'
import type { ConversationEvent } from './conversations.js'
import { ConversationService } from './conversations.js'
import {
  type ChannelInteractiveRequest,
  type CodyWorkChannelBinding,
} from './channelStore.js'
import type { ChannelRepositoryPorts } from './channelRepositories.js'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
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

/** Bridges canonical approval/question events to and from a channel. */
export class ChannelRequestBridge {
  constructor(
    private readonly repositories: ChannelRepositoryPorts,
    private readonly conversations: ConversationService,
    private readonly enqueue: (accountId: string, input: Parameters<ReliableChannelOutbox['enqueue']>[0]) => Promise<ChannelOutboxItem>,
    private readonly openUrl: (binding: CodyWorkChannelBinding) => string,
    private readonly onError: (accountId: string, action: string, error: unknown) => void,
  ) {}

  async publish(binding: CodyWorkChannelBinding, event: ConversationEvent): Promise<void> {
    const requestId = string(event.data.requestId ?? event.data.approvalId ?? event.id)
    const kind = event.type === 'approval.requested' ? 'approval' : 'question'
    const requestKey = [binding.id, event.threadId, event.turnId ?? 'no-turn', kind, requestId].join(':')
    const request = this.repositories.requests.save({
      accountId: binding.accountId, bindingId: binding.id, requestKey, requestId, turnId: event.turnId ?? '', kind,
      requesterIdentity: binding.ownerIdentity,
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
    if (sent.remoteMessageId) this.repositories.requests.update(binding.accountId, request.id, { status: 'pending', remoteMessageId: sent.remoteMessageId })
  }

  async handleApprovalAction(accountId: string, action: FeishuCardAction): Promise<void> {
    const requestId = string(action.value.requestId)
    const interactiveRequestId = string(action.value.interactiveRequestId)
    const request = interactiveRequestId
      ? this.repositories.requests.getById(accountId, interactiveRequestId)
      : this.repositories.requests.get(accountId, requestId)
    if (request.status !== 'pending') throw new Error('审批已经处理')
    if (request.requesterIdentity !== action.actorId) throw new Error('只有绑定人可以处理审批')
    const binding = this.repositories.bindings.get(request.bindingId)
    const outcome = action.value.outcome === 'rejected' ? 'rejected' : 'allowed-once'
    await this.conversations.executeAction({
      kind: 'approval.resolve', workspaceId: binding.workspaceId, conversationId: binding.conversationId,
      origin: { kind: 'channel', provider: 'feishu', accountId, bindingId: binding.id, messageId: action.remoteMessageId || request.id, conversationKey: binding.conversationKey },
      requestId, outcome,
    })
    this.repositories.requests.update(accountId, request.id, { status: outcome })
    if (action.remoteMessageId) await this.enqueue(accountId, {
      kind: 'update_card', targetId: action.remoteMessageId,
      payload: { card: feishuTextCard('审批已处理', outcome === 'allowed-once' ? '已允许一次。' : '已拒绝。', { color: outcome === 'allowed-once' ? 'green' : 'red' }) },
      dedupeKey: `request:${request.id}:resolved`, terminal: true,
    })
  }

  async handleQuestionAction(accountId: string, action: FeishuCardAction): Promise<void> {
    const requestId = string(action.value.requestId)
    const interactiveRequestId = string(action.value.interactiveRequestId)
    const request = interactiveRequestId
      ? this.repositories.requests.getById(accountId, interactiveRequestId)
      : this.repositories.requests.get(accountId, requestId)
    if (request.status !== 'pending') throw new Error('问题已经回答')
    if (request.requesterIdentity !== action.actorId) throw new Error('只有绑定人可以回答')
    const binding = this.repositories.bindings.get(request.bindingId)
    const questionId = string(action.value.questionId)
    const answer = string(action.value.answer || action.option)
    await this.conversations.executeAction({
      kind: 'question.resolve', workspaceId: binding.workspaceId, conversationId: binding.conversationId,
      origin: { kind: 'channel', provider: 'feishu', accountId, bindingId: binding.id, messageId: action.remoteMessageId || request.id, conversationKey: binding.conversationKey },
      requestId, answer: questionId ? { answers: { [questionId]: { answers: [answer] } } } : answer,
    })
    this.repositories.requests.update(accountId, request.id, { status: 'answered' })
  }

  async resolve(binding: CodyWorkChannelBinding, event: ConversationEvent, knownRequest?: ChannelInteractiveRequest): Promise<void> {
    const requestId = string(event.data.requestId ?? event.data.approvalId)
    if (!requestId) return
    try {
      const request = knownRequest ?? this.repositories.requests.get(binding.accountId, requestId)
      if (request.status !== 'pending') return
      this.repositories.requests.update(binding.accountId, request.id, { status: 'resolved' })
      if (request.remoteMessageId) {
        await this.enqueue(binding.accountId, {
          kind: 'update_card', targetId: request.remoteMessageId,
          payload: { card: feishuTextCard('CodyWork 请求已处理', '该请求已在 CodyWork 浏览器或飞书端完成。', { color: 'green' }) },
          dedupeKey: `request:${request.id}:externally-resolved`, terminal: true,
        })
      }
    } catch { /* browser may have resolved a request not mirrored to Feishu */ }
  }

  expireTurn(conversationId: string, turnId: string, terminalType: ConversationEvent['type']): void {
    const requests = this.repositories.requests.pendingForTurn(conversationId, turnId)
    const message = terminalType === 'turn.interrupted'
      ? '对应回复已停止，不能再处理这项请求。'
      : terminalType === 'turn.completed'
        ? '对应回复已经结束，这项请求已失效。'
        : '对应回复未能继续，这项请求已失效。'
    for (const request of requests) {
      this.repositories.requests.update(request.accountId, request.id, { status: 'expired' })
      if (!request.remoteMessageId) continue
      void this.enqueue(request.accountId, {
        kind: 'update_card',
        targetId: request.remoteMessageId,
        payload: { card: feishuTextCard('CodyWork 请求已结束', message, { color: terminalType === 'turn.interrupted' ? 'grey' : 'red' }) },
        dedupeKey: `request:${request.id}:terminal:${terminalType}`,
        terminal: true,
      }).catch(error => this.onError(request.accountId, 'channel.request.expire', error))
    }
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
}
