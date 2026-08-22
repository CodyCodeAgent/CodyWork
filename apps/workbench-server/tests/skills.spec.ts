import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listSkills } from '../src/services/skills.js'
import type { WorkspaceRow } from '../src/db/index.js'

describe('workspace skills', () => {
  it('lists valid and disabled skills with their full content', () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-'))
    const skillDir = join(root, '.agents', 'skills', 'release-notes')
    const disabledDir = join(root, '.agents', 'skills', 'legacy-helper')
    mkdirSync(skillDir, { recursive: true })
    mkdirSync(disabledDir, { recursive: true })
    const content = '---\nname: release-notes\ndescription: |\n  Summarize release changes.\n---\n\n# Instructions\nUse the changelog.\n'
    writeFileSync(join(skillDir, 'SKILL.md'), content)
    writeFileSync(join(disabledDir, 'SKILL.md'), '---\nname: legacy-helper\ndescription: Legacy helper.\ndisable-model-invocation: true\n---\n\nDo not invoke automatically.\n')
    const workspace = { path: root } as WorkspaceRow
    const skills = listSkills(workspace).filter(skill => skill.source === 'workspace')
    expect(skills.find(skill => skill.name === 'release-notes')).toMatchObject({ description: 'Summarize release changes.', status: 'available', content })
    expect(skills.find(skill => skill.name === 'legacy-helper')).toMatchObject({ status: 'disabled', modelInvocable: false })
    rmSync(root, { recursive: true, force: true })
  })
})
