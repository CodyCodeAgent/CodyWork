import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WorkspaceRow } from '../db/index.js'
import type { CodyWorkRuntime, RuntimeSkillCatalogEntry, RuntimeSkillScope } from '../runtime/protocol.js'

export type SkillStatus = 'available' | 'disabled' | 'load_failed'
export type SkillSource = 'workspace' | 'user' | 'system' | 'admin'

/** CodyWork's presentation view over the provider-owned Runtime catalog. */
export interface SkillCatalogEntry {
  id: string
  name: string
  displayName: string
  description: string
  path: string
  source: SkillSource
  scope: RuntimeSkillScope
  status: SkillStatus
  modelInvocable: boolean
  content: string
  updatedAt: string
  geminiSharing?: 'shared' | 'link' | 'import'
}

/** Skill directory links must resolve inside the root authorized by the caller. */
export function containsSkillPath(root: string, path: string): boolean {
  try {
    const rel = relative(realpathSync(root), realpathSync(path))
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  } catch {
    return false
  }
}

export function discoverSkillDirectories(
  root: string,
  authorizedRoot: string,
  scope: RuntimeSkillScope,
): RuntimeSkillCatalogEntry[] {
  if (!containsSkillPath(authorizedRoot, root) || !statSync(root).isDirectory()) return []
  const result: RuntimeSkillCatalogEntry[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const path = join(root, entry.name, 'SKILL.md')
    if (entry.name.startsWith('.') || !containsSkillPath(authorizedRoot, path)) continue
    try {
      if (!statSync(path).isFile()) continue
      const parsed = parseInstalledSkill(readFileSync(path, 'utf8'), entry.name)
      if (parsed.status === 'load_failed') continue
      result.push({
        id: realpathSync(path), name: parsed.name, label: parsed.name, path,
        description: parsed.description, scope, enabled: parsed.modelInvocable,
      })
    } catch {
      // A Skill may be removed while catalog discovery is in progress.
    }
  }
  return result
}

function sourceFromScope(scope: RuntimeSkillScope): SkillSource {
  return scope === 'repo' ? 'workspace' : scope
}

function fileDetails(path: string): { content: string; updatedAt: string } {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return { content: '', updatedAt: '' }
    return { content: readFileSync(path, 'utf8'), updatedAt: statSync(path).mtime.toISOString() }
  } catch {
    // Runtime metadata remains authoritative even when a system/plugin Skill
    // does not expose a locally readable backing file.
    return { content: '', updatedAt: '' }
  }
}

function geminiSharing(workspacePath: string, skill: RuntimeSkillCatalogEntry): SkillCatalogEntry['geminiSharing'] {
  if (!skill.enabled || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skill.name) || basename(skill.path) !== 'SKILL.md') return
  const workspaceSkills = join(workspacePath, '.agents', 'skills')
  const existing = join(workspaceSkills, skill.name, 'SKILL.md')
  if (containsSkillPath(workspacePath, existing) && containsSkillPath(dirname(skill.path), existing)) return 'shared'
  if (skill.scope === 'repo' && containsSkillPath(workspacePath, skill.path)
    && containsSkillPath(join(workspacePath, '.codex', 'skills'), skill.path)) return 'link'
  const userSkills = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills')
  if (skill.scope === 'user' && containsSkillPath(userSkills, skill.path)) return 'import'
}

function toCatalogEntry(skill: RuntimeSkillCatalogEntry, workspacePath: string): SkillCatalogEntry {
  const file = fileDetails(skill.path)
  return {
    id: skill.id,
    name: skill.name,
    displayName: skill.label || skill.name,
    description: skill.description,
    path: skill.path,
    source: sourceFromScope(skill.scope),
    scope: skill.scope,
    status: skill.enabled ? 'available' : 'disabled',
    modelInvocable: skill.enabled,
    content: file.content,
    updatedAt: file.updatedAt,
    geminiSharing: geminiSharing(workspacePath, skill),
  }
}

export async function listSkills(runtime: CodyWorkRuntime, workspace: WorkspaceRow, forceReload = false): Promise<SkillCatalogEntry[]> {
  const skills = await runtime.listSkillCatalog({ workspacePath: workspace.path, forceReload })
  return skills.map(skill => toCatalogEntry(skill, workspace.path))
}

export async function listManagedSkills(codex: CodyWorkRuntime, workspace: WorkspaceRow, forceReload = false): Promise<SkillCatalogEntry[]> {
  const local = ['.agents/skills', '.codex/skills'].flatMap(root =>
    discoverSkillDirectories(join(workspace.path, root), workspace.path, 'repo'))
  let catalog: SkillCatalogEntry[]
  try {
    catalog = await listSkills(codex, workspace, forceReload)
  } catch {
    catalog = []
  }
  const seen = new Set(catalog.map(skill => skill.id))
  for (const skill of local) {
    if (seen.has(skill.id) || seen.has(skill.path)) continue
    catalog.push(toCatalogEntry(skill, workspace.path))
    seen.add(skill.id)
  }
  return catalog
}

export async function getSkill(runtime: CodyWorkRuntime, workspace: WorkspaceRow, id: string): Promise<SkillCatalogEntry> {
  const skill = (await listManagedSkills(runtime, workspace)).find(item => item.id === id)
  if (!skill) throw new Error(`Skill 不存在：${id}`)
  return skill
}

function assertPortableDirectory(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const entry = lstatSync(path)
    if (entry.isDirectory()) assertPortableDirectory(path)
    else if (!entry.isFile()) throw new Error('此 Skill 包含软链或特殊文件，请先整理成独立的 Skill 目录')
  }
}

export async function shareGeminiSkill(runtime: CodyWorkRuntime, workspace: WorkspaceRow, id: string): Promise<void> {
  const skill = await getSkill(runtime, workspace, id)
  if (skill.geminiSharing === 'shared') return
  if (!skill.geminiSharing) throw new Error('此 Skill 无法从当前位置共享给 Gemini')
  const root = join(workspace.path, '.agents', 'skills')
  for (const directory of [dirname(root), root]) {
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
    if (!containsSkillPath(workspace.path, directory)) throw new Error('共享目录必须在当前工作空间内')
  }
  const source = realpathSync(dirname(skill.path))
  const target = join(root, skill.name)
  const createTarget = (create: () => void) => {
    try { create() }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`共享目录里已经有同名 Skill「${skill.name}」`)
      throw error
    }
  }
  if (skill.geminiSharing === 'link') {
    createTarget(() => symlinkSync(relative(realpathSync(root), source), target, 'dir'))
    return
  }
  assertPortableDirectory(source)
  const staging = mkdtempSync(join(root, '.import-'))
  try {
    const copy = join(staging, skill.name)
    cpSync(source, copy, { recursive: true, errorOnExist: true, force: false })
    assertPortableDirectory(copy)
    // Reserve atomically so a different Skill with this name is never overwritten.
    createTarget(() => { mkdirSync(target) })
    try { renameSync(copy, target) }
    catch (error) { rmSync(target, { recursive: true }); throw error }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

interface ParsedInstalledSkill {
  name: string
  description: string
  status: SkillStatus
  modelInvocable: boolean
}

function parseInstalledSkill(content: string, fallbackName: string): ParsedInstalledSkill {
  if (!content.startsWith('---')) return { name: fallbackName, description: '', status: 'load_failed', modelInvocable: false }
  const end = content.indexOf('\n---', 3)
  if (end < 0) return { name: fallbackName, description: '', status: 'load_failed', modelInvocable: false }
  const frontmatter = content.slice(3, end).split(/\r?\n/)
  const name = frontmatter.find(line => /^name\s*:/i.test(line))?.replace(/^name\s*:\s*/i, '').trim() || fallbackName
  const descriptionLine = frontmatter.findIndex(line => /^description\s*:/i.test(line))
  let description = descriptionLine >= 0 ? frontmatter[descriptionLine]!.replace(/^description\s*:\s*/i, '').trim() : ''
  if (description === '|' || description === '>-' || description === '>') {
    const continuation: string[] = []
    for (const line of frontmatter.slice(descriptionLine + 1)) {
      if (line.trim() && !/^\s/.test(line)) break
      if (line.trim()) continuation.push(line.trim())
    }
    description = continuation.join(' ')
  }
  const disabled = frontmatter.some(line => /^disable-model-invocation\s*:\s*(true|yes|on|1)\s*$/i.test(line))
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || !description) return { name, description, status: 'load_failed', modelInvocable: false }
  return { name, description, status: disabled ? 'disabled' : 'available', modelInvocable: !disabled }
}

/** Installation jobs run in a short-lived Runtime and only need to report
 * files written into this Workspace. Product discovery never uses this scan. */
export function listInstalledWorkspaceSkills(workspace: WorkspaceRow): SkillCatalogEntry[] {
  const result: SkillCatalogEntry[] = []
  for (const root of [join(workspace.path, '.agents', 'skills'), join(workspace.path, '.codex', 'skills')]) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = entry.isDirectory() ? join(root, entry.name, 'SKILL.md') : entry.name.endsWith('.md') ? join(root, entry.name) : ''
      if (!path || !existsSync(path) || !statSync(path).isFile()) continue
      const content = readFileSync(path, 'utf8')
      const parsed = parseInstalledSkill(content, entry.isDirectory() ? entry.name : basename(entry.name, '.md'))
      result.push({
        id: path,
        name: parsed.name,
        displayName: parsed.name,
        description: parsed.description,
        path,
        source: 'workspace',
        scope: 'repo',
        status: parsed.status,
        modelInvocable: parsed.modelInvocable,
        content,
        updatedAt: statSync(path).mtime.toISOString(),
      })
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path))
}
