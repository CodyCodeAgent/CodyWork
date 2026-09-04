// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSkill } from '../api'
import QuickActionSettings from './QuickActionSettings.vue'

const skill: WorkspaceSkill = { id: 'workspace:review', name: 'review', description: 'Review changes', path: '/repo/review/SKILL.md', source: 'workspace', status: 'available', modelInvocable: true, content: '', updatedAt: '' }

describe('QuickActionSettings', () => {
  it('creates a command with multiple structured fields', async () => {
    const wrapper = mount(QuickActionSettings, { props: { actions: [], skills: [skill], selectedId: '', saving: false, message: '' } })
    await wrapper.get('#quick-action-name').setValue('检查实现')
    await wrapper.get('#quick-action-prompt').setValue('检查代码并补齐测试')
    await wrapper.get('.skill-option input').setValue(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]).toEqual([{ name: '检查实现', prompt: '检查代码并补齐测试', skillIds: ['workspace:review'], scenes: ['demand-development'], enabled: true }])
  })

  it('keeps invalid forms local instead of emitting a request', async () => {
    const wrapper = mount(QuickActionSettings, { props: { actions: [], skills: [], selectedId: '', saving: false, message: '' } })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('请输入指令名称')
    expect(wrapper.emitted('save')).toBeUndefined()
  })
})
