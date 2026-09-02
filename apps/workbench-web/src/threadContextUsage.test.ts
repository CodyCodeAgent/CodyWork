import { describe, expect, it } from 'vitest'
import { buildThreadContextUsagePresentation, formatTokenCount } from './threadContextUsage'

const baseUsage = {
  turnId: 'turn-1',
  usedTokens: 50_000,
  inputTokens: 40_000,
  contextWindow: 258_000,
  autoCompactTokenLimit: 230_000,
  compactionState: 'idle' as const,
  updatedAtIso: '2026-09-02T00:00:00.000Z',
}

describe('thread context usage presentation', () => {
  it('presents remaining capacity without inventing any value', () => {
    expect(buildThreadContextUsagePresentation(baseUsage)).toMatchObject({
      usedLabel: '50.0K',
      remainingLabel: '208K',
      contextWindowLabel: '258K',
      usedPercent: 19,
      autoCompactPercent: 89,
      tone: 'normal',
    })
  })

  it('uses the CodyWeb warning and critical thresholds', () => {
    expect(buildThreadContextUsagePresentation({ ...baseUsage, usedTokens: 190_000 })?.tone).toBe('warning')
    expect(buildThreadContextUsagePresentation({ ...baseUsage, usedTokens: 220_000 })?.tone).toBe('critical')
  })

  it('does not claim a remaining amount when Codex did not supply a window', () => {
    expect(buildThreadContextUsagePresentation({ ...baseUsage, contextWindow: null })).toMatchObject({
      remainingTokens: null,
      remainingLabel: null,
      usedPercent: null,
      tone: 'normal',
    })
  })

  it('formats large token counts compactly', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
  })
})
