import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkbenchDb, makeId, nowIso, WorkspaceRow } from '../src/db/index.js'
import { addRepositoryToDemand, createDemand, importExistingWorktrees, listDemands, reconcileDemandOperations } from '../src/services/demands.js'
import { dashboardSnapshot } from '../src/services/dashboard.js'
import { addRepository, listRepositories } from '../src/services/repositories.js'

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cody-demand-'))
  for (const entry of ['services', 'docs', 'specs', 'worktrees']) mkdirSync(join(root, entry))
  for (const name of ['repo1', 'repo2']) {
    const repo = join(root, 'services', name)
    mkdirSync(repo)
    git(repo, ['init', '-b', 'main'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    writeFileSync(join(repo, 'README.md'), `# ${name}\n`)
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'initial'])
  }
  const db = new WorkbenchDb(':memory:')
  const now = nowIso()
  const workspace: WorkspaceRow = { id: makeId('ws'), name: 'fixture', path: root, created_at: now, last_opened_at: now }
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(workspace.id, workspace.name, workspace.path, workspace.created_at, workspace.last_opened_at)
  return { root, db, workspace }
}

describe('demand worktree construction', () => {
  it('keeps a root Git Workspace clean after creating CodyWork-owned Demand worktrees', () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-root-demand-'))
    git(root, ['init', '-b', 'main'])
    git(root, ['config', 'user.email', 'test@example.com'])
    git(root, ['config', 'user.name', 'Test'])
    writeFileSync(join(root, 'README.md'), '# root repository\n')
    git(root, ['add', '.'])
    git(root, ['commit', '-m', 'initial'])
    const excludePath = resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']))
    writeFileSync(excludePath, '# existing local rules\n.local-only\n')

    const db = new WorkbenchDb(':memory:')
    const now = nowIso()
    const workspace: WorkspaceRow = { id: makeId('ws'), name: 'root-repo', path: root, created_at: now, last_opened_at: now }
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(workspace.id, workspace.name, workspace.path, workspace.created_at, workspace.last_opened_at)
    const repositories = listRepositories(db, workspace)
    expect(repositories).toMatchObject([{ baseline_path: root, dirty: 0 }])

    createDemand(db, workspace, { name: 'Runtime diagnostics', branchName: 'codex/runtime-diagnostics', repositoryIds: [repositories[0]!.id] })

    expect(git(root, ['status', '--porcelain=v1'])).toBe('')
    expect(readFileSync(excludePath, 'utf8')).toContain('# existing local rules\n.local-only\n')
    expect(readFileSync(excludePath, 'utf8')).toContain('# CodyWork-managed Demand worktrees\n/worktrees/\n')
    expect(git(join(root, 'worktrees', 'codex__runtime-diagnostics', 'services', root.split('/').at(-1)!), ['branch', '--show-current'])).toBe('codex/runtime-diagnostics')
    expect(listRepositories(db, workspace)[0]?.dirty).toBe(0)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('creates one demand directory with multiple linked worktrees and docs', () => {
    const { root, db, workspace } = fixture()
    const repositories = listRepositories(db, workspace)
    const result = createDemand(db, workspace, { name: 'Coupon rule', repositoryIds: repositories.map(repository => repository.id) })
    expect(result.demand.worktreeKey).toBe('coupon-rule')
    expect(listDemands(db, workspace)[0]?.repositories).toHaveLength(2)
    expect(git(join(root, 'services', 'repo1'), ['branch', '--show-current'])).toBe('main')
    expect(git(join(root, 'worktrees', 'coupon-rule', 'services', 'repo1'), ['branch', '--show-current'])).toBe('coupon-rule')
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('imports an existing multi-repo worktree using its Git branch as the demand name', () => {
    const { root, db, workspace } = fixture()
    const worktreeRoot = join(root, 'worktrees', 'existing-coupon')
    for (const name of ['repo1', 'repo2']) {
      const baseline = join(root, 'services', name)
      mkdirSync(join(worktreeRoot, 'services'), { recursive: true })
      git(baseline, ['worktree', 'add', '-b', 'feature/existing-coupon', join(worktreeRoot, 'services', name)])
    }
    const imported = importExistingWorktrees(db, workspace)
    expect(imported.imported).toEqual([{ id: expect.any(String), name: 'feature/existing-coupon', branchName: 'feature/existing-coupon', worktreeKey: 'existing-coupon', repositories: 2 }])
    expect(listDemands(db, workspace)).toMatchObject([{ name: 'feature/existing-coupon', branchName: 'feature/existing-coupon', worktreeKey: 'existing-coupon', repositories: [{ name: 'repo1' }, { name: 'repo2' }] }])
    expect(importExistingWorktrees(db, workspace)).toEqual({ imported: [], skipped: [] })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('skips an existing worktree when its repositories are on different branches', () => {
    const { root, db, workspace } = fixture()
    const worktreeRoot = join(root, 'worktrees', 'inconsistent')
    mkdirSync(join(worktreeRoot, 'services'), { recursive: true })
    git(join(root, 'services', 'repo1'), ['worktree', 'add', '-b', 'feature/one', join(worktreeRoot, 'services', 'repo1')])
    git(join(root, 'services', 'repo2'), ['worktree', 'add', '-b', 'feature/two', join(worktreeRoot, 'services', 'repo2')])
    expect(importExistingWorktrees(db, workspace)).toEqual({ imported: [], skipped: [{ worktreeKey: 'inconsistent', reason: '多个 Repo 的当前分支不一致' }] })
    expect(listDemands(db, workspace)).toEqual([])
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('skips a same-named repository when it is not linked to the baseline Git repository', () => {
    const { root, db, workspace } = fixture()
    const impostor = join(root, 'worktrees', 'impostor', 'services', 'repo1')
    mkdirSync(impostor, { recursive: true })
    git(impostor, ['init', '-b', 'feature/impostor'])
    git(impostor, ['config', 'user.email', 'test@example.com'])
    git(impostor, ['config', 'user.name', 'Test'])
    writeFileSync(join(impostor, 'README.md'), '# unrelated\n')
    git(impostor, ['add', '.'])
    git(impostor, ['commit', '-m', 'initial'])
    expect(importExistingWorktrees(db, workspace)).toEqual({ imported: [], skipped: [{ worktreeKey: 'impostor', reason: 'repo1 不属于对应基线 Repo 的 Git worktree' }] })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects an empty repository selection before mutating the filesystem', () => {
    const { root, db, workspace } = fixture()
    expect(() => createDemand(db, workspace, { name: 'No repo', repositoryIds: [] })).toThrow('至少选择一个 Repo')
    expect(git(join(root, 'services', 'repo1'), ['branch', '--show-current'])).toBe('main')
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('reports dashboard demand counts after a successful creation', () => {
    const { root, db, workspace } = fixture()
    const ids = listRepositories(db, workspace).map(repository => repository.id)
    const result = createDemand(db, workspace, { name: 'Coupon rule', branchName: 'feature/coupon-rule', repositoryIds: ids })
    expect(result.demand.worktreeKey).toBe('feature__coupon-rule')
    expect(listDemands(db, workspace)[0]?.repositories).toHaveLength(2)
    const snapshot = dashboardSnapshot(db, workspace)
    expect(snapshot.demands).toEqual({ total: 1, inProgress: 1, completed: 0, blocked: 0 })
    expect(snapshot.repositories.total).toBe(2)
    expect(snapshot.codeChanges.filesChanged).toBe(0)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('marks an interrupted operation during startup reconciliation', () => {
    const { root, db, workspace } = fixture()
    const operationId = makeId('op')
    db.db.prepare('INSERT INTO demand_operations (id, workspace_id, status, request_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(operationId, workspace.id, 'creating', '{}', nowIso())
    expect(reconcileDemandOperations(db)).toBe(1)
    expect(db.db.prepare('SELECT status, error FROM demand_operations WHERE id = ?').get(operationId)).toMatchObject({ status: 'failed' })
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('aggregates tracked and untracked worktree changes against the captured base commit', () => {
    const { root, db, workspace } = fixture()
    const repositories = listRepositories(db, workspace)
    createDemand(db, workspace, { name: 'Changed demand', repositoryIds: [repositories[0]!.id] })
    const worktree = join(root, 'worktrees', 'changed-demand', 'services', 'repo1')
    writeFileSync(join(worktree, 'README.md'), '# repo1\nchanged line\n')
    writeFileSync(join(worktree, 'new.txt'), 'one\ntwo\n')
    const snapshot = dashboardSnapshot(db, workspace)
    expect(snapshot.codeChanges.filesChanged).toBe(2)
    expect(snapshot.codeChanges.additions).toBeGreaterThanOrEqual(3)
    expect(snapshot.codeChanges.deletions).toBeGreaterThanOrEqual(0)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('adds a Repo after Workspace creation and attaches it to an existing demand', () => {
    const { root, db, workspace } = fixture()
    const added = addRepository(db, workspace, { source: 'folder', path: join(root, 'services', 'repo2'), name: 'repo3' })
    expect(added.name).toBe('repo3')
    const repo1 = listRepositories(db, workspace).find(repository => repository.name === 'repo1')!
    const demand = createDemand(db, workspace, { name: 'Attach later', repositoryIds: [repo1.id] })
    const updated = addRepositoryToDemand(db, workspace, demand.demand.id, added.id)!
    expect(updated?.repositories.map(repository => repository.name)).toEqual(['repo1', 'repo3'])
    expect(git(join(root, 'worktrees', 'attach-later', 'services', 'repo3'), ['branch', '--show-current'])).toBe('attach-later')
    expect(readFileSync(join(root, 'worktrees', 'attach-later', 'docs', 'context.md'), 'utf8')).toContain('- repo3:')
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('counts only skills Codex can recognize', () => {
    const { root, db, workspace } = fixture()
    mkdirSync(join(root, '.agents', 'skills', 'valid-skill'), { recursive: true })
    mkdirSync(join(root, '.agents', 'skills', 'disabled-skill'), { recursive: true })
    mkdirSync(join(root, '.agents', 'skills', 'broken-skill'), { recursive: true })
    writeFileSync(join(root, '.agents', 'skills', 'valid-skill', 'SKILL.md'), '---\nname: valid-skill\ndescription: A valid skill\n---\n# valid\n')
    writeFileSync(join(root, '.agents', 'skills', 'disabled-skill', 'SKILL.md'), '---\nname: disabled-skill\ndescription: Disabled\ndisable-model-invocation: true\n---\n# disabled\n')
    writeFileSync(join(root, '.agents', 'skills', 'broken-skill', 'SKILL.md'), '# missing frontmatter\n')
    const skills = dashboardSnapshot(db, workspace).skills
    expect(skills.available).toBeGreaterThanOrEqual(1)
    expect(skills.disabled).toBeGreaterThanOrEqual(1)
    expect(skills.loadFailed).toBeGreaterThanOrEqual(1)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
})
