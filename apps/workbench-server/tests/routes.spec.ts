import { describe, expect, it } from 'vitest'
import { normalizeRepositoryInput } from '../src/routes/index.js'

describe('repository route payload compatibility', () => {
  it('accepts the flat folder payload emitted by CodyWork web', () => {
    expect(normalizeRepositoryInput({ source: 'folder', path: '/tmp/repo', name: 'demo' })).toEqual({
      source: 'folder',
      path: '/tmp/repo',
      name: 'demo',
    })
  })

  it('accepts the flat git payload without a fake target path', () => {
    expect(normalizeRepositoryInput({ source: 'git', url: 'git@example.com:org/repo.git', name: 'demo' })).toEqual({
      source: 'git',
      url: 'git@example.com:org/repo.git',
      name: 'demo',
    })
  })

  it('rejects unknown source values instead of silently treating them as Git', () => {
    expect(() => normalizeRepositoryInput({ source: 'archive', path: '/tmp/repo' })).toThrow('Repo source 必须是 folder 或 git')
  })
})
