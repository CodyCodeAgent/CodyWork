import type { ConversationContextUsageState } from '@codycodeagent/cody-web-core/conversation'

export type ContextUsageTone = 'normal' | 'warning' | 'critical' | 'compacting' | 'compacted'

export type ThreadContextUsagePresentation = {
  usedTokens: number
  remainingTokens: number | null
  usedPercent: number | null
  autoCompactPercent: number | null
  usedLabel: string
  remainingLabel: string | null
  contextWindowLabel: string | null
  autoCompactLabel: string | null
  tone: ContextUsageTone
  statusLabel: string | null
}

function boundedPercent(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)))
}

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`
  return String(Math.round(value))
}

export function buildThreadContextUsagePresentation(
  usage: ConversationContextUsageState | null | undefined,
): ThreadContextUsagePresentation | null {
  if (!usage) return null

  const usedTokens = Math.max(0, usage.usedTokens || 0)
  const contextWindow = usage.contextWindow && usage.contextWindow > 0 ? usage.contextWindow : null
  const autoCompactLimit = usage.autoCompactTokenLimit && usage.autoCompactTokenLimit > 0
    ? usage.autoCompactTokenLimit
    : null
  const remainingTokens = contextWindow === null ? null : Math.max(0, contextWindow - usedTokens)
  const usedPercent = contextWindow === null ? null : boundedPercent(usedTokens, contextWindow)
  const autoCompactPercent = autoCompactLimit === null || contextWindow === null
    ? null
    : boundedPercent(autoCompactLimit, contextWindow)

  let tone: ContextUsageTone = 'normal'
  if (usage.compactionState === 'compacting') tone = 'compacting'
  else if (usage.compactionState === 'compacted') tone = 'compacted'
  else if ((autoCompactLimit !== null && usedTokens >= autoCompactLimit * 0.95) || (contextWindow !== null && usedTokens >= contextWindow * 0.88)) tone = 'critical'
  else if ((autoCompactLimit !== null && usedTokens >= autoCompactLimit * 0.8) || (contextWindow !== null && usedTokens >= contextWindow * 0.7)) tone = 'warning'

  const statusLabel = usage.compactionState === 'compacting'
    ? '正在压缩上下文'
    : usage.compactionState === 'compacted'
      ? '上下文已压缩'
      : tone === 'critical'
        ? '接近上下文上限'
        : tone === 'warning'
          ? '接近自动压缩阈值'
          : null

  return {
    usedTokens,
    remainingTokens,
    usedPercent,
    autoCompactPercent,
    usedLabel: formatTokenCount(usedTokens),
    remainingLabel: remainingTokens === null ? null : formatTokenCount(remainingTokens),
    contextWindowLabel: contextWindow === null ? null : formatTokenCount(contextWindow),
    autoCompactLabel: autoCompactLimit === null ? null : formatTokenCount(autoCompactLimit),
    tone,
    statusLabel,
  }
}
