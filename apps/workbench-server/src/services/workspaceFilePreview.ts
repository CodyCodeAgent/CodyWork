import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import type { WorkspaceRow } from '../db/index.js'

/** Safe, text-only documents that may be opened from the conversation timeline. */
const PREVIEW_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.go', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rb', '.rs', '.java', '.kt', '.kts', '.scala', '.swift', '.cs',
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.php', '.lua', '.r', '.sql',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.proto', '.thrift',
  '.graphql', '.gql', '.dockerfile', '.makefile', '.gradle', '.properties',
])
const PREVIEW_FILENAMES = new Set(['dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', '.gitignore', '.editorconfig'])
const MAX_PREVIEW_BYTES = 1024 * 1024
const MAX_DIFF_BYTES = 2 * 1024 * 1024
const DEFAULT_DIFF_CONTEXT = 3
const MAX_DIFF_CONTEXT = 100

export interface WorkspaceFileDiff {
  /** Whether the current file has an available working-tree change view. */
  available: boolean
  /** Reference used to derive the diff. `untracked` means an add-only diff. */
  base: 'HEAD' | 'untracked' | null
  content: string
}

export interface WorkspaceFilePreview {
  name: string
  path: string
  relativePath: string
  extension: string
  size: number
  updatedAt: string
  content: string
  diff: WorkspaceFileDiff
}

export interface WorkspaceFilePreviewOptions {
  /** Context lines around each Git hunk, clamped to a bounded product limit. */
  diffContext?: number
  /**
   * Repository worktrees registered for the active Demand. Relative paths in
   * an agent response are normally repository-relative, rather than relative
   * to the Workspace root, so they need this additional resolution context.
   */
  demandRepositories?: Array<{ name: string; worktreePath: string }>
}

function isSupportedPreviewPath(path: string, extension: string): boolean {
  return PREVIEW_EXTENSIONS.has(extension) || PREVIEW_FILENAMES.has(path.split('/').pop()?.toLowerCase() ?? '')
}

function runGit(cwd: string, args: string[]) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 2_000, maxBuffer: MAX_DIFF_BYTES })
}

/** Returns a bounded, read-only working-tree diff when this file belongs to a Git repository. */
function normalizedDiffContext(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_DIFF_CONTEXT
  return Math.min(MAX_DIFF_CONTEXT, Math.max(0, value))
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

interface PreviewRoot {
  name: string
  path: string
}

/**
 * Only retain registered Demand repositories that still resolve inside the
 * Workspace. This protects the preview endpoint from stale or tampered
 * metadata and keeps the existing realpath-based isolation guarantee.
 */
function demandPreviewRoots(workspaceRoot: string, repositories: WorkspaceFilePreviewOptions['demandRepositories']): PreviewRoot[] {
  if (!repositories) return []
  return repositories.flatMap(repository => {
    try {
      if (!repository.name || !existsSync(repository.worktreePath)) return []
      const path = realpathSync(repository.worktreePath)
      return isInside(workspaceRoot, path) ? [{ name: repository.name, path }] : []
    } catch {
      return []
    }
  })
}

function existingCandidate(root: string, requestedPath: string): string | null {
  const candidate = resolve(root, requestedPath)
  return existsSync(candidate) ? candidate : null
}

/**
 * Resolves a relative agent path in the active Demand first. Paths such as
 * `my-repo/src/file.ts` and `services/my-repo/src/file.ts` explicitly select
 * a repository; an unqualified path is accepted only when it matches exactly
 * one Demand repository. The Workspace remains the fallback for documents
 * such as the demand context itself.
 */
function resolvePreviewCandidate(workspaceRoot: string, requestedPath: string, repositories: WorkspaceFilePreviewOptions['demandRepositories']): string | null {
  if (isAbsolute(requestedPath)) return existsSync(resolve(requestedPath)) ? resolve(requestedPath) : null

  const roots = demandPreviewRoots(workspaceRoot, repositories)
  const parts = requestedPath.replaceAll('\\', '/').split('/').filter(Boolean)
  const qualified = roots.flatMap(root => {
    const prefixLength = parts[0] === root.name ? 1 : parts[0] === 'services' && parts[1] === root.name ? 2 : 0
    if (!prefixLength || parts.length === prefixLength) return []
    const candidate = existingCandidate(root.path, parts.slice(prefixLength).join('/'))
    return candidate ? [candidate] : []
  })
  if (qualified.length === 1) return qualified[0]!
  if (qualified.length > 1) throw new Error('预览文件路径不明确，请使用仓库名开头的路径')

  const repositoryMatches = roots.flatMap(root => {
    const candidate = existingCandidate(root.path, requestedPath)
    return candidate ? [candidate] : []
  })
  if (repositoryMatches.length === 1) return repositoryMatches[0]!
  if (repositoryMatches.length > 1) throw new Error('预览文件路径不明确，请使用仓库名开头的路径')

  return existingCandidate(workspaceRoot, requestedPath)
}

function workspaceFileDiff(resolvedPath: string, workspaceRoot: string, diffContext: number): WorkspaceFileDiff {
  const repositoryProbe = runGit(dirname(resolvedPath), ['rev-parse', '--show-toplevel'])
  if (repositoryProbe.status !== 0) return { available: false, base: null, content: '' }
  const repositoryRoot = repositoryProbe.stdout.trim()
  if (!repositoryRoot) return { available: false, base: null, content: '' }
  const normalizedRepositoryRoot = realpathSync(repositoryRoot)
  const repositoryRelativePath = relative(normalizedRepositoryRoot, resolvedPath)
  if (!repositoryRelativePath || repositoryRelativePath.startsWith('..') || isAbsolute(repositoryRelativePath)) return { available: false, base: null, content: '' }
  // A Workspace may contain nested repos, but a preview must never make Git
  // inspect a parent or sibling outside the registered Workspace boundary.
  const repositoryWorkspacePath = relative(workspaceRoot, normalizedRepositoryRoot)
  if (repositoryWorkspacePath.startsWith('..') || isAbsolute(repositoryWorkspacePath)) return { available: false, base: null, content: '' }

  const tracked = runGit(normalizedRepositoryRoot, ['ls-files', '--error-unmatch', '--', repositoryRelativePath])
  const args = tracked.status === 0
    ? ['diff', '--no-ext-diff', '--no-color', `--unified=${diffContext}`, '--', repositoryRelativePath]
    : ['diff', '--no-ext-diff', '--no-color', '--no-index', `--unified=${diffContext}`, '--', '/dev/null', repositoryRelativePath]
  const result = runGit(normalizedRepositoryRoot, args)
  // Ordinary `git diff` exits zero whether or not it found changes; its
  // stdout is the authoritative signal here. `--no-index` exits one on a
  // difference, so deliberately do not use the process exit code as state.
  if (!result.stdout) return { available: false, base: null, content: '' }
  return {
    available: true,
    base: tracked.status === 0 ? 'HEAD' : 'untracked',
    content: result.stdout.length > MAX_DIFF_BYTES ? `${result.stdout.slice(0, MAX_DIFF_BYTES)}\n… Diff 已截断 …\n` : result.stdout,
  }
}

/**
 * Reads one text file only after proving that its resolved real path is inside
 * the registered Workspace. `realpath` is important here: lexical checks
 * alone would allow a symlink in the Workspace to expose an arbitrary host
 * file. The browser never receives a direct filesystem URL.
 */
export function getWorkspaceFilePreview(workspace: WorkspaceRow, requestedPath: string, options: WorkspaceFilePreviewOptions = {}): WorkspaceFilePreview {
  const path = requestedPath.trim()
  if (!path || /[\u0000-\u001f]/u.test(path)) throw new Error('预览文件路径无效')

  const workspaceRoot = realpathSync(workspace.path)
  const candidate = resolvePreviewCandidate(workspaceRoot, path, options.demandRepositories)
  if (!candidate) throw new Error('预览文件不存在')

  const resolvedPath = realpathSync(candidate)
  const workspaceRelativePath = relative(workspaceRoot, resolvedPath)
  if (!workspaceRelativePath || !isInside(workspaceRoot, resolvedPath)) {
    throw new Error('只能预览当前 Workspace 内的文件')
  }

  const info = statSync(resolvedPath)
  if (!info.isFile()) throw new Error('只能预览普通文件')
  const extension = extname(resolvedPath).toLowerCase()
  if (!isSupportedPreviewPath(workspaceRelativePath, extension)) throw new Error(`不支持预览 ${extension || '无扩展名'} 文件`)
  if (info.size > MAX_PREVIEW_BYTES) throw new Error(`文件过大，最多可预览 ${MAX_PREVIEW_BYTES / 1024 / 1024} MiB`)
  const content = readFileSync(resolvedPath)
  if (content.includes(0)) throw new Error('只能预览 UTF-8 文本文件')

  return {
    name: workspaceRelativePath.split('/').pop() ?? workspaceRelativePath,
    path: resolvedPath,
    relativePath: workspaceRelativePath,
    extension: extension.slice(1),
    size: info.size,
    updatedAt: info.mtime.toISOString(),
    content: content.toString('utf8'),
    diff: workspaceFileDiff(resolvedPath, workspaceRoot, normalizedDiffContext(options.diffContext)),
  }
}
