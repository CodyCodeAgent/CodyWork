// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiCodeReportDialog from './AiCodeReportDialog.vue'
import type { AiReportDemandSummary } from '../api'

const summary: AiReportDemandSummary = {
  state: 'healthy',
  capability: { state: 'ready', hooks: ['PostToolUse', 'Stop', 'SubagentStop'], missingHooks: [], exportAvailable: true, retryAvailable: true, message: '完整 Hook 已启用。', sources: [{ id: 'codex', label: 'Codex Hook', state: 'ready', message: '完整 Hook 已启用。' }, { id: 'trae', label: 'TraeX AI Contribution', state: 'not_installed', message: '未发现回执。' }] },
  acceptedEvents: 23,
  acceptedCodeEvents: 7,
  additions: 1284,
  deletions: 336,
  netLines: 948,
  lineStatsAvailable: true,
  effectiveLines: 811,
  effectiveLinesNote: '按 TEA 已接收 patch 与需求基线 diff 的非空行交集计算。',
  worktreeChanges: { available: true, additions: 1312, deletions: 336, repositoriesChecked: 1, repositoriesTotal: 1, note: '相对需求基线的当前 Git 工作区变更，可能包含人工修改，未按 AI 归因。' },
  pending: 0,
  retrying: 0,
  lastSuccessAt: '2026-09-28T08:00:00.000Z',
  conversations: [{ conversationId: 'conversation', nativeSessionId: 'session-native-id', title: '需求沟通', runtimeType: 'codex', acceptedEvents: 23, acceptedCodeEvents: 7, additions: 1284, deletions: 336, lastSuccessAt: '2026-09-28T08:00:00.000Z' }],
  recent: [{ deliveryId: 'delivery', conversationId: 'conversation', conversationTitle: '需求沟通', eventType: 'dev_agent_tool_call', toolName: 'apply_patch', model: 'gpt-test', filePath: 'src/service.ts', status: 'ok', eventCount: 1, additions: 12, deletions: 3, eventTime: '2026-09-28T08:00:00.000Z', receivedAt: '2026-09-28T08:00:01.000Z' }],
  refreshedAt: '2026-09-28T08:00:02.000Z',
  warning: '',
}

describe('AiCodeReportDialog', () => {
  it('shows TEA acknowledgements, effective lines, and no raw code payload', async () => {
    const wrapper = mount(AiCodeReportDialog, { global: { stubs: { Teleport: true } }, props: { visible: true, summary, loading: false, action: '', error: '', message: '' } })
    expect(wrapper.text()).toContain('TEA 已接收')
    expect(wrapper.text()).toContain('当前有效 AI 代码')
    expect(wrapper.text()).toContain('811')
    expect(wrapper.text()).toContain('当前 Worktree 变更')
    expect(wrapper.text()).toContain('+1,312 / −336')
    expect(wrapper.text()).toContain('src/service.ts')
    expect(wrapper.text()).toContain('不展示 patch 或命令正文')
    const buttons = wrapper.findAll('button')
    await buttons.find(button => button.text() === '补扫 Codex 会话')!.trigger('click')
    expect(wrapper.emitted('backfill')).toHaveLength(1)
    wrapper.unmount()
  })

  it('disables manual actions when the reporter is absent', () => {
    const absent: AiReportDemandSummary = { ...summary, state: 'not_installed', capability: { state: 'not_installed', hooks: [], missingHooks: ['PostToolUse'], exportAvailable: false, retryAvailable: false, message: '未安装，不影响 CodyWork。', sources: [{ id: 'codex', label: 'Codex Hook', state: 'not_installed', message: '未安装。' }, { id: 'trae', label: 'TraeX AI Contribution', state: 'not_installed', message: '未安装。' }] } }
    const wrapper = mount(AiCodeReportDialog, { global: { stubs: { Teleport: true } }, props: { visible: true, summary: absent, loading: false, action: '', error: '', message: '' } })
    expect(wrapper.text()).toContain('当前机器未安装')
    expect(wrapper.findAll('button').find(button => button.text() === '补扫 Codex 会话')?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('shows TraeX batches as code-event counts instead of zero line metrics', () => {
    const trae: AiReportDemandSummary = {
      ...summary,
      acceptedEvents: 2,
      acceptedCodeEvents: 2,
      additions: 0,
      deletions: 0,
      lineStatsAvailable: false,
      effectiveLines: null,
      effectiveLinesNote: 'TraeX 生产回执仅保留代码事件数量，不保留 patch 行级信息。',
      conversations: [{ ...summary.conversations[0], runtimeType: 'trae', acceptedEvents: 2, acceptedCodeEvents: 2, additions: 0, deletions: 0 }],
      recent: [{ ...summary.recent[0], deliveryId: 'traex:batch', eventType: 'ai_contribution_delivery', toolName: 'TraeX ai-contribution', model: 'Trae ACP', eventCount: 2, additions: 0, deletions: 0 }],
    }
    const wrapper = mount(AiCodeReportDialog, { global: { stubs: { Teleport: true } }, props: { visible: true, summary: trae, loading: false, action: '', error: '', message: '' } })
    expect(wrapper.text()).toContain('2 条代码事件')
    expect(wrapper.text()).toContain('TraeX 生产回执未保留 patch 行级信息')
    expect(wrapper.text()).toContain('Trae ACP')
    expect(wrapper.text()).not.toContain('Codex 上报配置不完整')
    expect(wrapper.text()).not.toContain('Codex 手动操作')
    wrapper.unmount()
  })

  it('scopes a missing Codex Hook warning to Codex conversations without marking TraeX delivery as failed', () => {
    const mixed: AiReportDemandSummary = {
      ...summary,
      capability: {
        ...summary.capability,
        missingHooks: ['PostToolUse', 'Stop'],
        sources: [
          { id: 'codex', label: 'Codex Hook', state: 'partial', message: 'Codex Hook 不完整。' },
          { id: 'trae', label: 'TraeX AI Contribution', state: 'ready', message: 'TraeX 生产回执可读取。' },
        ],
      },
      conversations: [
        summary.conversations[0],
        { ...summary.conversations[0], conversationId: 'trae-conversation', nativeSessionId: 'trae-session', runtimeType: 'trae', title: 'Trae 开发', acceptedEvents: 2, acceptedCodeEvents: 2, additions: 0, deletions: 0 },
      ],
    }
    const wrapper = mount(AiCodeReportDialog, { global: { stubs: { Teleport: true } }, props: { visible: true, summary: mixed, loading: false, action: '', error: '', message: '' } })
    expect(wrapper.text()).toContain('Codex 上报配置不完整')
    expect(wrapper.text()).toContain('仅影响当前需求中的 1 个 Codex 会话')
    expect(wrapper.text()).toContain('TraeX 已确认接收的代码事件不受影响')
    wrapper.unmount()
  })
})
