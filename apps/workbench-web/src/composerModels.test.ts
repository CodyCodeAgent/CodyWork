import { describe, expect, it } from 'vitest'
import { initialModelId, reasoningOptionsForModel, reconcileReasoningEffort, type ComposerModel } from './composerModels'

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
})
