import { describe, expect, it } from 'vitest'
import { initialModelId, modelDescription, reasoningOptionsForModel, reconcileReasoningEffort, type ComposerModel } from './composerModels'

const models: ComposerModel[] = [{
  id: 'model-a',
  label: 'Model A',
  description: '',
  isDefault: false,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: ['low', 'medium', 'high'],
}, {
  id: 'model-b',
  label: 'Model B',
  description: '',
  isDefault: true,
  defaultReasoningEffort: 'low',
  supportedReasoningEfforts: ['low', 'high', 'xhigh'],
}]

describe('composer model capabilities', () => {
  it('selects the provider default model', () => {
    expect(initialModelId(models)).toBe('model-b')
  })

  it('shows only reasoning efforts advertised by the selected model', () => {
    expect(reasoningOptionsForModel(models, 'model-b')).toEqual([
      { value: 'low', label: '低' },
      { value: 'high', label: '高' },
      { value: 'xhigh', label: '极高' },
    ])
  })

  it('keeps a supported effort and falls back to the provider default otherwise', () => {
    expect(reconcileReasoningEffort(models, 'model-b', 'high')).toBe('high')
    expect(reconcileReasoningEffort(models, 'model-b', 'none')).toBe('low')
  })

  it('formats provider model metadata for the picker description', () => {
    expect(modelDescription({
      ...models[1],
      description: '推荐复杂任务',
      metadata: {
        contextWindow: 272000,
        maxContextWindow: 800000,
        supportsMaxMode: true,
        loadPercent: 54,
        weeklyQuota: { applies: true, isDepleted: false, remainingPercent: 88 },
      },
    })).toBe('推荐复杂任务 · 上下文 272K · Max 上下文 800K · 当前负载 54% · 周额度剩余 88%')
  })

  it('makes a depleted weekly quota explicit', () => {
    expect(modelDescription({
      ...models[1],
      metadata: { weeklyQuota: { applies: true, isDepleted: true } },
    })).toContain('周额度已耗尽')
  })
})
