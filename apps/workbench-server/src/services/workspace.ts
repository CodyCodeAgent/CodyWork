import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export interface WorkspaceSource {
  type: 'folder' | 'git'
  path?: string
  url?: string
  destination?: string
}

export interface WorkspaceSummary {
  entries: string[]
  isGit: boolean
  isRecognized: boolean
  check: WorkspaceCheck
  runtime: {
    status: 'ready'
    cwd: string
    note: string
  }
}

export type WorkspaceCheckStatus = 'ready' | 'empty' | 'incomplete' | 'unsupported'

export interface WorkspaceCheck {
  status: WorkspaceCheckStatus
  present: string[]
  missing: string[]
  message: string
}

export type WorkspaceAction = 'adopted' | 'initialize'

// These are the stable top-level areas in the CSR workspace contract from the
// base documentation. Rules files and optional folders are context, not a
// reason to reject an otherwise valid workspace.
const REQUIRED_MARKER_GROUPS = [
  { label: 'services', alternatives: ['services'] },
  { label: 'docs', alternatives: ['docs', 'knowledge'] },
  { label: 'specs', alternatives: ['specs', 'requirements'] },
  { label: 'worktrees', alternatives: ['worktrees'] },
]

// These folders are CodyWork-owned control-plane containers.  Creating them is
// deterministic and does not inspect or modify project code, so it should not
// depend on an App Server sandbox being able to create hidden directories.
const CONTROL_PLANE_DIRECTORIES = ['services', 'docs', 'specs', 'worktrees', join('.agents', 'skills')]
function canonicalPath(path: string): string {
  const raw = path.trim()
  if (!isAbsolute(raw)) throw new Error('Workspace 路径必须是绝对路径')
  return resolve(raw)
}

function ensureDirectory(path: string): string {
  const canonical = canonicalPath(path)
  if (existsSync(canonical) && !statSync(canonical).isDirectory()) {
    throw new Error(`目标不是文件夹：${canonical}`)
  }
  mkdirSync(canonical, { recursive: true })
  return canonical
}

function cloneWorkspace(url: string, destination: string): string {
  const source = url.trim()
  if (!source) throw new Error('Git 地址不能为空')
  const target = canonicalPath(destination)
  if (existsSync(target)) {
    const entries = readdirSync(target)
    if (entries.length > 0) throw new Error(`clone 目标不是空文件夹：${target}`)
  } else {
    mkdirSync(dirname(target), { recursive: true })
  }
  execFileSync('git', ['clone', source, target], { stdio: 'pipe' })
  return target
}

export function prepareWorkspace(source: WorkspaceSource): { path: string; name: string; check: WorkspaceCheck; action: WorkspaceAction } {
  if (source.type === 'git') {
    if (!source.url || !source.destination) throw new Error('Git Workspace 需要 Git 地址和目标路径')
    const path = cloneWorkspace(source.url, source.destination)
    const check = checkWorkspace(path)
    if (check.status !== 'ready') throw invalidWorkspaceError(path, check)
    return { path, name: basename(path), check, action: 'adopted' }
  }
  if (!source.path) throw new Error('本地 Workspace 需要文件夹路径')
  const path = ensureDirectory(source.path)
  const check = checkWorkspace(path)
  if (check.status === 'ready') return { path, name: basename(path) || path, check, action: 'adopted' }
  if (check.status === 'empty') return { path, name: basename(path) || path, check, action: 'initialize' }
  throw invalidWorkspaceError(path, check)
}

/**
 * Explicitly opt-in assisted setup.  Unlike the regular registration path this
 * may hand a non-empty, incomplete directory to the Workspace setup agent.
 * The agent is still required to preserve existing source files; this merely
 * allows it to add the CodyWork control-plane folders and policy documents.
 */
export function prepareWorkspaceForAssistedSetup(source: WorkspaceSource): { path: string; name: string; check: WorkspaceCheck; action: WorkspaceAction } {
  if (source.type === 'git') {
    if (!source.url || !source.destination) throw new Error('Git Workspace 需要 Git 地址和目标路径')
    const path = cloneWorkspace(source.url, source.destination)
    const check = checkWorkspace(path)
    return { path, name: basename(path), check, action: check.status === 'ready' ? 'adopted' : 'initialize' }
  }
  if (!source.path) throw new Error('本地 Workspace 需要文件夹路径')
  const path = ensureDirectory(source.path)
  const check = checkWorkspace(path)
  return { path, name: basename(path) || path, check, action: check.status === 'ready' ? 'adopted' : 'initialize' }
}

export function ensureWorkspaceControlPlane(path: string): string[] {
  const canonical = canonicalPath(path)
  const created: string[] = []
  for (const directory of CONTROL_PLANE_DIRECTORIES) {
    const target = join(canonical, directory)
    if (existsSync(target)) {
      if (!statSync(target).isDirectory()) throw new Error(`Workspace 控制目录不是文件夹：${target}`)
      continue
    }
    mkdirSync(target, { recursive: true })
    created.push(directory)
  }
  return created
}

function invalidWorkspaceError(path: string, check: WorkspaceCheck): Error {
  const detail = check.missing.length > 0 ? `缺少：${check.missing.join('、')}` : check.message
  return new Error(`目录不是可识别的 Workspace：${path}。${detail}。不会覆盖已有内容，请补齐目录结构或选择空文件夹。`)
}

export function checkWorkspace(path: string): WorkspaceCheck {
  const canonical = canonicalPath(path)
  const entries = readdirSync(canonical).sort((left, right) => left.localeCompare(right))
  const present = REQUIRED_MARKER_GROUPS.filter(group => group.alternatives.some(marker => entries.includes(marker))).map(group => group.label)
  const missing = REQUIRED_MARKER_GROUPS.filter(group => !group.alternatives.some(marker => entries.includes(marker))).map(group => group.label)
  if (entries.length === 0) {
    return { status: 'empty', present, missing, message: '空文件夹可以交给 Codex 初始化为 Workspace。' }
  }
  if (missing.length === 0) {
    return { status: 'ready', present, missing, message: 'Workspace 结构完整，将直接复用，不会重新创建。' }
  }
  if (present.length > 0) {
    return { status: 'incomplete', present, missing, message: '检测到部分 Workspace 目录，但结构尚未完整。' }
  }
  return { status: 'unsupported', present, missing, message: '目录非空但没有 Workspace 核心目录。' }
}

export function inspectWorkspace(path: string): WorkspaceSummary {
  const canonical = canonicalPath(path)
  const entries = readdirSync(canonical).sort((left, right) => left.localeCompare(right))
  const check = checkWorkspace(canonical)
  return {
    entries,
    isGit: existsSync(join(canonical, '.git')),
    isRecognized: check.status === 'ready',
    check,
    // Codex receives this path as its cwd. It owns agent/session initialization;
    // CodyWork intentionally does not synthesize a competing scaffold.
    runtime: {
      status: 'ready',
      cwd: canonical,
      note: 'Workspace 已准备好，后续任务由 Codex 在此目录中初始化和执行。',
    },
  }
}
