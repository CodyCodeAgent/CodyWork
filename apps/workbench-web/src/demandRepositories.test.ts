import { describe, expect, it } from 'vitest'
import { filterDemandRepositories, repositoriesNotInDemand } from './demandRepositories'
import type { Demand, Repository } from './api'

const repository = (id: string): Repository => ({ id, name: `repo-${id}`, path: `/workspace/services/repo-${id}`, originUrl: null, defaultRef: 'main', syncStatus: 'ok', dirty: false })
const demand = (repositoryIds: string[]): Demand => ({
  id: 'demand-1', name: 'Demand', branchName: 'feat/demand', worktreeKey: 'demand', path: '/workspace/worktrees/demand', status: 'in_progress', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
  repositories: repositoryIds.map(id => ({ id, name: `repo-${id}`, worktreePath: `/workspace/worktrees/demand/services/repo-${id}` })),
})

describe('repositoriesNotInDemand', () => {
  it('keeps Workspace order and excludes only repositories already in this Demand', () => {
    expect(repositoriesNotInDemand([repository('a'), repository('b'), repository('c')], demand(['b']))
      .map(item => item.id)).toEqual(['a', 'c'])
  })

  it('returns every repository when no Demand is selected', () => {
    expect(repositoriesNotInDemand([repository('a'), repository('b')], null).map(item => item.id)).toEqual(['a', 'b'])
  })
})

describe('filterDemandRepositories', () => {
  const repositories: Repository[] = [
    { ...repository('a'), name: 'life-marketing', path: '/workspace/services/life-marketing', defaultRef: 'main' },
    { ...repository('b'), name: 'assets-api', path: '/workspace/services/assets-api', defaultRef: 'release/2026' },
  ]

  it('matches repository name, path, and default branch without changing source order', () => {
    expect(filterDemandRepositories(repositories, 'marketing').map(item => item.id)).toEqual(['a'])
    expect(filterDemandRepositories(repositories, 'assets-api').map(item => item.id)).toEqual(['b'])
    expect(filterDemandRepositories(repositories, 'release/2026').map(item => item.id)).toEqual(['b'])
  })

  it('returns all repositories for an empty query', () => {
    expect(filterDemandRepositories(repositories, '   ').map(item => item.id)).toEqual(['a', 'b'])
  })
})
