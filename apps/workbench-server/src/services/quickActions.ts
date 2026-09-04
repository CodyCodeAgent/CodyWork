import type { QuickActionRow, WorkbenchDb, WorkspaceRow } from '../db/index.js'
import { makeId, nowIso } from '../db/index.js'
import { basename, dirname } from 'node:path'
import type { SkillCatalogEntry } from './skills.js'

type CurrentSkill = SkillCatalogEntry

export const QUICK_ACTION_SCENES = ['demand-development'] as const
export type QuickActionScene = typeof QUICK_ACTION_SCENES[number]

export interface QuickActionInput {
  name: string
  prompt: string
  skillIds?: string[]
  scenes?: string[]
  enabled?: boolean
}

export interface QuickActionView {
  id: string
  workspaceId: string
  name: string
  prompt: string
  enabled: boolean
  sortOrder: number
  skillIds: string[]
  skills: Array<{ id: string; name: string; status: 'available' | 'missing' | 'unavailable' }>
  missingSkillIds: string[]
  scenes: QuickActionScene[]
  createdAt: string
  updatedAt: string
}

function requireAction(db: WorkbenchDb, workspace: WorkspaceRow, id: string): QuickActionRow {
  const row = db.db.prepare('SELECT * FROM quick_actions WHERE id = ? AND workspace_id = ?').get(id, workspace.id) as QuickActionRow | undefined
  if (!row) throw new Error('快捷指令不存在')
  return row
}

function normalize(input: QuickActionInput): Required<Pick<QuickActionInput, 'name' | 'prompt' | 'skillIds' | 'scenes' | 'enabled'>> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const skillIds = [...new Set((Array.isArray(input.skillIds) ? input.skillIds : []).filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))]
  const scenes = [...new Set((Array.isArray(input.scenes) ? input.scenes : []).filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))]
  if (!name) throw new Error('指令名称不能为空')
  if (name.length > 80) throw new Error('指令名称不能超过 80 个字符')
  if (!prompt) throw new Error('执行内容不能为空')
  if (prompt.length > 20_000) throw new Error('执行内容不能超过 20000 个字符')
  if (skillIds.length > 20) throw new Error('每条快捷指令最多选择 20 个 Skill')
  if (scenes.length === 0) throw new Error('至少选择一个可用场景')
  const unsupported = scenes.filter(scene => !QUICK_ACTION_SCENES.includes(scene as QuickActionScene))
  if (unsupported.length) throw new Error(`不支持的快捷指令场景：${unsupported.join('、')}`)
  return { name, prompt, skillIds, scenes, enabled: input.enabled !== false }
}

function currentSkillMap(skills: CurrentSkill[]): Map<string, CurrentSkill> {
  return new Map(skills.map(skill => [skill.id, skill]))
}

function skillNameFromId(id: string): string {
  return basename(id) === 'SKILL.md' ? basename(dirname(id)) : basename(id, '.md') || id
}

function validateSelectedSkills(available: Map<string, CurrentSkill>, skillIds: string[]): void {
  for (const id of skillIds) {
    const skill = available.get(id)
    if (!skill) throw new Error(`Skill 不存在：${id}`)
    if (skill.status !== 'available' || !skill.modelInvocable) throw new Error(`Skill 当前不可调用：${skill.name}`)
  }
}

function toView(db: WorkbenchDb, currentSkills: Map<string, CurrentSkill>, row: QuickActionRow): QuickActionView {
  const skillIds = (db.db.prepare('SELECT skill_id FROM quick_action_skills WHERE quick_action_id = ? ORDER BY skill_id').all(row.id) as { skill_id: string }[]).map(item => item.skill_id)
  const scenes = (db.db.prepare('SELECT scene FROM quick_action_scenes WHERE quick_action_id = ? ORDER BY scene').all(row.id) as { scene: QuickActionScene }[]).map(item => item.scene)
  const skills = skillIds.map((id) => {
    const skill = currentSkills.get(id)
    return {
      id,
      name: skill?.name ?? skillNameFromId(id),
      status: !skill ? 'missing' as const : skill.status === 'available' && skill.modelInvocable ? 'available' as const : 'unavailable' as const,
    }
  })
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    skillIds,
    skills,
    missingSkillIds: skills.filter(skill => skill.status !== 'available').map(skill => skill.id),
    scenes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listQuickActions(db: WorkbenchDb, workspace: WorkspaceRow, skills: CurrentSkill[]): QuickActionView[] {
  const rows = db.db.prepare('SELECT * FROM quick_actions WHERE workspace_id = ? ORDER BY sort_order, created_at, id').all(workspace.id) as unknown as QuickActionRow[]
  const currentSkills = currentSkillMap(skills)
  return rows.map(row => toView(db, currentSkills, row))
}

export function createQuickAction(db: WorkbenchDb, workspace: WorkspaceRow, skills: CurrentSkill[], input: QuickActionInput): QuickActionView {
  const normalized = normalize(input)
  const currentSkills = currentSkillMap(skills)
  validateSelectedSkills(currentSkills, normalized.skillIds)
  const duplicate = db.db.prepare('SELECT id FROM quick_actions WHERE workspace_id = ? AND name = ?').get(workspace.id, normalized.name)
  if (duplicate) throw new Error('同名快捷指令已存在')
  const nextOrder = (db.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM quick_actions WHERE workspace_id = ?').get(workspace.id) as { value: number }).value
  const id = makeId('quick_action')
  const now = nowIso()
  db.db.exec('BEGIN')
  try {
    db.db.prepare('INSERT INTO quick_actions (id, workspace_id, name, prompt, enabled, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, workspace.id, normalized.name, normalized.prompt, normalized.enabled ? 1 : 0, nextOrder, now, now)
    const insertSkill = db.db.prepare('INSERT INTO quick_action_skills (quick_action_id, skill_id) VALUES (?, ?)')
    for (const skillId of normalized.skillIds) insertSkill.run(id, skillId)
    const insertScene = db.db.prepare('INSERT INTO quick_action_scenes (quick_action_id, scene) VALUES (?, ?)')
    for (const scene of normalized.scenes) insertScene.run(id, scene)
    db.db.exec('COMMIT')
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
  return toView(db, currentSkills, requireAction(db, workspace, id))
}

export function updateQuickAction(db: WorkbenchDb, workspace: WorkspaceRow, skills: CurrentSkill[], id: string, input: QuickActionInput): QuickActionView {
  const current = requireAction(db, workspace, id)
  const normalized = normalize(input)
  const currentSkills = currentSkillMap(skills)
  validateSelectedSkills(currentSkills, normalized.skillIds)
  const duplicate = db.db.prepare('SELECT id FROM quick_actions WHERE workspace_id = ? AND name = ? AND id <> ?').get(workspace.id, normalized.name, id)
  if (duplicate) throw new Error('同名快捷指令已存在')
  const now = nowIso()
  db.db.exec('BEGIN')
  try {
    db.db.prepare('UPDATE quick_actions SET name = ?, prompt = ?, enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(normalized.name, normalized.prompt, normalized.enabled ? 1 : 0, now, id, workspace.id)
    db.db.prepare('DELETE FROM quick_action_skills WHERE quick_action_id = ?').run(id)
    db.db.prepare('DELETE FROM quick_action_scenes WHERE quick_action_id = ?').run(id)
    const insertSkill = db.db.prepare('INSERT INTO quick_action_skills (quick_action_id, skill_id) VALUES (?, ?)')
    for (const skillId of normalized.skillIds) insertSkill.run(id, skillId)
    const insertScene = db.db.prepare('INSERT INTO quick_action_scenes (quick_action_id, scene) VALUES (?, ?)')
    for (const scene of normalized.scenes) insertScene.run(id, scene)
    db.db.exec('COMMIT')
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
  return toView(db, currentSkills, { ...current, name: normalized.name, prompt: normalized.prompt, enabled: normalized.enabled ? 1 : 0, updated_at: now })
}

export function deleteQuickAction(db: WorkbenchDb, workspace: WorkspaceRow, id: string): { deleted: true } {
  requireAction(db, workspace, id)
  db.db.prepare('DELETE FROM quick_actions WHERE id = ? AND workspace_id = ?').run(id, workspace.id)
  return { deleted: true }
}
