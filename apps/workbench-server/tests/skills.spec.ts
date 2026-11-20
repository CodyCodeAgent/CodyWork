import { describe, expect, it, vi } from 'vitest'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listInstalledWorkspaceSkills, listSkills, shareGeminiSkill } from '../src/services/skills.js'
import type { WorkspaceRow } from '../src/db/index.js'
import type { CodyWorkRuntime } from '../src/runtime/protocol.js'

describe('runtime Skill catalog', () => {
  it('uses Runtime metadata as the catalog and enriches readable files for presentation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-'))
    const skillPath = join(root, '.agents', 'skills', 'release-notes', 'SKILL.md')
    mkdirSync(join(root, '.agents', 'skills', 'release-notes'), { recursive: true })
    const content = '---\nname: release-notes\ndescription: Summarize release changes.\n---\n\n# Instructions\nUse the changelog.\n'
    writeFileSync(skillPath, content)
    const runtime = {
      listSkillCatalog: async () => [
        { id: skillPath, name: 'release-notes', label: 'Release notes', description: 'Summarize release changes.', path: skillPath, scope: 'repo' as const, enabled: true },
        { id: '/runtime/system/research/SKILL.md', name: 'research', label: 'Research', description: 'Research with Runtime tools.', path: '/runtime/system/research/SKILL.md', scope: 'system' as const, enabled: true },
        { id: '/runtime/user/legacy/SKILL.md', name: 'legacy', label: 'Legacy', description: 'Disabled helper.', path: '/runtime/user/legacy/SKILL.md', scope: 'user' as const, enabled: false },
      ],
    } as unknown as CodyWorkRuntime
    const workspace = { path: root } as WorkspaceRow

    await expect(listSkills(runtime, workspace)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: skillPath, displayName: 'Release notes', source: 'workspace', status: 'available', content }),
      expect.objectContaining({ id: '/runtime/system/research/SKILL.md', source: 'system', status: 'available', content: '' }),
      expect.objectContaining({ id: '/runtime/user/legacy/SKILL.md', source: 'user', status: 'disabled' }),
    ]))
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps filesystem scanning private to installation result reporting', () => {
    const root = mkdtempSync(join(tmpdir(), 'installed-skills-'))
    const skillDir = join(root, '.agents', 'skills', 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: review\ndescription: Review a change.\n---\n')
    const skills = listInstalledWorkspaceSkills({ path: root } as WorkspaceRow)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ name: 'review', source: 'workspace', scope: 'repo', status: 'available' })
    rmSync(root, { recursive: true, force: true })
  })

  it('uses an in-workspace link but imports personal Skill directories with their companion files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-share-'))
    const workspace = { path: join(root, 'workspace') } as WorkspaceRow
    const home = join(root, 'codex-home')
    vi.stubEnv('CODEX_HOME', home)
    const workspaceSkill = join(workspace.path, '.codex/skills/workspace-review')
    const personalSkill = join(home, 'skills/personal-review')
    try {
      for (const directory of [workspaceSkill, personalSkill]) {
        mkdirSync(directory, { recursive: true })
        const name = directory === workspaceSkill ? 'workspace-review' : 'personal-review'
        writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Review changes.\n---\n`)
        writeFileSync(join(directory, 'REFERENCE.md'), name)
      }
      const personalPath = join(personalSkill, 'SKILL.md')
      const runtime = {
        listSkillCatalog: async () => [{ id: personalPath, name: 'personal-review', label: 'Personal review', description: 'Review changes.', path: personalPath, scope: 'user', enabled: true }],
      } as unknown as CodyWorkRuntime
      const shared = join(workspace.path, '.agents/skills')
      await shareGeminiSkill(runtime, workspace, realpathSync(join(workspaceSkill, 'SKILL.md')))
      expect(readlinkSync(join(shared, 'workspace-review'))).toBe('../../.codex/skills/workspace-review')
      await shareGeminiSkill(runtime, workspace, personalPath)
      expect(lstatSync(join(shared, 'personal-review')).isDirectory()).toBe(true)
      expect(readFileSync(join(shared, 'personal-review/REFERENCE.md'), 'utf8')).toBe('personal-review')
      await expect(shareGeminiSkill(runtime, workspace, personalPath)).rejects.toThrow('已经有同名 Skill')
      expect(readFileSync(personalPath, 'utf8')).toContain('name: personal-review')
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
