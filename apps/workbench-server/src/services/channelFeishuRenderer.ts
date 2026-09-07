import { projectChannelTurn, stripMarkdownImages } from '@codycodeagent/cody-web-core/channel'
import { feishuTextCard, type FeishuCard } from '@codycodeagent/cody-web-core/feishu'
import type { ChannelExecutionContext } from './channelSessionSettings.js'

type TurnProjection = ReturnType<typeof projectChannelTurn>

function statusLabel(status: TurnProjection['status']): string {
  return ({ queued: '排队中', running: '执行中', retrying: '上游恢复中', disconnected: '上游已断开', completed: '已完成', failed: '失败', interrupted: '已停止' } as const)[status]
}

function statusColor(status: TurnProjection['status']): string {
  if (status === 'completed') return 'green'
  if (status === 'failed' || status === 'disconnected') return 'red'
  if (status === 'interrupted') return 'grey'
  if (status === 'retrying') return 'orange'
  return 'blue'
}

export function feishuProjectionBody(projection: TurnProjection): string {
  return stripMarkdownImages(projection.assistantText, image => image.alt ? `🖼️ ${image.alt}` : '🖼️ 图片')
}

function emptyProjectionBody(projection: TurnProjection): string {
  if (projection.error) return `**${projection.error}**`
  if (projection.status === 'completed') return '本次回复已完成，Codex 未返回可显示的文本。'
  if (projection.status === 'interrupted') return '本次回复已停止。'
  if (projection.status === 'failed') return '本次回复执行失败，Codex 未返回更多错误信息。'
  if (projection.status === 'disconnected') return 'Codex 上游响应流已断开，消息未自动重发。'
  return 'CodyWork 已接收消息，正在等待 Codex 输出…'
}

/** Pure Feishu presentation adapter; it does not own Turn or delivery state. */
function safeInline(value: string, limit = 160): string {
  return value.replace(/[\r\n`*_~\[\]]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit)
}

function safePlainText(value: string, limit: number): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, limit)
}

export function executionContextNote(context?: ChannelExecutionContext, prompt = ''): string {
  const lines: string[] = []
  if (context) {
    lines.push(['CodyWork', safePlainText(context.workspaceName, 80), context.demandName ? safePlainText(context.demandName, 100) : ''].filter(Boolean).join(' · '))
    lines.push(`${safePlainText(context.modelLabel, 100)} · 推理 ${safePlainText(context.reasoningLabel, 24)} · ${safePlainText(context.permissionLabel, 40)}`)
  }
  if (prompt) {
    const normalized = safePlainText(prompt, 181)
    lines.push(`问题：${normalized.slice(0, 180)}${normalized.length > 180 ? '…' : ''}`)
  }
  return lines.join('\n').slice(0, 500)
}

/** Prominent summary reserved for cards whose primary purpose is editing runtime settings. */
export function executionContextMarkdown(context?: ChannelExecutionContext): string {
  if (!context) return ''
  const scope = context.demandName ? `\n**需求**　${safeInline(context.demandName)}` : ''
  return `**运行配置**\n**模型**　${safeInline(context.modelLabel)} · **推理**　${safeInline(context.reasoningLabel)} · **权限**　${safeInline(context.permissionLabel)}\n**Workspace**　${safeInline(context.workspaceName)}${scope}\n\n---\n\n`
}

export function executionContextFromState(value: unknown): ChannelExecutionContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const required = ['model', 'modelLabel', 'reasoningEffort', 'reasoningLabel', 'permissionLabel', 'workspaceName'] as const
  if (!required.every(key => typeof row[key] === 'string')) return undefined
  return {
    model: row.model as string, modelLabel: row.modelLabel as string,
    reasoningEffort: row.reasoningEffort as ChannelExecutionContext['reasoningEffort'], reasoningLabel: row.reasoningLabel as string,
    permissionLabel: row.permissionLabel as string, workspaceName: row.workspaceName as string,
    ...(typeof row.demandName === 'string' && row.demandName ? { demandName: row.demandName } : {}),
  }
}

export function projectionCard(projection: TurnProjection, prompt: string, openUrl = '', context?: ChannelExecutionContext): FeishuCard {
  const body = feishuProjectionBody(projection) || emptyProjectionBody(projection)
  return feishuTextCard(`CodyWork · ${statusLabel(projection.status)}`, body, {
    color: statusColor(projection.status),
    ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
    note: executionContextNote(context, prompt),
  })
}

export function commandFailureCard(error: string, openUrl = '', context?: ChannelExecutionContext): FeishuCard {
  return feishuTextCard('CodyWork · 提交失败', `**${error}**\n\n消息未被静默重发。请发送 \`/retry\` 明确重试。`, {
    color: 'red',
    ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
    note: executionContextNote(context),
  })
}
