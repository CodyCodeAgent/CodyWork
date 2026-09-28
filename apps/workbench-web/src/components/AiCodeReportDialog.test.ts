// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiCodeReportDialog from './AiCodeReportDialog.vue'
import type { AiReportDemandSummary } from '../api'

const summary: AiReportDemandSummary = {
  state: 'healthy',
  capability: { state: 'ready', hooks: ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'], missingHooks: [], exportAvailable: true, retryAvailable: true, message: '完整 Hook 已启用。' },
  acceptedEvents: 23,
  acceptedCodeEvents: 7,
  additions: 1284,
  deletions: 336,
  netLines: 948,
  effectiveLines: 811,
  effectiveLinesNote: '按 TEA 已接收 patch 与需求基线 diff 的非空行交集计算。',
  pending: 0,
  retrying: 0,
  lastSuccessAt: '2026-09-28T08:00:00.000Z',
  conversations: [{ conversationId: 'conversation', nativeSessionId: 'session-native-id', title: '需求沟通', acceptedEvents: 23, acceptedCodeEvents: 7, additions: 1284, deletions: 336, lastSuccessAt: '2026-09-28T08:00:00.000Z' }],
  recent: [{ deliveryId: 'delivery', conversationId: 'conversation', conversationTitle: '需求沟通', eventType: 'dev_agent_tool_call', toolName: 'apply_patch', model: 'gpt-test', filePath: 'src/service.ts', status: 'ok', additions: 12, deletions: 3, eventTime: '2026-09-28T08:00:00.000Z', receivedAt: '2026-09-28T08:00:01.000Z' }],
  refreshedAt: '2026-09-28T08:00:02.000Z',
  warning: '',
}

describe('AiCodeReportDialog', () => {
  it('shows TEA acknowledgements, effective lines, and no raw code payload', async () => {
    const wrapper = mount(AiCodeReportDialog, { global: { stubs: { Teleport: true } }, props: { visible: true, summary, loading: false, action: '', error: '', message: '' } })
    expect(wrapper.text()).toContain('TEA 已接收')
    expect(wrapper.text()).toContain('当前有效 AI 代码')
    expect(wrapper.text()).toContain('811')
    expect(wrapper.text()).toContain('src/service.ts')
    expect(wrapper.text()).toContain('不展示 patch 或命令正文')
    const buttons = wrapper.findAll('button')
    await buttons.find(button => button.text() === '补扫当前需求')!.trigger('click')
    expect(wrapper.emitted('backfill')).toHaveLength(1)
    wrapper.unmount()
  })

  it('disables manual actions when the reporter is absent', () => {
    const absent: AiReportDemandSummary = { ...summary, state: 'not_installed', capability: { state: 'not_installed', hooks: [], missingHooks: ['SessionStart'], exportAvailable: false, retryAvailable: false, message: '未安装，不影响 CodyWork。' } }
    const wrapper = mount(AiCodeReportDialog, { global: { stubs: { Teleport: true } }, props: { visible: true, summary: absent, loading: false, action: '', error: '', message: '' } })
    expect(wrapper.text()).toContain('当前机器未安装')
    expect(wrapper.findAll('button').find(button => button.text() === '补扫当前需求')?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
