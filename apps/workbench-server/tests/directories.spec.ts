import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBrowsableDirectories } from '../src/services/directories.js'

describe('server directory picker', () => {
  it('lists only direct directories inside the approved root', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-directories-'))
    try {
      mkdirSync(join(root, 'zeta'))
      mkdirSync(join(root, 'alpha', 'nested'), { recursive: true })
      symlinkSync(tmpdir(), join(root, 'outside-link'))
      const listing = listBrowsableDirectories(root, [root])
      const canonicalRoot = realpathSync(root)
      expect(listing.current).toBe(canonicalRoot)
      expect(listing.parent).toBeNull()
      expect(listing.directories.map(entry => entry.name)).toEqual(['alpha', 'zeta'])
      const nested = listBrowsableDirectories(join(root, 'alpha'), [root])
      expect(nested.parent).toBe(canonicalRoot)
      expect(nested.directories.map(entry => entry.name)).toEqual(['nested'])
      expect(() => listBrowsableDirectories(tmpdir(), [root])).toThrow('允许浏览范围')
      expect(() => listBrowsableDirectories(join(root, 'outside-link'), [root])).toThrow('允许浏览范围')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
