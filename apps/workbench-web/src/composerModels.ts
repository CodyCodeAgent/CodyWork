import type { ComposerOptions } from './api'

export type ComposerModel = ComposerOptions['models'][number]

const reasoningLabels: Record<string, string> = {
  none: '无推理',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

export function initialModelId(models: ComposerModel[]): string {
  return models.find(model => model.isDefault)?.id ?? models[0]?.id ?? ''
}

export function reasoningOptionsForModel(models: ComposerModel[], modelId: string): Array<{ value: string; label: string }> {
  const model = models.find(candidate => candidate.id === modelId)
  return (model?.supportedReasoningEfforts ?? []).map(value => ({ value, label: reasoningLabels[value] ?? value }))
}

export function reconcileReasoningEffort(models: ComposerModel[], modelId: string, selectedEffort: string): string {
  const model = models.find(candidate => candidate.id === modelId)
  if (!model) return ''
  return model.supportedReasoningEfforts.includes(selectedEffort as ComposerModel['defaultReasoningEffort'])
    ? selectedEffort
    : model.defaultReasoningEffort
}

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

function percent(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Math.round(value)}%`
}

/** Builds a concise, provider-authoritative description for the native model
 * picker and the selected-model status line. */
export function modelDescription(model: ComposerModel): string {
  const metadata = model.metadata
  const details: string[] = []
  if (metadata?.contextWindow !== undefined) details.push(`上下文 ${compactCount(metadata.contextWindow)}`)
  if (metadata?.supportsMaxMode) {
    details.push(metadata.maxContextWindow !== undefined ? `Max 上下文 ${compactCount(metadata.maxContextWindow)}` : '支持 Max 模式')
  }
  const load = percent(metadata?.loadPercent)
  if (load) details.push(`当前负载 ${load}`)
  const quota = metadata?.weeklyQuota
  if (quota?.applies) {
    if (quota.isDepleted) details.push('周额度已耗尽')
    else {
      const remaining = percent(quota.remainingPercent)
      const used = percent(quota.usedPercent)
      details.push(remaining ? `周额度剩余 ${remaining}` : used ? `本周已用 ${used}` : '适用周额度')
    }
    if (quota.resetTime !== undefined) {
      const reset = new Date(quota.resetTime * 1_000)
      if (!Number.isNaN(reset.valueOf())) details.push(`重置 ${reset.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`)
    }
  }
  return [model.description.trim(), ...details].filter(Boolean).join(' · ')
}
