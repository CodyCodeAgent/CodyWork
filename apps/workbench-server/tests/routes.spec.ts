import { describe, expect, it } from 'vitest'
import { isAllowedOrigin, normalizeRepositoryInput } from '../src/routes/index.js'

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

describe('route origin policy', () => {
  it('allows loopback development origins on arbitrary ports', () => {
    expect(isAllowedOrigin('http://localhost:3215')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:4317')).toBe(true)
    expect(isAllowedOrigin('http://[::1]:8080')).toBe(true)
  })

  it('allows the origin serving the same CodyWork host', () => {
    expect(isAllowedOrigin('http://10.37.222.12:3001', '10.37.222.12:3001')).toBe(true)
  })

  it('rejects unrelated origins', () => {
    expect(isAllowedOrigin('https://example.com')).toBe(false)
    expect(isAllowedOrigin('not-an-origin')).toBe(false)
  })
})
