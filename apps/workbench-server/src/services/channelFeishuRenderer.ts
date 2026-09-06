import { projectChannelTurn, stripMarkdownImages } from '@codycodeagent/cody-web-core/channel'
import { feishuTextCard, type FeishuCard } from '@codycodeagent/cody-web-core/feishu'

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
export function projectionCard(projection: TurnProjection, prompt: string, openUrl = ''): FeishuCard {
  const body = feishuProjectionBody(projection) || emptyProjectionBody(projection)
  return feishuTextCard(`CodyWork · ${statusLabel(projection.status)}`, body, {
    color: statusColor(projection.status),
    ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
    note: `问题：${prompt.slice(0, 180)}${prompt.length > 180 ? '…' : ''}`,
  })
}

export function commandFailureCard(error: string, openUrl = ''): FeishuCard {
  return feishuTextCard('CodyWork · 提交失败', `**${error}**\n\n消息未被静默重发。请发送 \`/retry\` 明确重试。`, {
    color: 'red',
    ...(openUrl ? { actions: [{ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' as const }] } : {}),
  })
}
