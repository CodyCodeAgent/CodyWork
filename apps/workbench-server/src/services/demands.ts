import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { DemandRow, RepositoryRow, WorkbenchDb, WorkspaceRow, makeId, nowIso } from '../db/index.js'
import { listRepositories } from './repositories.js'

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function slugify(value: string): string {
  const slug = value.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return slug || 'demand'
}

function validateBranch(branch: string): void {
  try { runGit(process.cwd(), ['check-ref-format', '--branch', branch]) } catch { throw new Error('分支名不符合 Git 规范') }
}

function branchExists(repo: RepositoryRow, branch: string): boolean {
  try { runGit(repo.baseline_path, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true } catch { return false }
}

function branchCheckedOut(repo: RepositoryRow, branch: string): boolean {
  try {
    const output = runGit(repo.baseline_path, ['worktree', 'list', '--porcelain'])
    return output.split('\n').some(line => line === `branch refs/heads/${branch}`)
  } catch { return false }
}

function baseRef(repo: RepositoryRow): string {
  return repo.default_ref || 'HEAD'
}

function gitRepositoryRoot(path: string): string | null {
  try { return realpathSync(runGit(path, ['rev-parse', '--show-toplevel'])) } catch { return null }
}

function gitCommonDir(path: string): string | null {
  try { return realpathSync(resolve(path, runGit(path, ['rev-parse', '--git-common-dir']))) } catch { return null }
}

function currentBranch(path: string): string | null {
  try { return runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null } catch { return null }
}

function importedBaseCommit(path: string, repository: RepositoryRow, branch: string): string {
  try { return runGit(path, ['merge-base', branch, baseRef(repository)]) } catch { return runGit(path, ['rev-parse', 'HEAD']) }
}

export interface ExistingWorktreeImportResult {
  imported: Array<{ id: string; name: string; branchName: string; worktreeKey: string; repositories: number }>
  skipped: Array<{ worktreeKey: string; reason: string }>
}

/**
 * Adopt existing Git worktrees as CodyWork demands without changing the
 * filesystem. A worktree directory is trusted only when all of its direct
 * service repositories match registered baseline repositories and share one
 * checked-out branch.
 */
export function importExistingWorktrees(db: WorkbenchDb, workspace: WorkspaceRow): ExistingWorktreeImportResult {
  const result: ExistingWorktreeImportResult = { imported: [], skipped: [] }
  const worktreesRoot = resolve(workspace.path, 'worktrees')
  if (!existsSync(worktreesRoot) || !statSync(worktreesRoot).isDirectory()) return result

  const repositories = listRepositories(db, workspace)
  const repositoriesByName = new Map(repositories.map(repository => [repository.name, repository]))
  for (const entry of readdirSync(worktreesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    const worktreeKey = entry.name
    const demandRoot = resolve(worktreesRoot, worktreeKey)
    if (!isInside(worktreesRoot, demandRoot)) continue
    const servicesRoot = resolve(demandRoot, 'services')
    if (!existsSync(servicesRoot) || !statSync(servicesRoot).isDirectory()) {
      result.skipped.push({ worktreeKey, reason: '未找到 services 目录' })
      continue
    }
    const existing = db.db.prepare('SELECT id FROM demands WHERE workspace_id = ? AND worktree_key = ?').get(workspace.id, worktreeKey) as { id?: string } | undefined
    if (existing?.id) continue

    const mappings: Array<{ repository: RepositoryRow; path: string; branch: string }> = []
    let reason = ''
    for (const service of readdirSync(servicesRoot, { withFileTypes: true })) {
      if (!service.isDirectory() || service.isSymbolicLink() || service.name.startsWith('.')) continue
      const path = resolve(servicesRoot, service.name)
      let canonicalPath: string
      try { canonicalPath = realpathSync(path) } catch { reason = `${service.name} 在扫描期间消失`; break }
      if (!isInside(servicesRoot, path) || gitRepositoryRoot(path) !== canonicalPath) {
        reason = `${service.name} 不是可识别的 Git worktree`
        break
      }
      const repository = repositoriesByName.get(service.name)
      if (!repository) {
        reason = `${service.name} 没有对应的基线 Repo`
        break
      }
      if (gitCommonDir(path) !== gitCommonDir(repository.baseline_path)) {
        reason = `${service.name} 不属于对应基线 Repo 的 Git worktree`
        break
      }
      const branch = currentBranch(path)
      if (!branch) {
        reason = `${service.name} 处于 detached HEAD`
        break
      }
      mappings.push({ repository, path, branch })
    }
    if (reason || mappings.length === 0) {
      result.skipped.push({ worktreeKey, reason: reason || '未找到可导入的 Git Repo' })
      continue
    }
    const branchName = mappings[0]!.branch
    if (mappings.some(mapping => mapping.branch !== branchName)) {
      result.skipped.push({ worktreeKey, reason: '多个 Repo 的当前分支不一致' })
      continue
    }
    const conflict = mappings.some(({ repository }) => Boolean(db.db.prepare('SELECT 1 FROM demand_repositories WHERE repository_id = ? AND branch_name = ?').get(repository.id, branchName)))
    if (conflict) {
      result.skipped.push({ worktreeKey, reason: `分支 ${branchName} 已关联到其他 Demand` })
      continue
    }

    const now = nowIso()
    const demandId = makeId('demand')
    try {
      db.db.exec('BEGIN')
      db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(demandId, workspace.id, branchName, branchName, worktreeKey, 'in_progress', now, now)
      for (const mapping of mappings) {
        db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(demandId, mapping.repository.id, branchName, mapping.path, baseRef(mapping.repository), importedBaseCommit(mapping.path, mapping.repository, branchName), now)
      }
      db.db.exec('COMMIT')
      result.imported.push({ id: demandId, name: branchName, branchName, worktreeKey, repositories: mappings.length })
    } catch (error) {
      try { db.db.exec('ROLLBACK') } catch { /* transaction did not start */ }
      result.skipped.push({ worktreeKey, reason: `元数据写入失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  return result
}

export interface CreateDemandInput { name: string; branchName?: string; repositoryIds: string[] }

export function createDemand(db: WorkbenchDb, workspace: WorkspaceRow, input: CreateDemandInput) {
  const name = input.name.trim()
  if (!name) throw new Error('需求名不能为空')
  if (!Array.isArray(input.repositoryIds) || input.repositoryIds.length === 0) throw new Error('至少选择一个 Repo')
  const repositoryIds = [...new Set(input.repositoryIds)]
  const repositories = listRepositories(db, workspace).filter(row => repositoryIds.includes(row.id))
  if (repositories.length !== repositoryIds.length) throw new Error('选择的 Repo 不存在或已失效')
  const branchName = input.branchName?.trim() || slugify(name)
  validateBranch(branchName)
  const worktreeKey = branchName.replaceAll('/', '__')
  const demandRoot = resolve(workspace.path, 'worktrees', worktreeKey)
  const worktreeServices = resolve(demandRoot, 'services')
  if (!isInside(resolve(workspace.path, 'worktrees'), demandRoot) || existsSync(demandRoot)) throw new Error('需求分支或 Worktree 目录已存在')
  const duplicateName = db.db.prepare('SELECT id FROM demands WHERE workspace_id = ? AND name = ?').get(workspace.id, name) as { id?: string } | undefined
  if (duplicateName) throw new Error('同名需求已存在')
  for (const repository of repositories) {
    if (branchCheckedOut(repository, branchName)) throw new Error(`Repo ${repository.name} 已经在其他 Worktree 使用该分支`)
    const existing = db.db.prepare('SELECT demand_id FROM demand_repositories WHERE repository_id = ? AND branch_name = ?').get(repository.id, branchName) as { demand_id?: string } | undefined
    if (existing) throw new Error(`Repo ${repository.name} 已经存在该需求分支`)
  }

  const operationId = makeId('op')
  const createdAt = nowIso()
  db.db.prepare('INSERT INTO demand_operations (id, workspace_id, status, request_json, created_at) VALUES (?, ?, ?, ?, ?)').run(operationId, workspace.id, 'creating', JSON.stringify(input), createdAt)
  const created: { repository: RepositoryRow; path: string; baseRef: string; baseCommit: string; branchCreated: boolean }[] = []
  try {
    mkdirSync(worktreeServices, { recursive: true })
    for (const repository of repositories) {
      const target = resolve(worktreeServices, repository.name)
      if (!isInside(worktreeServices, target) || existsSync(target)) throw new Error(`Worktree 目标不可用：${repository.name}`)
      const ref = baseRef(repository)
      const commit = runGit(repository.baseline_path, ['rev-parse', ref])
      const alreadyExists = branchExists(repository, branchName)
      if (alreadyExists) runGit(repository.baseline_path, ['worktree', 'add', target, branchName])
      else runGit(repository.baseline_path, ['worktree', 'add', '-b', branchName, target, ref])
      created.push({ repository, path: target, baseRef: ref, baseCommit: commit, branchCreated: !alreadyExists })
    }
    mkdirSync(resolve(demandRoot, 'docs'), { recursive: true })
    const context = [
      '# Demand context',
      '',
      '> This file is generated by CodyWork when the demand worktree is created.',
      '> Keep stable engineering rules in the workspace constitution; keep demand-specific facts here.',
      '',
      `- Demand: ${name}`,
      `- Branch: ${branchName}`,
      `- Worktree: ${demandRoot}`,
      '',
      '## Repositories',
      '',
      ...created.map(item => `- ${item.repository.name}: ${item.path} (base ${item.baseRef} @ ${item.baseCommit})`),
      '',
      '## Change policy',
      '',
      '- Read the workspace constitution and repository AGENTS.md files before editing.',
      '- Keep changes scoped to the selected repositories and this demand documentation.',
      '- Update this context document when repositories or operating constraints change.',
      '',
    ].join('\n')
    writeFileSync(resolve(demandRoot, 'docs', 'context.md'), context, 'utf8')
    const demandId = makeId('demand')
    const updatedAt = nowIso()
    db.db.exec('BEGIN')
    try {
      db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(demandId, workspace.id, name, branchName, worktreeKey, 'in_progress', createdAt, updatedAt)
      for (const item of created) db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(demandId, item.repository.id, branchName, item.path, item.baseRef, item.baseCommit, createdAt)
      db.db.prepare('UPDATE demand_operations SET status = ?, completed_at = ? WHERE id = ?').run('completed', updatedAt, operationId)
      db.db.exec('COMMIT')
    } catch (error) {
      db.db.exec('ROLLBACK')
      throw error
    }
    const demand = db.db.prepare('SELECT * FROM demands WHERE id = ?').get(demandId) as unknown as DemandRow
    return { demand: { id: demand.id, name: demand.name, branchName: demand.branch_name, worktreeKey: demand.worktree_key, status: demand.status }, repositories: created.map(item => ({ id: item.repository.id, name: item.repository.name, worktreePath: item.path })) }
  } catch (error) {
    for (const item of created.reverse()) {
      try { runGit(item.repository.baseline_path, ['worktree', 'remove', '--force', item.path]) } catch { /* best-effort rollback */ }
      if (item.branchCreated) { try { runGit(item.repository.baseline_path, ['branch', '-D', branchName]) } catch { /* preserve manual cleanup signal */ } }
    }
    if (existsSync(demandRoot)) rmSync(demandRoot, { recursive: true, force: true })
    db.db.prepare('UPDATE demand_operations SET status = ?, error = ?, completed_at = ? WHERE id = ?').run('failed', error instanceof Error ? error.message : String(error), nowIso(), operationId)
    throw error
  }
}

export function listDemands(db: WorkbenchDb, workspace: WorkspaceRow) {
  const demands = db.db.prepare('SELECT * FROM demands WHERE workspace_id = ? ORDER BY updated_at DESC, created_at DESC').all(workspace.id) as unknown as DemandRow[]
  return demands.map(demand => ({
    id: demand.id,
    name: demand.name,
    branchName: demand.branch_name,
    worktreeKey: demand.worktree_key,
    status: demand.status,
    createdAt: demand.created_at,
    updatedAt: demand.updated_at,
    repositories: db.db.prepare('SELECT r.id, r.name, dr.worktree_path AS worktreePath FROM demand_repositories dr JOIN repositories r ON r.id = dr.repository_id WHERE dr.demand_id = ? ORDER BY r.name').all(demand.id) as { id: string; name: string; worktreePath: string }[],
  }))
}

export function getDemand(db: WorkbenchDb, workspace: WorkspaceRow, id: string) {
  const demand = db.db.prepare('SELECT * FROM demands WHERE id = ? AND workspace_id = ?').get(id, workspace.id) as unknown as DemandRow | undefined
  if (!demand) throw new Error('需求不存在')
  return listDemands(db, workspace).find(item => item.id === demand.id)
}

/** Add a baseline Repo to an existing demand using the demand's branch. */
export function addRepositoryToDemand(db: WorkbenchDb, workspace: WorkspaceRow, demandId: string, repositoryId: string) {
  const demand = db.db.prepare('SELECT * FROM demands WHERE id = ? AND workspace_id = ?').get(demandId, workspace.id) as unknown as DemandRow | undefined
  if (!demand) throw new Error('需求不存在')
  const repository = listRepositories(db, workspace).find(row => row.id === repositoryId)
  if (!repository) throw new Error('选择的 Repo 不存在或已失效')
  const existing = db.db.prepare('SELECT 1 FROM demand_repositories WHERE demand_id = ? AND repository_id = ?').get(demandId, repositoryId)
  if (existing) throw new Error('该 Repo 已经在需求中')
  if (branchCheckedOut(repository, demand.branch_name)) throw new Error(`Repo ${repository.name} 已经在其他 Worktree 使用该分支`)
  const demandRoot = resolve(workspace.path, 'worktrees', demand.worktree_key)
  const target = resolve(demandRoot, 'services', repository.name)
  if (!isInside(resolve(demandRoot, 'services'), target) || existsSync(target)) throw new Error(`Worktree 目标不可用：${repository.name}`)
  const operationId = makeId('op')
  const createdAt = nowIso()
  db.db.prepare('INSERT INTO demand_operations (id, workspace_id, status, request_json, created_at) VALUES (?, ?, ?, ?, ?)').run(operationId, workspace.id, 'creating', JSON.stringify({ demandId, repositoryId }), createdAt)
  let branchCreated = false
  try {
    mkdirSync(resolve(demandRoot, 'services'), { recursive: true })
    const ref = baseRef(repository)
    const commit = runGit(repository.baseline_path, ['rev-parse', ref])
    if (branchExists(repository, demand.branch_name)) runGit(repository.baseline_path, ['worktree', 'add', target, demand.branch_name])
    else { runGit(repository.baseline_path, ['worktree', 'add', '-b', demand.branch_name, target, ref]); branchCreated = true }
    updateDemandContext(demandRoot, { name: repository.name, path: target, baseRef: ref, baseCommit: commit })
    db.db.exec('BEGIN')
    try {
      db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(demandId, repository.id, demand.branch_name, target, ref, commit, createdAt)
      db.db.prepare('UPDATE demands SET updated_at = ? WHERE id = ?').run(nowIso(), demandId)
      db.db.prepare('UPDATE demand_operations SET status = ?, completed_at = ? WHERE id = ?').run('completed', nowIso(), operationId)
      db.db.exec('COMMIT')
    } catch (error) {
      db.db.exec('ROLLBACK')
      throw error
    }
    return getDemand(db, workspace, demandId)
  } catch (error) {
    try { runGit(repository.baseline_path, ['worktree', 'remove', '--force', target]) } catch { /* best-effort rollback */ }
    if (branchCreated) { try { runGit(repository.baseline_path, ['branch', '-D', demand.branch_name]) } catch { /* preserve manual cleanup signal */ } }
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    db.db.prepare('UPDATE demand_operations SET status = ?, error = ?, completed_at = ? WHERE id = ?').run('failed', error instanceof Error ? error.message : String(error), nowIso(), operationId)
    throw error
  }
}

function updateDemandContext(demandRoot: string, repository: { name: string; path: string; baseRef: string; baseCommit: string }): void {
  const contextPath = resolve(demandRoot, 'docs', 'context.md')
  if (!existsSync(contextPath)) return
  const content = readFileSync(contextPath, 'utf8')
  const line = `- ${repository.name}: ${repository.path} (base ${repository.baseRef} @ ${repository.baseCommit})`
  if (content.includes(line)) return
  const marker = '\n## Change policy'
  writeFileSync(contextPath, content.includes(marker) ? content.replace(marker, `\n${line}${marker}`) : `${content.trimEnd()}\n${line}\n`, 'utf8')
}

/** Mark operations interrupted by a process crash as recoverable failures. */
export function reconcileDemandOperations(db: WorkbenchDb): number {
  const pending = db.db.prepare("SELECT id FROM demand_operations WHERE status = 'creating'").all() as { id: string }[]
  if (pending.length === 0) return 0
  const statement = db.db.prepare("UPDATE demand_operations SET status = 'failed', error = ?, completed_at = ? WHERE id = ? AND status = 'creating'")
  const now = nowIso()
  for (const operation of pending) statement.run('CodyWork restarted before the demand operation was committed; inspect any reported Worktree paths before retrying.', now, operation.id)
  return pending.length
}
