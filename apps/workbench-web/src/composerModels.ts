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
