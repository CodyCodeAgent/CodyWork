// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Demand, QuickAction } from '../api'
import type { FluxIntegration, ToolboxInstruction } from '../fluxQuickActions'
import DemandToolbox from './DemandToolbox.vue'

const demand: Demand = {
  id: 'demand', name: '结算修复', branchName: 'fix/settlement', worktreeKey: 'settlement', path: '/worktrees/settlement',
  status: 'in_progress', fluxBinding: null, createdAt: '', updatedAt: '', repositories: [],
}

function action(patch: Partial<QuickAction> = {}): QuickAction {
  return { id: 'action', workspaceId: 'workspace', name: '检查实现', prompt: '检查实现', enabled: true, sortOrder: 0, skillIds: [], skills: [], missingSkillIds: [], scenes: ['demand-development'], revision: 1, lastEditedVia: 'settings', sourceConversationId: null, sourceTurnId: null, createdAt: '', updatedAt: '', ...patch }
}

function toolbox(actions: QuickAction[], disabled = false, fluxIntegration: FluxIntegration | null = null, target: Demand = demand) {
  return mount(DemandToolbox, {
    props: {
      demand: target, repositories: [], usage: null, canSettle: true, settleTitle: '沉淀', canAddRepository: true,
      syncingRepositoryId: '', clearingRepositoryId: '', syncResults: {}, quickActions: actions, fluxIntegration, fluxSkillInstalling: false, quickActionsDisabled: disabled, quickActionFeedback: '',
      canCompact: true, compacting: false, compactMessage: '',
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

  it('offers manual context compaction without closing the toolbox', async () => {
    const wrapper = toolbox([])
    await wrapper.find('.demand-toolbox-trigger').trigger('click')
    await wrapper.findAll('.toolbox-action .btn').at(0)!.trigger('click')
    expect(wrapper.emitted('compact')).toHaveLength(1)
    expect(wrapper.find('.demand-toolbox-panel').exists()).toBe(true)
  })

  it('shows a ready bound Flux integration and emits a typed instruction', async () => {
    const fluxDemand: Demand = {
      ...demand,
      fluxBinding: {
        deliveryId: '95455704273397855',
        spaceId: '91115103721654403',
        url: 'https://flux.bytedance.net/home/91115103721654403/collaboration/95455704273397855',
        previewTaskId: null,
      },
    }
    const fluxInstruction: ToolboxInstruction = { id: 'builtin:flux:understand', name: '理解当前协作', prompt: 'read Flux', skillIds: ['flux-skill'] }
    const integration: FluxIntegration = { status: 'ready', skillLabel: 'Flux 协作区管理', instructions: [fluxInstruction] }
    const wrapper = toolbox([], false, integration, fluxDemand)
    await wrapper.find('.demand-toolbox-trigger').trigger('click')
    expect(wrapper.get('.flux-binding-summary').text()).toContain('95455704273397855')
    expect(wrapper.get('.flux-quick-action').text()).toContain('理解当前协作')
    await wrapper.get('.flux-quick-action').trigger('click')
    expect(wrapper.emitted('execute-flux-instruction')?.[0]).toEqual([fluxInstruction])
  })

  it('keeps Flux instructions disabled until the official Skill is installed', async () => {
    const fluxDemand: Demand = { ...demand, fluxBinding: { deliveryId: 'delivery', spaceId: 'space', url: 'https://flux.bytedance.net/home/space/collaboration/delivery', previewTaskId: null } }
    const integration: FluxIntegration = { status: 'missing-skill', skillLabel: 'flux-collab', instructions: [{ id: 'builtin:flux:understand', name: '理解当前协作', prompt: 'read', skillIds: [] }] }
    const wrapper = toolbox([], false, integration, fluxDemand)
    await wrapper.find('.demand-toolbox-trigger').trigger('click')
    expect(wrapper.get('.flux-quick-action').attributes('disabled')).toBeDefined()
    await wrapper.get('.flux-skill-setup .btn').trigger('click')
    expect(wrapper.emitted('install-flux-skill')).toHaveLength(1)
  })
})
