// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSkill } from '../api'
import QuickActionSettings from './QuickActionSettings.vue'

const skill: WorkspaceSkill = { id: '/repo/review/SKILL.md', name: 'review', displayName: 'Review', description: 'Review changes', path: '/repo/review/SKILL.md', source: 'workspace', scope: 'repo', status: 'available', modelInvocable: true, content: '', updatedAt: '' }

describe('QuickActionSettings', () => {
  it('creates a command with multiple structured fields', async () => {
    const wrapper = mount(QuickActionSettings, { props: { actions: [], skills: [skill], selectedId: '', saving: false, message: '' } })
    await wrapper.get('#quick-action-name').setValue('检查实现')
    await wrapper.get('#quick-action-prompt').setValue('检查代码并补齐测试')
    await wrapper.get('.skill-option input').setValue(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]).toEqual([{ name: '检查实现', prompt: '检查代码并补齐测试', skillIds: ['/repo/review/SKILL.md'], scenes: ['demand-development'], enabled: true }])
  })

  it('keeps invalid forms local instead of emitting a request', async () => {
    const wrapper = mount(QuickActionSettings, { props: { actions: [], skills: [], selectedId: '', saving: false, message: '' } })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('请输入指令名称')
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('names and removes missing Skills so the command can be repaired', async () => {
    const wrapper = mount(QuickActionSettings, { props: {
      actions: [{
        id: 'action-1', workspaceId: 'workspace-1', name: '检查实现', prompt: '检查代码', enabled: true, sortOrder: 0,
        skillIds: ['/skills/global-review/SKILL.md'],
        skills: [{ id: '/skills/global-review/SKILL.md', name: 'global-review', status: 'missing' }],
        missingSkillIds: ['/skills/global-review/SKILL.md'], scenes: ['demand-development'], revision: 1,
        lastEditedVia: 'settings', sourceConversationId: null, sourceTurnId: null, createdAt: '', updatedAt: '',
      }],
      skills: [skill], selectedId: 'action-1', saving: false, message: '',
    } })
    expect(wrapper.get('[role="alert"]').text()).toContain('global-review')
    await wrapper.get('[role="alert"] button').trigger('click')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual(expect.objectContaining({ skillIds: [] }))
  })

  it('shows that an agent-authored command is traceable to its source conversation', async () => {
    const wrapper = mount(QuickActionSettings, { props: {
      actions: [{
        id: 'agent-action', workspaceId: 'workspace-1', name: 'AI 检查', prompt: '检查当前需求', enabled: true, sortOrder: 0,
        skillIds: [], skills: [], missingSkillIds: [], scenes: ['demand-development'], revision: 3,
        lastEditedVia: 'agent', sourceConversationId: 'conversation-1', sourceTurnId: 'turn-3', createdAt: '', updatedAt: '',
      }],
      skills: [], selectedId: 'agent-action', saving: false, message: '',
    } })
    expect(wrapper.get('.editor-meta').text()).toBe('v3 · 由需求会话内 AI 更新')
    expect(wrapper.get('.editor-meta').attributes('title')).toContain('conversation-1')
  })
})
