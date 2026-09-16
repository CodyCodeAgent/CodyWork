// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Repository, RepositorySyncResult } from '../api'
import RepositoryOverviewCard from './RepositoryOverviewCard.vue'

function repository(patch: Partial<Repository> = {}): Repository {
  return { id: 'repo-1', name: 'service-a', path: '/workspace/services/service-a', originUrl: 'git@example.com:service-a.git', defaultRef: 'main', syncStatus: 'ok', dirty: false, ...patch }
}

function mountCard(repositories: Repository[], patch: Record<string, unknown> = {}) {
  return mount(RepositoryOverviewCard, {
    props: {
      repositories,
      syncingRepositoryId: '',
      syncingAll: false,
      clearingRepositoryId: '',
      syncResults: {},
      bulkProgress: '',
      bulkMessage: '',
      ...patch,
    },
  })
}

describe('RepositoryOverviewCard', () => {
  it('offers bulk and per-repository synchronization', async () => {
    const wrapper = mountCard([repository(), repository({ id: 'repo-2', name: 'service-b' })])
    await wrapper.get('.repository-sync-all').trigger('click')
    await wrapper.findAll('.repository-sync-button')[0]!.trigger('click')

    expect(wrapper.emitted('sync-all')).toHaveLength(1)
    expect(wrapper.emitted('sync')?.[0]).toEqual(['repo-1'])
    expect(wrapper.text()).toContain('仅安全快进主分支')
  })

  it('shows progress and keeps unsafe repositories disabled', () => {
    const dirty = repository({ dirty: true })
    const result: RepositorySyncResult = {
      repositoryId: dirty.id,
      ref: 'main',
      state: 'blocked',
      message: '基线存在未提交改动；未执行同步。',
      localHead: null,
      remoteHead: null,
      commitsBehind: null,
      commitsAhead: null,
      repository: dirty,
    }
    const wrapper = mountCard([dirty], {
      syncingRepositoryId: dirty.id,
      syncingAll: true,
      syncResults: { [dirty.id]: result },
      bulkProgress: '1/3',
    })

    expect(wrapper.get('.repository-sync-all').text()).toBe('1/3')
    expect(wrapper.get('.repository-sync-button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('基线存在未提交改动')
  })
})
