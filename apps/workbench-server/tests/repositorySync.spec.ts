import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkbenchDb, makeId, nowIso, type WorkspaceRow } from '../src/db/index.js'
import { clearRepositoryBaselineChanges, ensureCodyWorkControlPlaneIgnored, listRepositories, syncRepositoryBaseline } from '../src/services/repositories.js'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cody-repository-sync-'))
  const services = join(root, 'services')
  const baseline = join(services, 'demo')
  const remote = join(root, 'origin.git')
  const updater = join(root, 'updater')
  mkdirSync(services, { recursive: true })
  git(root, ['init', '--bare', remote])
  git(root, ['init', baseline])
  git(baseline, ['checkout', '-b', 'main'])
  git(baseline, ['config', 'user.email', 'test@example.com'])
  git(baseline, ['config', 'user.name', 'Test'])
  writeFileSync(join(baseline, 'README.md'), '# baseline\n')
  git(baseline, ['add', 'README.md'])
  git(baseline, ['commit', '-m', 'initial'])
  git(baseline, ['remote', 'add', 'origin', remote])
  git(baseline, ['push', '-u', 'origin', 'main'])
  git(root, ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(root, ['clone', remote, updater])
  git(updater, ['config', 'user.email', 'test@example.com'])
  git(updater, ['config', 'user.name', 'Test'])

  const db = new WorkbenchDb(':memory:')
  const now = nowIso()
  const workspace: WorkspaceRow = { id: makeId('ws'), name: 'sync fixture', path: root, created_at: now, last_opened_at: now }
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
    .run(workspace.id, workspace.name, workspace.path, workspace.created_at, workspace.last_opened_at)
  const repository = listRepositories(db, workspace)[0]!
  return { root, baseline, updater, db, workspace, repository }
}

describe('safe repository baseline synchronization', () => {
  it('fetches and fast-forwards a clean baseline without rewriting history', () => {
    const test = createFixture()
    writeFileSync(join(test.updater, 'remote.md'), 'from origin\n')
    git(test.updater, ['add', 'remote.md'])
    git(test.updater, ['commit', '-m', 'remote update'])
    git(test.updater, ['push'])

    const result = syncRepositoryBaseline(test.db, test.workspace, test.repository.id)

    expect(result).toMatchObject({ state: 'fast_forwarded', commitsBehind: 1, commitsAhead: 0, ref: 'main' })
    expect(git(test.baseline, ['rev-parse', 'HEAD'])).toBe(git(test.updater, ['rev-parse', 'HEAD']))
    expect(git(test.baseline, ['status', '--porcelain=v1'])).toBe('')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('refuses to sync a baseline with uncommitted local changes', () => {
    const test = createFixture()
    const before = git(test.baseline, ['rev-parse', 'HEAD'])
    writeFileSync(join(test.baseline, 'local-only.md'), 'do not overwrite\n')

    const result = syncRepositoryBaseline(test.db, test.workspace, test.repository.id)

    expect(result).toMatchObject({ state: 'blocked' })
    expect(result.message).toContain('未提交改动')
    expect(git(test.baseline, ['rev-parse', 'HEAD'])).toBe(before)
    expect(git(test.baseline, ['status', '--porcelain=v1'])).toContain('local-only.md')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('clears only uncommitted baseline changes and preserves a Demand Worktree', () => {
    const test = createFixture()
    const demandWorktree = join(test.baseline, 'worktrees', 'demand')
    ensureCodyWorkControlPlaneIgnored(test.baseline)
    git(test.baseline, ['worktree', 'add', '-b', 'codex/demand', demandWorktree])
    writeFileSync(join(demandWorktree, 'demand-only.md'), 'keep this worktree\n')
    writeFileSync(join(test.baseline, 'README.md'), '# changed baseline\n')
    writeFileSync(join(test.baseline, 'local-only.md'), 'discard this file\n')

    const result = clearRepositoryBaselineChanges(test.db, test.workspace, test.repository.id)

    expect(result).toMatchObject({ state: 'cleaned', discardedTrackedChanges: 1, discardedUntrackedFiles: 1 })
    expect(git(test.baseline, ['status', '--porcelain=v1'])).toBe('')
    expect(git(demandWorktree, ['status', '--porcelain=v1'])).toContain('demand-only.md')
    expect(() => execFileSync('test', ['-f', join(test.baseline, 'local-only.md')])).toThrow()
    expect(git(test.baseline, ['worktree', 'list', '--porcelain'])).toContain(demandWorktree)
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })
})
