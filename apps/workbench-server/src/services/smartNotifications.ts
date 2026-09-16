import { latestAssistantTextFromEvents, type CodexEvent } from '@codycodeagent/cody-web-core/conversation'
import { stripMarkdownImages } from '@codycodeagent/cody-web-core/channel'
import { feishuTextCard, type FeishuCard } from '@codycodeagent/cody-web-core/feishu'
import type { WorkbenchDb, SmartNotificationSettingsRow, WorkspaceRow } from '../db/index.js'
import { makeId, nowIso } from '../db/index.js'
import type { ConversationEvent, ConversationService } from './conversations.js'
import type { WorkspaceRegistry } from './workspaceRegistry.js'
import { getDemand } from './demands.js'

const TERMINAL_TYPES = new Set<CodexEvent['type']>(['turn.completed', 'turn.failed'])

export interface SmartNotificationSettings {
  workspaceId: string
  enabled: boolean
  accountId: string
  recipientOpenId: string
  minActiveMinutes: number
  notifyDemand: boolean
  notifyWorkspace: boolean
  updatedAt: string
}

export interface SmartNotificationSettingsInput {
  enabled?: boolean
  accountId?: string
  recipientOpenId?: string
  minActiveMinutes?: number
  notifyDemand?: boolean
  notifyWorkspace?: boolean
}

export interface SmartTaskAnalysis {
  eligible: boolean
  activeDurationMs: number
  wallDurationMs: number
  waitingDurationMs: number
  toolCount: number
  fileChangeCount: number
  hasPlan: boolean
  hasVerification: boolean
  assistantText: string
  status: 'completed' | 'failed'
}

type QueueInput = {
  kind: string
  targetId: string
  payload: unknown
  dedupeKey: string
  terminal?: boolean
}

type Hooks = {
  queue: (accountId: string, input: QueueInput) => Promise<{ id: string; status?: string }>
  account: (accountId: string) => { id: string; name: string; enabled: boolean }
  audit: (accountId: string | null, action: string, targetType: string, targetId: string, success: boolean, metadata?: unknown, error?: string) => void
  openUrl: (input: { workspaceId: string; demandId: string | null; conversationId: string }) => string
}

function finiteTime(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function eventText(event: CodexEvent): string {
  try { return JSON.stringify(event.data).toLowerCase() }
  catch { return '' }
}

function waitDuration(events: readonly CodexEvent[], startMs: number, endMs: number): number {
  let pending = 0
  let waitingFrom: number | null = null
  let waitingMs = 0
  for (const event of events) {
    const at = finiteTime(event.atIso)
    if (at === null || at < startMs || at > endMs) continue
    if (event.type === 'approval.requested' || event.type === 'question.requested') {
      if (pending === 0) waitingFrom = at
      pending += 1
    } else if ((event.type === 'approval.resolved' || event.type === 'question.resolved') && pending > 0) {
      pending -= 1
      if (pending === 0 && waitingFrom !== null) {
        waitingMs += Math.max(0, at - waitingFrom)
        waitingFrom = null
      }
    }
  }
  if (pending > 0 && waitingFrom !== null) waitingMs += Math.max(0, endMs - waitingFrom)
  return Math.min(waitingMs, Math.max(0, endMs - startMs))
}

export function analyzeSmartTask(events: readonly CodexEvent[], turnId: string, minActiveMinutes: number): SmartTaskAnalysis | null {
  const turnEvents = events.filter(event => event.turnId === turnId)
  const terminal = [...turnEvents].reverse().find(event => TERMINAL_TYPES.has(event.type))
  if (!terminal) return null
  const started = turnEvents.find(event => event.type === 'turn.started')
  const terminalMs = finiteTime(terminal.atIso)
  const startedMs = finiteTime(started?.atIso)
  const explicitDurationMs = typeof terminal.data.durationMs === 'number' && Number.isFinite(terminal.data.durationMs)
    ? Math.max(0, terminal.data.durationMs)
    : null
  const wallDurationMs = startedMs !== null && terminalMs !== null
    ? Math.max(0, terminalMs - startedMs)
    : explicitDurationMs ?? 0
  const waitingDurationMs = startedMs !== null && terminalMs !== null ? waitDuration(turnEvents, startedMs, terminalMs) : 0
  const activeDurationMs = Math.max(0, wallDurationMs - waitingDurationMs)
  const toolIds = new Set<string>()
  const fileChangeIds = new Set<string>()
  let hasPlan = false
  let hasVerification = false
  for (const event of turnEvents) {
    if (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed' || event.type === 'fileChange.updated') {
      const key = event.itemId || (event.type === 'fileChange.updated' ? `file-change:${turnId}` : event.id)
      toolIds.add(key)
      if (event.type === 'fileChange.updated' || /file.?change|apply.?patch|write|edit/iu.test(eventText(event))) fileChangeIds.add(key)
      if (/\b(test|verify|lint|build|deploy|git|commit|push|merge|e2e)\b/iu.test(eventText(event))) hasVerification = true
    }
    if (event.type === 'plan.delta' || event.type === 'plan.replaced') hasPlan = true
  }
  const assistantText = latestAssistantTextFromEvents(turnEvents).trim()
  const status = terminal.type === 'turn.failed' ? 'failed' as const : 'completed' as const
  const material = status === 'failed'
    || toolIds.size >= 2
    || fileChangeIds.size > 0
    || hasPlan
    || hasVerification
    || assistantText.length >= 400
  return {
    eligible: activeDurationMs >= minActiveMinutes * 60_000 && material,
    activeDurationMs,
    wallDurationMs,
    waitingDurationMs,
    toolCount: toolIds.size,
    fileChangeCount: fileChangeIds.size,
    hasPlan,
    hasVerification,
    assistantText,
    status,
  }
}

function compactResult(value: string): string {
  const withoutImages = stripMarkdownImages(value, image => image.alt ? `🖼️ ${image.alt}` : '🖼️ 图片').trim()
  if (!withoutImages) return '任务已结束，Codex 未返回可显示的文字结果。'
  return withoutImages.length > 2_400 ? `${withoutImages.slice(0, 2_400).trimEnd()}\n\n…完整结果请在 CodyWork 中查看。` : withoutImages
}

function durationLabel(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

export function smartNotificationCard(input: {
  workspaceName: string
  demandName?: string
  conversationTitle: string
  analysis: SmartTaskAnalysis
  openUrl?: string
  test?: boolean
}): FeishuCard {
  const statusLabel = input.test ? '测试成功' : input.analysis.status === 'completed' ? '长任务已完成' : '长任务执行失败'
  const facts = [
    `有效执行 ${durationLabel(input.analysis.activeDurationMs)}`,
    input.analysis.toolCount ? `${input.analysis.toolCount} 次工具调用` : '',
    input.analysis.fileChangeCount ? `${input.analysis.fileChangeCount} 项文件变更` : '',
    input.analysis.hasVerification ? '已执行验证类操作' : '',
  ].filter(Boolean).join(' · ')
  const scope = [input.workspaceName, input.demandName, input.conversationTitle].filter(Boolean).join(' · ')
  return feishuTextCard(`CodyWork · ${statusLabel}`, `**${input.conversationTitle}**\n\n${compactResult(input.analysis.assistantText)}\n\n---\n${facts}`, {
    color: input.test || input.analysis.status === 'completed' ? 'green' : 'red',
    ...(input.openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: input.openUrl, type: 'primary' as const }] } : {}),
    note: scope,
  })
}

function toView(workspaceId: string, row?: SmartNotificationSettingsRow): SmartNotificationSettings {
  return {
    workspaceId,
    enabled: row?.enabled === 1,
    accountId: row?.account_id ?? '',
    recipientOpenId: row?.recipient_open_id ?? '',
    minActiveMinutes: row?.min_active_minutes ?? 30,
    notifyDemand: row ? row.notify_demand === 1 : true,
    notifyWorkspace: row ? row.notify_workspace === 1 : true,
    updatedAt: row?.updated_at ?? '',
  }
}

export class SmartNotificationService {
  private readonly unsubscribe: () => void

  constructor(
    private readonly database: WorkbenchDb,
    private readonly conversations: ConversationService,
    private readonly workspaces: WorkspaceRegistry,
    private readonly hooks: Hooks,
  ) {
    this.unsubscribe = conversations.events.subscribe({}, event => {
      if (!event.turnId || !TERMINAL_TYPES.has(event.type)) return
      void this.onTerminal(event).catch(error => this.recordFailure(event, error))
    })
  }

  close(): void { this.unsubscribe() }

  get(workspaceId: string): SmartNotificationSettings {
    this.workspaces.get(workspaceId)
    const row = this.database.db.prepare('SELECT * FROM smart_notification_settings WHERE workspace_id = ?').get(workspaceId) as SmartNotificationSettingsRow | undefined
    return toView(workspaceId, row)
  }

  save(workspaceId: string, input: SmartNotificationSettingsInput): SmartNotificationSettings {
    this.workspaces.get(workspaceId)
    const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : ''
    const recipientOpenId = typeof input.recipientOpenId === 'string' ? input.recipientOpenId.trim() : ''
    const minutes = Number(input.minActiveMinutes ?? 30)
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) throw new Error('最短有效执行时间必须是 5 到 240 分钟之间的整数')
    if (input.enabled !== false) {
      if (!accountId) throw new Error('请选择用于发送通知的飞书机器人')
      if (!recipientOpenId) throw new Error('请输入接收人的 Open ID')
      const account = this.hooks.account(accountId)
      if (!account.enabled) throw new Error('请选择已启用的飞书机器人')
      if (input.notifyDemand === false && input.notifyWorkspace === false) throw new Error('至少选择一种通知范围')
    } else if (accountId) {
      this.hooks.account(accountId)
    }
    const now = nowIso()
    this.database.db.prepare(`INSERT INTO smart_notification_settings (
      workspace_id, enabled, account_id, recipient_open_id, min_active_minutes, notify_demand, notify_workspace, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET enabled = excluded.enabled, account_id = excluded.account_id,
      recipient_open_id = excluded.recipient_open_id, min_active_minutes = excluded.min_active_minutes,
      notify_demand = excluded.notify_demand, notify_workspace = excluded.notify_workspace, updated_at = excluded.updated_at`)
      .run(workspaceId, input.enabled === false ? 0 : 1, accountId || null, recipientOpenId, minutes,
        input.notifyDemand === false ? 0 : 1, input.notifyWorkspace === false ? 0 : 1, now, now)
    return this.get(workspaceId)
  }

  async test(workspaceId: string): Promise<{ queued: true; outboxId: string }> {
    const workspace = this.workspaces.get(workspaceId)
    const settings = this.get(workspaceId)
    if (!settings.enabled || !settings.accountId || !settings.recipientOpenId) throw new Error('请先启用并保存智能通知')
    const account = this.hooks.account(settings.accountId)
    if (!account.enabled) throw new Error('飞书机器人未启用')
    const analysis: SmartTaskAnalysis = {
      eligible: true, activeDurationMs: settings.minActiveMinutes * 60_000, wallDurationMs: settings.minActiveMinutes * 60_000,
      waitingDurationMs: 0, toolCount: 8, fileChangeCount: 3, hasPlan: true, hasVerification: true,
      assistantText: '这是一条智能完工通知测试。真实任务只会在达到有效执行时长并具备复杂任务信号后发送。', status: 'completed',
    }
    const item = await this.hooks.queue(settings.accountId, {
      kind: 'send_user_card', targetId: settings.recipientOpenId,
      payload: { card: smartNotificationCard({ workspaceName: workspace.name, conversationTitle: '通知链路测试', analysis, test: true }) },
      dedupeKey: `smart-notification:test:${workspaceId}:${makeId('delivery')}`, terminal: true,
    })
    this.hooks.audit(settings.accountId, 'smart_notification.test_queued', 'workspace', workspaceId, true, { outboxId: item.id })
    return { queued: true, outboxId: item.id }
  }

  private async onTerminal(event: ConversationEvent): Promise<void> {
    const conversation = this.database.db.prepare('SELECT workspace_id, demand_id, title FROM conversations WHERE id = ?').get(event.conversationId) as { workspace_id: string; demand_id: string | null; title: string } | undefined
    if (!conversation || !event.turnId) return
    const settings = this.get(conversation.workspace_id)
    if (!settings.enabled || !settings.accountId || !settings.recipientOpenId) return
    if (conversation.demand_id ? !settings.notifyDemand : !settings.notifyWorkspace) return
    const snapshot = await this.conversations.historyCanonical(conversation.workspace_id, event.conversationId)
    const analysis = analyzeSmartTask(snapshot.events, event.turnId, settings.minActiveMinutes)
    if (!analysis?.eligible) return
    const workspace = this.workspaces.get(conversation.workspace_id)
    const demand = conversation.demand_id ? getDemand(this.database, workspace, conversation.demand_id) : null
    const openUrl = this.hooks.openUrl({ workspaceId: workspace.id, demandId: conversation.demand_id, conversationId: event.conversationId })
    const item = await this.hooks.queue(settings.accountId, {
      kind: 'send_user_card', targetId: settings.recipientOpenId,
      payload: { card: smartNotificationCard({ workspaceName: workspace.name, demandName: demand?.name, conversationTitle: conversation.title, analysis, openUrl }) },
      dedupeKey: `smart-notification:${workspace.id}:${event.conversationId}:${event.turnId}`, terminal: true,
    })
    this.hooks.audit(settings.accountId, 'smart_notification.queued', 'conversation_turn', `${event.conversationId}:${event.turnId}`, true, {
      workspaceId: workspace.id, demandId: conversation.demand_id, outboxId: item.id,
      activeDurationMs: analysis.activeDurationMs, wallDurationMs: analysis.wallDurationMs, waitingDurationMs: analysis.waitingDurationMs,
      toolCount: analysis.toolCount, fileChangeCount: analysis.fileChangeCount, status: analysis.status,
    })
  }

  private recordFailure(event: ConversationEvent, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[codywork] smart notification failed for ${event.conversationId}/${event.turnId ?? ''}: ${message}`)
    try {
      const row = this.database.db.prepare('SELECT workspace_id FROM conversations WHERE id = ?').get(event.conversationId) as { workspace_id: string } | undefined
      const settings = row ? this.get(row.workspace_id) : null
      this.hooks.audit(settings?.accountId || null, 'smart_notification.failed', 'conversation_turn', `${event.conversationId}:${event.turnId ?? ''}`, false, {}, message)
    } catch { /* notification failures must never fail the originating Turn */ }
  }
}
