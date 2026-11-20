import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchDb, type WorkspaceRow } from '../src/db/index.js'
import type { CodyWorkRuntime, RuntimeSkillCatalogEntry } from '../src/runtime/protocol.js'
import { syncWorkspaceSkills, withSkillRuntimeLabels } from '../src/services/skillSync.js'
import { discoverSkillDirectories, listManagedSkills } from '../src/services/skills.js'

function newFixture() {
  const root = mkdtempSync(join(tmpdir(), 'skill-sync-'))
  const workspace = { id: 'fixture', name: 'Fixture', path: join(root, 'workspace') } as WorkspaceRow
  const db = new WorkbenchDb(':memory:')
  db.db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)').run(workspace.id, workspace.name, workspace.path, '', '')
  return { root, workspace, db, dispose: () => { db.close(); rmSync(root, { recursive: true, force: true }) } }
}

function skill(folder: string, name: string, scope: RuntimeSkillCatalogEntry['scope'] = 'repo'): RuntimeSkillCatalogEntry {
  mkdirSync(folder, { recursive: true })
  const path = join(folder, 'SKILL.md')
  writeFileSync(path, `---\nname: ${name}\ndescription: Fixture Skill.\n---\n`)
  return { id: path, name, path, label: name, scope, description: 'Fixture Skill.', enabled: true }
}

function adapter(listSkillCatalog: CodyWorkRuntime['listSkillCatalog']): CodyWorkRuntime {
  return { listSkillCatalog } as CodyWorkRuntime
}

describe('workspace Skill synchronization', () => {
  it('verifies a linked catalog Skill, displays both Runtime labels, and skips conflicting Skill sources', async () => {
    const { workspace, db, dispose } = newFixture()
    try {
      const source = skill(join(workspace.path, 'skills/common/review'), 'review')
      const duplicate1 = skill(join(workspace.path, 'skills/team1/conflicting'), 'conflicting')
      const duplicate2 = skill(join(workspace.path, 'skills/team2/conflicting'), 'conflicting')
      const codex = adapter(async () => [source, duplicate1, duplicate2])
      const shared = join(workspace.path, '.agents/skills')
      const gemini = adapter(async () => discoverSkillDirectories(shared, workspace.path, 'repo'))
      const results = await syncWorkspaceSkills(db, workspace, id => id === 'codex' ? codex : gemini,
        [source.id, duplicate1.id, duplicate2.id], ['codex', 'gemini'])
      expect(results).toContainEqual(expect.objectContaining({ skillId: source.id, runtimeId: 'gemini', status: 'synced' }))
      expect(results.filter(item => item.status === 'skipped')).toHaveLength(2)
      expect(existsSync(join(shared, 'conflicting'))).toBe(false)
      const refreshed = await listManagedSkills(codex, workspace)
      expect(refreshed.filter(item => item.name === 'review')).toHaveLength(1)
      expect(withSkillRuntimeLabels(db, workspace, refreshed).find(item => item.id === source.id)?.applicableRuntimes).toEqual(['codex', 'gemini'])
      unlinkSync(join(shared, 'review'))
      expect(withSkillRuntimeLabels(db, workspace, refreshed).find(item => item.id === source.id)?.applicableRuntimes).toEqual(['codex'])
    } finally { dispose() }
  })

  it('keeps an unverified imported directory available for retry and only labels a Runtime after discovery', async () => {
    const { root, workspace, db, dispose } = newFixture()
    const home = join(root, 'codex')
    vi.stubEnv('CODEX_HOME', home)
    try {
      mkdirSync(workspace.path, { recursive: true })
      const source = skill(join(home, 'skills/my-review'), 'my-review', 'user')
      writeFileSync(join(dirname(source.path), 'reference.md'), 'reference')
      const codex = adapter(async () => [source])
      const shared = join(workspace.path, '.agents/skills')
      let discovered = false
      const gemini = adapter(async () => discovered ? discoverSkillDirectories(shared, workspace.path, 'repo') : [])
      const runtime = (id: string) => id === 'codex' ? codex : gemini
      const run = () => syncWorkspaceSkills(db, workspace, runtime, [source.id], ['gemini'])
      expect(await run()).toEqual([expect.objectContaining({ status: 'not_discovered' })])
      expect(readFileSync(join(shared, 'my-review/reference.md'), 'utf8')).toBe('reference')
      const catalog = await listManagedSkills(codex, workspace)
      expect(withSkillRuntimeLabels(db, workspace, catalog).find(item => item.id === source.id)?.applicableRuntimes).toEqual(['codex'])
      discovered = true
      expect(await run()).toEqual([expect.objectContaining({ status: 'already_available' })])
      expect(withSkillRuntimeLabels(db, workspace, catalog).find(item => item.id === source.id)?.applicableRuntimes).toEqual(['codex', 'gemini'])
    } finally {
      vi.unstubAllEnvs()
      dispose()
    }
  })
})
