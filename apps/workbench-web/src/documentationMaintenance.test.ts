import { describe, expect, it } from 'vitest'
import { buildDocumentationMaintenancePrompt } from './documentationMaintenance'

describe('documentation maintenance prompt', () => {
  it('keeps updates inside the current Demand documentation set', () => {
    const prompt = buildDocumentationMaintenancePrompt({ demandName: '支付补偿', branchName: 'fix/payment', conversationTitle: '排查结果' })
    expect(prompt).toContain('Demand: 支付补偿')
    expect(prompt).toContain('Branch: fix/payment')
    expect(prompt).toContain('Source session: 排查结果')
    expect(prompt).toContain('current `docs/` directory')
    expect(prompt).toContain('docs/progress.md')
    expect(prompt).toContain('Do not create a dedicated handover document')
    expect(prompt).toContain('Do not copy the entire transcript')
  })
})
