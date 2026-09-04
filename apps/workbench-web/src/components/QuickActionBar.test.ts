// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { QuickAction } from '../api'
import QuickActionBar from './QuickActionBar.vue'

function action(patch: Partial<QuickAction> = {}): QuickAction {
  return { id: 'action', workspaceId: 'workspace', name: '检查实现', prompt: '检查实现', enabled: true, sortOrder: 0, skillIds: [], skills: [], missingSkillIds: [], scenes: ['demand-development'], createdAt: '', updatedAt: '', ...patch }
}

describe('QuickActionBar', () => {
  it('executes a valid action and disables one with stale Skills', async () => {
    const valid = action()
    const stale = action({ id: 'stale', name: '失效指令', missingSkillIds: ['workspace:gone'], skills: [{ id: 'workspace:gone', name: 'gone', status: 'missing' }] })
    const wrapper = mount(QuickActionBar, { props: { actions: [valid, stale], disabled: false, feedback: '' } })
    const buttons = wrapper.findAll('.quick-chip')
    expect(buttons[1]!.attributes('disabled')).toBeDefined()
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('execute')?.[0]).toEqual([valid])
  })
})
