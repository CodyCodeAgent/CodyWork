import { basename, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

function toCatalogEntry(skill: RuntimeSkillCatalogEntry): SkillCatalogEntry {
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
  }
}

export async function listSkills(runtime: CodyWorkRuntime, workspace: WorkspaceRow, forceReload = false): Promise<SkillCatalogEntry[]> {
  const skills = await runtime.listSkillCatalog({ workspacePath: workspace.path, forceReload })
  return skills.map(toCatalogEntry)
}

export async function getSkill(runtime: CodyWorkRuntime, workspace: WorkspaceRow, id: string): Promise<SkillCatalogEntry> {
  const skill = (await listSkills(runtime, workspace)).find(item => item.id === id)
  if (!skill) throw new Error(`Skill 不存在：${id}`)
  return skill
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
