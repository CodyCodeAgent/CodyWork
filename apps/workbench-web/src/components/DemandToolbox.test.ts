// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Demand, QuickAction } from '../api'
import DemandToolbox from './DemandToolbox.vue'

const demand: Demand = {
  id: 'demand', name: '结算修复', branchName: 'fix/settlement', worktreeKey: 'settlement', path: '/worktrees/settlement',
  status: 'in_progress', createdAt: '', updatedAt: '', repositories: [],
}

function action(patch: Partial<QuickAction> = {}): QuickAction {
  return { id: 'action', workspaceId: 'workspace', name: '检查实现', prompt: '检查实现', enabled: true, sortOrder: 0, skillIds: [], skills: [], missingSkillIds: [], scenes: ['demand-development'], createdAt: '', updatedAt: '', ...patch }
}

function toolbox(actions: QuickAction[], disabled = false) {
  return mount(DemandToolbox, {
    props: {
      demand, repositories: [], usage: null, canSettle: true, settleTitle: '沉淀', canAddRepository: true,
      syncingRepositoryId: '', clearingRepositoryId: '', syncResults: {}, quickActions: actions, quickActionsDisabled: disabled, quickActionFeedback: '',
    },
  })
}

describe('DemandToolbox', () => {
  it('keeps quick actions in the toolbox and emits the selected action', async () => {
    const valid = action()
    const stale = action({ id: 'stale', name: '失效指令', missingSkillIds: ['workspace:gone'], skills: [{ id: 'workspace:gone', name: 'gone', status: 'missing' }] })
    const wrapper = toolbox([valid, stale])
    expect(wrapper.find('.toolbox-quick-action').exists()).toBe(false)
    await wrapper.find('.demand-toolbox-trigger').trigger('click')
    const actions = wrapper.findAll('.toolbox-quick-action')
    expect(actions).toHaveLength(2)
    expect(actions[1]!.attributes('disabled')).toBeDefined()
    await actions[0]!.trigger('click')
    expect(wrapper.emitted('execute-quick-action')?.[0]).toEqual([valid])
    expect(wrapper.find('.demand-toolbox-panel').exists()).toBe(false)
  })
})
