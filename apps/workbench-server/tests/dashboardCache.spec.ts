import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchDb, WorkspaceRow, makeId, nowIso } from '../src/db/index.js'
import { DashboardCache, type DashboardData } from '../src/services/dashboardCache.js'

function workspace(db: WorkbenchDb): WorkspaceRow {
  const now = nowIso()
  const row = { id: makeId('ws'), name: 'cache-fixture', path: '/tmp/cache-fixture', created_at: now, last_opened_at: now }
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(row.id, row.name, row.path, row.created_at, row.last_opened_at)
  return row
}

function snapshot(): DashboardData {
  return {
    generatedAt: nowIso(),
    demands: { total: 2, inProgress: 1, completed: 1, blocked: 0 },
    repositories: { total: 3, normal: 2, dirty: 1, pullFailed: 0 },
    codeChanges: { additions: 8, deletions: 2, filesChanged: 3 },
    knowledge: { documents: 4, lastUpdatedAt: null },
    skills: { available: 2, disabled: 0, loadFailed: 0 },
  }
}

describe('dashboard cache', () => {
  it('returns an immediate empty view and deduplicates concurrent refreshes', async () => {
    const db = new WorkbenchDb(':memory:')
    const row = workspace(db)
    let calls = 0
    let resolveCollector: ((value: DashboardData) => void) | undefined
    const cache = new DashboardCache(db, async () => {
      calls += 1
      return new Promise<DashboardData>(resolve => { resolveCollector = resolve })
    })

    expect(cache.read(row).cache.state).toBe('empty')
    expect(cache.refresh(row).cache.state).toBe('refreshing')
    expect(cache.refresh(row).cache.state).toBe('refreshing')
    expect(calls).toBe(1)
    resolveCollector?.(snapshot())
    await cache.waitForIdle()

    const cached = cache.read(row)
    expect(cached.cache.state).toBe('fresh')
    expect(cached.demands.total).toBe(2)
    expect(cached.codeChanges.filesChanged).toBe(3)
    db.close()
  })

  it('runs the default collector in a worker and persists its snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-dashboard-worker-'))
    try {
      for (const entry of ['services', 'docs', 'specs', 'worktrees']) mkdirSync(join(root, entry))
      const db = new WorkbenchDb(join(root, 'workspace.db'))
      const row = workspace(db)
      db.db.prepare('UPDATE workspaces SET path = ? WHERE id = ?').run(root, row.id)
      const cache = new DashboardCache(db)
      cache.refresh({ ...row, path: root })
      await cache.waitForIdle()
      expect(cache.read({ ...row, path: root }).cache.state).toBe('fresh')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not spin failed stale refreshes until an explicit retry', async () => {
    const db = new WorkbenchDb(':memory:')
    const row = workspace(db)
    let calls = 0
    const cache = new DashboardCache(db, async () => {
      calls += 1
      throw new Error('fixture refresh failed')
    })

    cache.refresh(row)
    await cache.waitForIdle()
    const failed = cache.refreshIfStale(row)
    expect(failed.cache).toMatchObject({ state: 'stale', lastError: 'fixture refresh failed' })
    expect(calls).toBe(1)

    cache.refresh(row)
    await cache.waitForIdle()
    expect(calls).toBe(2)
    db.close()
  })
})
