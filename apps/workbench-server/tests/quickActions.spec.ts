import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkbenchDb, makeId, nowIso, type WorkspaceRow } from '../src/db/index.js'
import { createQuickAction, deleteQuickAction, listQuickActions, updateQuickAction } from '../src/services/quickActions.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codywork-quick-actions-'))
  const db = new WorkbenchDb(':memory:')
  const workspace: WorkspaceRow = { id: makeId('ws'), name: 'Quick actions', path: root, created_at: nowIso(), last_opened_at: nowIso() }
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
    .run(workspace.id, workspace.name, workspace.path, workspace.created_at, workspace.last_opened_at)
  const skillRoot = join(root, '.agents', 'skills', 'review')
  mkdirSync(skillRoot, { recursive: true })
  writeFileSync(join(skillRoot, 'SKILL.md'), '---\nname: review\ndescription: Review the current change\n---\n')
  return { root, db, workspace }
}

describe('workspace quick actions', () => {
  it('persists prompt, multiple skills and scenes as a workspace setting', () => {
    const test = fixture()
    const created = createQuickAction(test.db, test.workspace, {
      name: '检查当前改动', prompt: '先检查当前改动，再给出验证结论。', skillIds: ['workspace:review'], scenes: ['demand-development'],
    })
    expect(created).toMatchObject({ name: '检查当前改动', skillIds: ['workspace:review'], scenes: ['demand-development'], missingSkillIds: [] })
    const updated = updateQuickAction(test.db, test.workspace, created.id, {
      name: '检查并验证', prompt: '检查并运行验证。', skillIds: [], scenes: ['demand-development'], enabled: false,
    })
    expect(updated).toMatchObject({ name: '检查并验证', enabled: false, skillIds: [] })
    expect(listQuickActions(test.db, test.workspace)).toHaveLength(1)
    expect(deleteQuickAction(test.db, test.workspace, created.id)).toEqual({ deleted: true })
    expect(listQuickActions(test.db, test.workspace)).toEqual([])
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('rejects unsupported scenes and unavailable skills', () => {
    const test = fixture()
    expect(() => createQuickAction(test.db, test.workspace, { name: 'Bad scene', prompt: 'run', scenes: ['unknown'] })).toThrow('不支持')
    expect(() => createQuickAction(test.db, test.workspace, { name: 'Bad skill', prompt: 'run', scenes: ['demand-development'], skillIds: ['workspace:missing'] })).toThrow('Skill 不存在')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('surfaces a configured Skill that later disappears', () => {
    const test = fixture()
    const created = createQuickAction(test.db, test.workspace, { name: 'Review', prompt: 'review', scenes: ['demand-development'], skillIds: ['workspace:review'] })
    rmSync(join(test.root, '.agents', 'skills', 'review'), { recursive: true, force: true })
    expect(listQuickActions(test.db, test.workspace)[0]).toMatchObject({ id: created.id, missingSkillIds: ['workspace:review'], skills: [{ name: 'review', status: 'missing' }] })
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })
})
