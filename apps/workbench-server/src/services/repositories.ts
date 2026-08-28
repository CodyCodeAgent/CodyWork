import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { WorkbenchDb, RepositoryRow, WorkspaceRow, nowIso, makeId } from '../db/index.js'

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function isGitRepository(path: string): boolean {
  try {
    return realpathSync(runGit(path, ['rev-parse', '--show-toplevel'])) === realpathSync(path)
  } catch {
    return false
  }
}

/**
 * A single-project Workspace may itself be the baseline Git repository. CodyWork
 * keeps Demand worktrees below `<workspace>/worktrees`, so hide only that
 * CodyWork-owned container through Git's local metadata. This deliberately does
 * not edit the project's tracked `.gitignore` or hide any business-code path.
 */
export function ensureCodyWorkControlPlaneIgnored(path: string): boolean {
  if (!isGitRepository(path)) return false
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', 'worktrees/'], { cwd: path, stdio: 'ignore' })
    return false
  } catch {
    // A non-zero exit means no existing ignore rule covers the container.
  }

  const excludeValue = runGit(path, ['rev-parse', '--git-path', 'info/exclude'])
  const excludePath = isAbsolute(excludeValue) ? excludeValue : resolve(path, excludeValue)
  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  const rule = '/worktrees/'
  if (existing.split(/\r?\n/u).some(line => line.trim() === rule)) return false
  mkdirSync(dirname(excludePath), { recursive: true })
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  writeFileSync(excludePath, `${existing}${separator}# CodyWork-managed Demand worktrees\n${rule}\n`, 'utf8')
  return true
}

function repositoryOrigin(path: string): string | null {
  try {
    return runGit(path, ['config', '--get', 'remote.origin.url']) || null
  } catch {
    return null
  }
}

function repositoryRef(path: string): string {
  try {
    return runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || 'HEAD'
  } catch {
    return 'HEAD'
  }
}

export function inspectRepository(path: string): { dirty: boolean; defaultRef: string; originUrl: string | null; head: string } {
  const status = runGit(path, ['status', '--porcelain=v1'])
  return {
    dirty: status.length > 0,
    defaultRef: repositoryRef(path),
    originUrl: repositoryOrigin(path),
    head: runGit(path, ['rev-parse', 'HEAD']),
  }
}

export function discoverRepositories(db: WorkbenchDb, workspace: WorkspaceRow): RepositoryRow[] {
  const servicesRoot = resolve(workspace.path, 'services')
  const candidates: Array<{ name: string; path: string }> = []
  const entries = existsSync(servicesRoot) && statSync(servicesRoot).isDirectory()
    ? readdirSync(servicesRoot, { withFileTypes: true })
    : []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const path = resolve(servicesRoot, entry.name)
    if (entry.isSymbolicLink() || !isInside(servicesRoot, path) || !isGitRepository(path)) continue
    candidates.push({ name: entry.name, path })
  }
  // A selected existing Git project must not be moved into services/ merely to
  // use CodyWork. It is a baseline only for a single-project Workspace. In a
  // normal CSR Workspace the root may also be a Git repository, but services/
  // remains the authoritative multi-repository inventory.
  if (candidates.length === 0 && isGitRepository(workspace.path)) {
    ensureCodyWorkControlPlaneIgnored(workspace.path)
    candidates.push({ name: basename(workspace.path), path: workspace.path })
  }
  const seen = new Set<string>()
  const now = nowIso()
  // Reconciliation is authoritative for this scan. Mark prior inventory rows
  // absent first, then the successful candidates below restore present = 1.
  // This also removes a stale root-repository row after a Workspace gains a
  // normal services/ inventory.
  db.db.prepare('UPDATE repositories SET present = 0, inspected_at = ? WHERE workspace_id = ?').run(now, workspace.id)
  for (const candidate of candidates) {
    const { path } = candidate
    const id = (db.db.prepare('SELECT id FROM repositories WHERE workspace_id = ? AND baseline_path = ?').get(workspace.id, path) as { id?: string } | undefined)?.id ?? makeId('repo')
    let inspection: ReturnType<typeof inspectRepository>
    try {
      inspection = inspectRepository(path)
    } catch {
      inspection = { dirty: false, defaultRef: 'HEAD', originUrl: null, head: '' }
    }
    db.db.prepare(`
      INSERT INTO repositories (id, workspace_id, name, baseline_path, origin_url, default_ref, sync_status, sync_error, dirty, present, inspected_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ok', NULL, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, origin_url = excluded.origin_url, default_ref = excluded.default_ref, dirty = excluded.dirty, present = 1, inspected_at = excluded.inspected_at
    `).run(id, workspace.id, candidate.name, path, inspection.originUrl, inspection.defaultRef, inspection.dirty ? 1 : 0, now)
    seen.add(path)
  }
  const rows = db.db.prepare('SELECT * FROM repositories WHERE workspace_id = ? AND present = 1 ORDER BY name').all(workspace.id) as unknown as RepositoryRow[]
  return rows.filter(row => seen.has(row.baseline_path))
}

export function listRepositories(db: WorkbenchDb, workspace: WorkspaceRow): RepositoryRow[] {
  discoverRepositories(db, workspace)
  return listCachedRepositories(db, workspace)
}

/** Fast path for UI reads; reconciliation is performed by the dashboard worker. */
export function listCachedRepositories(db: WorkbenchDb, workspace: WorkspaceRow): RepositoryRow[] {
  return db.db.prepare('SELECT * FROM repositories WHERE workspace_id = ? AND present = 1 ORDER BY name').all(workspace.id) as unknown as RepositoryRow[]
}

export interface AddRepositoryInput {
  source: 'git' | 'folder'
  url?: string
  path?: string
  name?: string
}

function repositoryDirectoryName(input: AddRepositoryInput): string {
  const provided = input.name?.trim()
  const source = (input.url ?? input.path ?? '').trim().replace(/[\\/]+$/, '')
  const inferred = source.split(/[\\/:]/).pop()?.replace(/\.git$/i, '') ?? ''
  const name = provided || inferred
  if (!name || name === '.' || name === '..' || !/^[\p{L}\p{N}._-]+$/u.test(name)) throw new Error('Repo 名称只能包含字母、数字、点、下划线和短横线')
  return name
}

/** Clone a new baseline Repo into services/ and immediately register it. */
export function addRepository(db: WorkbenchDb, workspace: WorkspaceRow, input: AddRepositoryInput): RepositoryRow {
  const source = input.source === 'folder' ? input.path?.trim() : input.url?.trim()
  if (!source) throw new Error(input.source === 'folder' ? '本地 Repo 路径不能为空' : 'Git 地址不能为空')
  const servicesRoot = resolve(workspace.path, 'services')
  mkdirSync(servicesRoot, { recursive: true })
  const name = repositoryDirectoryName(input)
  const target = resolve(servicesRoot, name)
  if (!isInside(servicesRoot, target) || existsSync(target)) throw new Error(`Repo 目标目录已存在：${target}`)
  try {
    execFileSync('git', ['clone', source, target], { cwd: workspace.path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const repositories = listRepositories(db, workspace)
    const repository = repositories.find(row => row.baseline_path === target)
    if (!repository) throw new Error('Clone 完成，但目标目录不是可识别的 Git Repo')
    return repository
  } catch (error) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    throw error instanceof Error && error.message.startsWith('Clone 完成')
      ? error
      : new Error(`Repo 添加失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) files.push(child)
    }
  }
  visit(root)
  return files
}

function countTextLines(path: string): number | null {
  try {
    const buffer = readFileSync(path)
    if (buffer.includes(0)) return null
    return buffer.length === 0 ? 0 : buffer.toString('utf8').split(/\r?\n/).length
  } catch {
    return null
  }
}

export interface CodeChangeSummary { additions: number; deletions: number; filesChanged: number }

export function codeChanges(db: WorkbenchDb, workspace: WorkspaceRow): CodeChangeSummary {
  let additions = 0
  let deletions = 0
  const files = new Set<string>()
  const mappings = db.db.prepare('SELECT dr.*, r.name AS repository_name FROM demand_repositories dr JOIN demands d ON d.id = dr.demand_id JOIN repositories r ON r.id = dr.repository_id WHERE d.workspace_id = ?').all(workspace.id) as { worktree_path: string; base_commit: string }[]
  for (const mapping of mappings) {
    if (!existsSync(mapping.worktree_path)) continue
    try {
      for (const line of runGit(mapping.worktree_path, ['diff', '--numstat', mapping.base_commit]).split('\n')) {
        if (!line) continue
        const [added, deleted, path] = line.split('\t')
        if (path) files.add(`${mapping.worktree_path}:${path}`)
        if (added !== '-') additions += Number(added) || 0
        if (deleted !== '-') deletions += Number(deleted) || 0
      }
      for (const path of runGit(mapping.worktree_path, ['ls-files', '--others', '--exclude-standard']).split('\n')) {
        if (!path) continue
        files.add(`${mapping.worktree_path}:${path}`)
        const lines = countTextLines(join(mapping.worktree_path, path))
        if (lines !== null) additions += lines
      }
    } catch {
      continue
    }
  }
  return { additions, deletions, filesChanged: files.size }
}

export function knowledgeSummary(workspace: WorkspaceRow): { documents: number; lastUpdatedAt: string | null } {
  const files = walkFiles(join(workspace.path, 'docs'))
  let latest: number | undefined
  for (const file of files) {
    try {
      const mtime = statSync(file).mtimeMs
      if (latest === undefined || mtime > latest) latest = mtime
    } catch { /* file disappeared during scan */ }
  }
  return { documents: files.length, lastUpdatedAt: latest === undefined ? null : new Date(latest).toISOString() }
}

export function skillsSummary(workspace: WorkspaceRow): { available: number; disabled: number; loadFailed: number } {
  // Mirrors Codex skill discovery: project roots win over user roots, entries
  // need valid frontmatter, and model-disabled skills are not available.
  const roots = [
    join(workspace.path, '.agents', 'skills'),
    join(workspace.path, '.codex', 'skills'),
    join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'skills'),
    join(homedir(), '.agents', 'skills'),
  ]
  const recognized = new Map<string, 'available' | 'disabled' | 'loadFailed'>()
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const skillPath = entry.isDirectory() ? join(root, entry.name, 'SKILL.md') : entry.name.endsWith('.md') ? join(root, entry.name) : ''
      if (!skillPath) continue
      const parsed = parseAgentSkill(skillPath, entry.isDirectory() ? entry.name : basename(entry.name, '.md'))
      if (recognized.has(parsed.name)) continue
      recognized.set(parsed.name, parsed.status)
    }
  }
  let available = 0; let disabled = 0; let loadFailed = 0
  for (const status of recognized.values()) {
    if (status === 'available') available += 1
    else if (status === 'disabled') disabled += 1
    else loadFailed += 1
  }
  return { available, disabled, loadFailed }
}

function parseAgentSkill(path: string, fallbackName: string): { name: string; status: 'available' | 'disabled' | 'loadFailed' } {
  try {
    const text = readFileSync(path, 'utf8')
    if (!text.startsWith('---')) return { name: fallbackName, status: 'loadFailed' }
    const end = text.indexOf('\n---', 3)
    if (end < 0) return { name: fallbackName, status: 'loadFailed' }
    const frontmatter = text.slice(3, end).split(/\r?\n/)
    const name = frontmatter.find(line => /^name\s*:/i.test(line))?.replace(/^name\s*:\s*/i, '').trim() || fallbackName
    const description = frontmatter.find(line => /^description\s*:/i.test(line))?.replace(/^description\s*:\s*/i, '').trim()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || !description) return { name, status: 'loadFailed' }
    const disabled = frontmatter.some(line => /^disable-model-invocation\s*:\s*(true|yes|on|1)\s*$/i.test(line))
    return { name, status: disabled ? 'disabled' : 'available' }
  } catch {
    return { name: fallbackName, status: 'loadFailed' }
  }
}

export function repoSummary(rows: RepositoryRow): 'normal' | 'dirty' | 'pullFailed' {
  if (rows.sync_status === 'pull_failed') return 'pullFailed'
  if (rows.dirty) return 'dirty'
  return 'normal'
}
