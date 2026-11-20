import { join } from 'node:path'
import type { WorkbenchDb, WorkspaceRow } from '../db/index.js'
import type { CodyWorkRuntime, RuntimeSkillCatalogEntry } from '../runtime/protocol.js'
import { canonicalSkillPath, containsSkillPath, listManagedSkills, placeSharedSkill, type SkillCatalogEntry, type SkillSyncRuntime } from './skills.js'

export const SKILL_SYNC_RUNTIMES = ['codex', 'gemini'] as const

export interface SkillSyncTarget {
  id: string
  label: string
  available: boolean
  reason?: string
}

interface SkillSyncResult {
  skillId: string
  name: string
  runtimeId: SkillSyncRuntime
  status: 'synced' | 'already_available' | 'skipped' | 'not_discovered' | 'failed'
  message?: string
}

interface SyncRecord {
  skill_id: string
  runtime_id: SkillSyncRuntime
  source_path: string
  installed_path: string
  installed_real_path: string
  discovered: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function records(db: WorkbenchDb, workspace: WorkspaceRow): SyncRecord[] {
  return db.db.prepare('SELECT skill_id, runtime_id, source_path, installed_path, installed_real_path, discovered FROM workspace_skill_syncs WHERE workspace_id = ?')
    .all(workspace.id) as unknown as SyncRecord[]
}

function validRecord(workspace: WorkspaceRow, row: SyncRecord): boolean {
  return containsSkillPath(workspace.path, row.installed_path)
    && canonicalSkillPath(row.installed_path) === row.installed_real_path
}

export function withSkillRuntimeLabels(db: WorkbenchDb, workspace: WorkspaceRow, catalog: SkillCatalogEntry[]): SkillCatalogEntry[] {
  const verified = new Map<string, Set<SkillSyncRuntime>>()
  for (const skill of catalog) {
    const path = canonicalSkillPath(skill.path)
    if (path && skill.applicableRuntimes?.includes('codex')) verified.set(path, new Set(['codex']))
  }
  for (const record of records(db, workspace)) {
    if (!record.discovered || !validRecord(workspace, record)) continue
    for (const path of [record.source_path, record.installed_real_path]) {
      const runtimes = verified.get(path) ?? new Set<SkillSyncRuntime>()
      runtimes.add(record.runtime_id)
      verified.set(path, runtimes)
    }
  }
  return catalog.map(skill => {
    const extra = skill.status === 'available' ? verified.get(canonicalSkillPath(skill.path) ?? '') : undefined
    return { ...skill, applicableRuntimes: SKILL_SYNC_RUNTIMES.filter(id => skill.applicableRuntimes?.includes(id) || extra?.has(id)) }
  })
}

export async function checkSkillSyncTarget(
  target: { id: string; label: string }, workspacePath: string, runtime: () => CodyWorkRuntime,
): Promise<SkillSyncTarget> {
  if (!SKILL_SYNC_RUNTIMES.some(id => id === target.id)) {
    return { ...target, available: false, reason: '当前 Runtime 暂不支持同步 Skills' }
  }
  try {
    await runtime().listSkillCatalog({ workspacePath })
    return { ...target, available: true }
  } catch (error) {
    return { ...target, available: false, reason: errorMessage(error) }
  }
}

function discoveredSkills(entries: RuntimeSkillCatalogEntry[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (!entry.enabled) continue
    const paths = result.get(entry.name) ?? new Set<string>()
    paths.add(canonicalSkillPath(entry.path) ?? entry.path)
    result.set(entry.name, paths)
  }
  return result
}

export async function syncWorkspaceSkills(
  db: WorkbenchDb,
  workspace: WorkspaceRow,
  runtime: (id: SkillSyncRuntime) => CodyWorkRuntime,
  skillIds: string[],
  runtimeIds: SkillSyncRuntime[],
): Promise<SkillSyncResult[]> {
  const catalog = new Map((await listManagedSkills(runtime('codex'), workspace)).map(skill => [skill.id, skill]))
  const saved = records(db, workspace).filter(row => validRecord(workspace, row))
  const installedBySource = new Map(saved.map(row => [row.source_path, row.installed_path]))
  const selected = skillIds.map(id => ({ id, skill: catalog.get(id) }))
  const collisions = new Map<string, Set<string>>()
  for (const { skill } of selected) {
    if (!skill?.geminiSharing) continue
    const sources = collisions.get(skill.name) ?? new Set<string>()
    const identity = canonicalSkillPath(skill.path)
    if (identity) sources.add(identity)
    collisions.set(skill.name, sources)
  }
  const availability = await Promise.all(runtimeIds.map(id => checkSkillSyncTarget({ id, label: id }, workspace.path, () => runtime(id))))
  const results: SkillSyncResult[] = []
  const pending: Array<{ skill: SkillCatalogEntry; runtimeId: SkillSyncRuntime; source: string; installed: string; already: boolean }> = []
  const save = db.db.prepare(`
    INSERT INTO workspace_skill_syncs (workspace_id, skill_id, runtime_id, source_path, installed_path, installed_real_path, discovered)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, skill_id, runtime_id) DO UPDATE SET
      source_path = excluded.source_path, installed_path = excluded.installed_path,
      installed_real_path = excluded.installed_real_path, discovered = excluded.discovered
  `)
  for (const { id, skill } of selected) {
    for (const [i, runtimeId] of runtimeIds.entries()) {
      const item = { skillId: id, name: skill?.displayName ?? 'Skill', runtimeId }
      const target = availability[i]!
      if (!target.available) {
        results.push({ ...item, status: 'failed', message: target.reason })
        continue
      }
      if (!skill || skill.status !== 'available') {
        results.push({ ...item, status: 'skipped', message: 'Skill 已失效或停用' })
        continue
      }
      if (skill.applicableRuntimes?.includes(runtimeId)) {
        results.push({ ...item, status: 'already_available' })
        continue
      }
      const source = canonicalSkillPath(skill.path)
      if (!source || !skill.geminiSharing) {
        results.push({ ...item, status: 'skipped', message: '此来源不支持同步到该 Runtime' })
        continue
      }
      let installed = installedBySource.get(source)
      const already = Boolean(installed) || skill.geminiSharing === 'shared'
      if (!installed && !already && (collisions.get(skill.name)?.size ?? 0) > 1
        && !canonicalSkillPath(join(workspace.path, '.agents', 'skills', skill.name, 'SKILL.md'))) {
        results.push({ ...item, status: 'skipped', message: '选中了不同来源的同名 Skill，请单独选择一个来源' })
        continue
      }
      try {
        if (!installed) {
          installed = await placeSharedSkill(workspace, skill)
          installedBySource.set(source, installed)
        }
        const realPath = canonicalSkillPath(installed)
        if (!realPath) throw new Error('共享目录中的 Skill 文件不存在')
        save.run(workspace.id, skill.id, runtimeId, source, installed, realPath, 0)
        pending.push({ skill, runtimeId, source, installed, already })
      } catch (error) {
        results.push({ ...item, status: 'skipped', message: errorMessage(error) })
      }
    }
  }
  const verifyRuntimes = [...new Set(pending.map(item => item.runtimeId))]
  const catalogs = new Map<SkillSyncRuntime, { discovered?: Map<string, Set<string>>; message?: string }>(await Promise.all(verifyRuntimes.map(async id => {
    try {
      const entries = await runtime(id).listSkillCatalog({ workspacePath: workspace.path, forceReload: true })
      return [id, { discovered: discoveredSkills(entries) }] as const
    } catch (error) {
      return [id, { message: errorMessage(error) }] as const
    }
  })))
  for (const item of pending) {
    const { skill, runtimeId, source, installed, already } = item
    const result = { skillId: skill.id, name: skill.displayName, runtimeId }
    const observed = catalogs.get(runtimeId)
    const path = canonicalSkillPath(installed)
    if (path && containsSkillPath(workspace.path, installed) && observed?.discovered?.get(skill.name)?.has(path)) {
      save.run(workspace.id, skill.id, runtimeId, source, installed, path, 1)
      results.push({ ...result, status: already ? 'already_available' : 'synced' })
    } else {
      results.push({
        ...result, status: 'not_discovered',
        message: observed?.message || '已放入共享目录，当前 Runtime 尚未发现此 Skill',
      })
    }
  }
  return results
}
