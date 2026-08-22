import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { WorkspaceRow } from '../db/index.js'

export type SkillStatus = 'available' | 'disabled' | 'load_failed'

export interface WorkspaceSkill {
  id: string
  name: string
  description: string
  path: string
  source: 'workspace' | 'user'
  status: SkillStatus
  modelInvocable: boolean
  content: string
  updatedAt: string
}

interface ParsedSkill {
  name: string
  description: string
  status: SkillStatus
  modelInvocable: boolean
}

function skillRoots(workspace: WorkspaceRow): Array<{ path: string; source: WorkspaceSkill['source'] }> {
  return [
    { path: join(workspace.path, '.agents', 'skills'), source: 'workspace' },
    { path: join(workspace.path, '.codex', 'skills'), source: 'workspace' },
    { path: join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'skills'), source: 'user' },
    { path: join(homedir(), '.agents', 'skills'), source: 'user' },
  ]
}

function parseSkill(content: string, fallbackName: string): ParsedSkill {
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

function skillPathEntries(root: string): Array<{ name: string; path: string }> {
  if (!existsSync(root) || !statSync(root).isDirectory()) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => ({
      name: entry.isDirectory() ? entry.name : basename(entry.name, '.md'),
      path: entry.isDirectory() ? join(root, entry.name, 'SKILL.md') : entry.name.endsWith('.md') ? join(root, entry.name) : '',
    }))
    .filter(entry => Boolean(entry.path))
}

export function listSkills(workspace: WorkspaceRow): WorkspaceSkill[] {
  const seen = new Set<string>()
  const result: WorkspaceSkill[] = []
  for (const root of skillRoots(workspace)) {
    for (const entry of skillPathEntries(root.path)) {
      if (seen.has(entry.name)) continue
      try {
        if (!existsSync(entry.path) || !statSync(entry.path).isFile()) continue
        const content = readFileSync(entry.path, 'utf8')
        const parsed = parseSkill(content, entry.name)
        seen.add(parsed.name)
        result.push({
          id: `${root.source}:${parsed.name}`,
          name: parsed.name,
          description: parsed.description,
          path: entry.path,
          source: root.source,
          status: parsed.status,
          modelInvocable: parsed.modelInvocable,
          content,
          updatedAt: statSync(entry.path).mtime.toISOString(),
        })
      } catch {
        seen.add(entry.name)
        result.push({ id: `${root.source}:${entry.name}`, name: entry.name, description: '', path: entry.path, source: root.source, status: 'load_failed', modelInvocable: false, content: '', updatedAt: new Date(0).toISOString() })
      }
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name))
}

export function getSkill(workspace: WorkspaceRow, id: string): WorkspaceSkill {
  const skill = listSkills(workspace).find(item => item.id === id || item.name === id)
  if (!skill) throw new Error(`Skill 不存在：${id}`)
  return skill
}
