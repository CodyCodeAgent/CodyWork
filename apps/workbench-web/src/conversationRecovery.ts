export type RecoveryMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
}

const MAX_HISTORY_MESSAGES = 16
const MAX_HISTORY_CHARS = 8_000
const MAX_REQUEST_CHARS = 6_000

function clipped(text: string, limit: number): string {
  const compact = text.trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}\n[内容已截断]`
}

export function isThreadMigrationRecommended(lastError?: string): boolean {
  const normalized = lastError?.trim().toLowerCase() ?? ''
  if (!normalized) return false
  return normalized.includes('codex 上游响应流恢复失败')
    || normalized.includes('websocket closed by server before response.completed')
    || (normalized.includes('upstream response stream') && normalized.includes('failed'))
}

export function recoveryConversationTitle(title: string): string {
  const suffix = ' · 恢复'
  const base = title.trim() || '新会话'
  return `${base.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`
}

export function buildConversationRecoveryPrompt(
  messages: readonly RecoveryMessage[],
  failedMessage: RecoveryMessage,
  omittedImageCount = 0,
): string {
  const candidates = messages
    .filter(message => message.id !== failedMessage.id && message.role !== 'system' && message.text.trim())
    .slice(-MAX_HISTORY_MESSAGES)
  const selected: RecoveryMessage[] = []
  let remaining = MAX_HISTORY_CHARS
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]!
    const text = clipped(candidate.text, remaining)
    if (!text) continue
    selected.unshift({ ...candidate, text })
    remaining -= text.length
    if (remaining <= 0) break
  }
  const history = selected.length
    ? selected.map(message => `${message.role === 'user' ? '用户' : 'AI'}：${message.text}`).join('\n\n')
    : '（无可用的近期文字上下文）'
  const imageNote = omittedImageCount
    ? `注意：原请求中有 ${omittedImageCount} 张图片未能迁移；如果它们对任务必要，请明确告知用户需重新附加。`
    : ''
  return [
    '你正在一个新建的 Codex Thread 中恢复上一会话里失败的任务。旧 Thread 的上游响应流已无法继续，本次恢复由用户点击“重试此消息”明确触发。',
    '请先检查当前 Workspace/Worktree 的实际文件、Git 状态和已有进程，保留已经落地的成果，不要假设失败前没有产生副作用；然后直接继续完成最后的用户请求，不要只解释恢复过程。',
    '',
    '[裁剪后的近期上下文]',
    history,
    '[/裁剪后的近期上下文]',
    '',
    '[需继续的用户请求]',
    clipped(failedMessage.text, MAX_REQUEST_CHARS),
    '[/需继续的用户请求]',
    imageNote,
  ].filter(Boolean).join('\n').trim()
}
