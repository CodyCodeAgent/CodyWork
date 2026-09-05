// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Demand, Repository } from '../api'
import AddDemandRepositoryDialog from './AddDemandRepositoryDialog.vue'

const demand: Demand = {
  id: 'demand', name: 'Search repositories', branchName: 'feat/search', worktreeKey: 'search', path: '/workspace/worktrees/search',
  status: 'in_progress', createdAt: '', updatedAt: '', repositories: [],
}

const repositories: Repository[] = [
  { id: 'admin', name: 'market-admin', path: '/workspace/services/market-admin', originUrl: null, defaultRef: 'main', syncStatus: 'ok', dirty: false },
  { id: 'assets', name: 'assets-api', path: '/workspace/services/assets-api', originUrl: null, defaultRef: 'release/2026', syncStatus: 'ok', dirty: false },
]

function dialog(selectedRepositoryId = '') {
  return mount(AddDemandRepositoryDialog, {
    props: { visible: true, demand, repositories, selectedRepositoryId, adding: false, error: '' },
  })
}

describe('AddDemandRepositoryDialog', () => {
  it('filters by the shared repository fields and restores the full list when cleared', async () => {
    const wrapper = dialog()
    const search = wrapper.get('#add-demand-repository-search')

    await search.setValue('release/2026')
    expect(wrapper.findAll('.repo-option')).toHaveLength(1)
    expect(wrapper.text()).toContain('assets-api')
    expect(wrapper.text()).not.toContain('market-admin')
    expect(wrapper.get('[role="status"]').text()).toBe('1 / 2 个匹配')

    await wrapper.get('.repo-search-clear').trigger('click')
    expect(wrapper.findAll('.repo-option')).toHaveLength(2)
    expect(wrapper.get('[role="status"]').text()).toBe('2 个可选 Repo')
  })

  it('shows a helpful empty state and clears a selection hidden by the query', async () => {
    const wrapper = dialog('admin')
    await wrapper.get('#add-demand-repository-search').setValue('missing')

    expect(wrapper.findAll('.repo-option')).toHaveLength(0)
    expect(wrapper.text()).toContain('可尝试项目名、路径或分支名')
    expect(wrapper.emitted('update:selectedRepositoryId')?.at(-1)).toEqual([''])
  })

  it('starts with a fresh search each time the dialog is reopened', async () => {
    const wrapper = dialog()
    await wrapper.get('#add-demand-repository-search').setValue('assets')

    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })

    expect(wrapper.get<HTMLInputElement>('#add-demand-repository-search').element.value).toBe('')
    expect(wrapper.findAll('.repo-option')).toHaveLength(2)
  })
})
