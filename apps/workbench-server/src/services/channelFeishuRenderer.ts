import { projectChannelTurn, stripMarkdownImages } from '@codycodeagent/cody-web-core/channel'
import { feishuCardButtonElements, feishuMarkdownCards, feishuTextCard, type FeishuCard, type FeishuCardButton } from '@codycodeagent/cody-web-core/feishu'
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

/**
 * A browser cannot open a development-machine path such as /data00/... from a
 * Feishu card. Preserve external links, but turn local Markdown links into a
 * CodyWork deep link that is checked again by the preview API.
 */
export function rewriteWorkspaceFileLinks(markdown: string, openUrl = ''): string {
  if (!openUrl) return markdown
  let base: URL
  try { base = new URL(openUrl) } catch { return markdown }
  return markdown.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu, (whole, label: string, rawTarget: string) => {
    let target = rawTarget
    if (target.startsWith('file://')) {
      try { target = new URL(target).pathname } catch { return whole }
    }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || (!target.startsWith('/') && !target.startsWith('./') && !target.startsWith('../'))) return whole
    const match = /^(.*?)(?:#L(\d+))?$/u.exec(target)
    const filePath = match?.[1] ?? target
    if (!filePath) return whole
    const url = new URL(base.toString())
    url.searchParams.set('file', filePath)
    if (match?.[2]) url.searchParams.set('line', match[2])
    else url.searchParams.delete('line')
    return `[${label}](${url.toString()})`
  })
}

export function feishuProjectionBody(projection: TurnProjection, openUrl = ''): string {
  const withoutImages = stripMarkdownImages(projection.assistantText, image => image.alt ? `🖼️ ${image.alt}` : '🖼️ 图片')
  return rewriteWorkspaceFileLinks(withoutImages, openUrl)
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

function safePlainText(value: string | undefined, limit: number): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit)
}

export function executionContextNote(context?: ChannelExecutionContext, prompt = ''): string {
  const lines: string[] = []
  if (context) {
    const runtimeLabel = context.runtimeLabel || context.runtimeType || 'Codex'
    lines.push(['CodyWork', safePlainText(runtimeLabel, 32), safePlainText(context.workspaceName, 80), context.demandName ? safePlainText(context.demandName, 100) : ''].filter(Boolean).join(' · '))
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
  const runtimeLabel = context.runtimeLabel || context.runtimeType || 'Codex'
  return `**运行配置**\n**Runtime**　${safeInline(runtimeLabel)}\n**模型**　${safeInline(context.modelLabel)} · **推理**　${safeInline(context.reasoningLabel)} · **权限**　${safeInline(context.permissionLabel)}\n**Workspace**　${safeInline(context.workspaceName)}${scope}\n\n---\n\n`
}

export function executionContextFromState(value: unknown): ChannelExecutionContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const required = ['model', 'modelLabel', 'reasoningEffort', 'reasoningLabel', 'permissionLabel', 'workspaceName'] as const
  if (!required.every(key => typeof row[key] === 'string')) return undefined
  return {
    runtimeType: typeof row.runtimeType === 'string' && row.runtimeType ? row.runtimeType : 'codex',
    runtimeLabel: typeof row.runtimeLabel === 'string' && row.runtimeLabel ? row.runtimeLabel : typeof row.runtimeType === 'string' && row.runtimeType ? row.runtimeType : 'codex',
    model: row.model as string, modelLabel: row.modelLabel as string,
    reasoningEffort: row.reasoningEffort as ChannelExecutionContext['reasoningEffort'], reasoningLabel: row.reasoningLabel as string,
    permissionLabel: row.permissionLabel as string, workspaceName: row.workspaceName as string,
    ...(typeof row.demandName === 'string' && row.demandName ? { demandName: row.demandName } : {}),
  }
}

function projectionResultCard(title: string, markdown: string, options: { color: string; actions?: FeishuCardButton[]; note?: string }): FeishuCard {
  const cards = feishuMarkdownCards(markdown, { ...(options.note ? { note: options.note } : {}) })
  const card = cards[0] ?? { schema: '2.0', config: { update_multi: true }, body: { direction: 'vertical', elements: [] } }
  card.header = { template: options.color, title: { tag: 'plain_text', content: title.slice(0, 80) } }
  const body = card.body && typeof card.body === 'object' && !Array.isArray(card.body)
    ? card.body as { elements?: unknown[] }
    : { elements: [] as unknown[] }
  const elements = Array.isArray(body.elements) ? body.elements : []
  if (cards.length > 1) {
    const noteIndex = options.note ? Math.max(0, elements.length - 1) : elements.length
    elements.splice(noteIndex, 0, { tag: 'markdown', content: `---\n回复内容较长，飞书仅展示第 1/${cards.length} 张；请在 CodyWork 中查看完整结果。` })
  }
  if (options.actions?.length) {
    const noteIndex = options.note ? Math.max(0, elements.length - 1) : elements.length
    elements.splice(noteIndex, 0, ...feishuCardButtonElements(options.actions))
  }
  body.elements = elements
  card.body = body
  return card
}

export function projectionCard(projection: TurnProjection, prompt: string, openUrl = '', context?: ChannelExecutionContext, controls?: { bindingId: string; runtimePicker?: boolean }): FeishuCard {
  const body = feishuProjectionBody(projection, openUrl) || emptyProjectionBody(projection)
  const actions: FeishuCardButton[] = []
  // Keep model switching next to the current model on the live card. The
  // router re-validates ownership and provider-advertised model IDs.
  if (controls) actions.push({ text: '切换模型', value: { action: 'channel.model_picker', bindingId: controls.bindingId } })
  if (controls?.runtimePicker) actions.push({ text: '切换 Runtime', value: { action: 'channel.runtime_picker', bindingId: controls.bindingId } })
  if (openUrl) actions.push({ text: '在 CodyWork 中打开', url: openUrl, type: 'primary' })
  const runtimeLabel = context?.runtimeLabel || context?.runtimeType || 'Codex'
  return projectionResultCard(`CodyWork · ${runtimeLabel} · ${statusLabel(projection.status)}`, body, {
    color: statusColor(projection.status),
    ...(actions.length ? { actions } : {}),
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
