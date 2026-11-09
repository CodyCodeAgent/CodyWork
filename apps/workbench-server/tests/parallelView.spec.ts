import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchDb } from '../src/db/index.js'
import { getParallelView, saveParallelView } from '../src/services/parallelView.js'

let db: WorkbenchDb
function seed(db: WorkbenchDb) {
  for (const id of ['w1', 'w2']) db.db.prepare('INSERT INTO workspaces VALUES(?,?,?,?,?)').run(id, id, `/tmp/parallel-${id}`, 'now', 'now')
  for (const [id, workspace] of [['d1', 'w1'], ['d2', 'w1'], ['other', 'w2']]) {
    db.db.prepare('INSERT INTO demands(id,workspace_id,name,branch_name,worktree_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, workspace, id, id, id, 'now', 'now')
    for (const suffix of ['a', 'b']) db.db.prepare("INSERT INTO conversations(id,scope,demand_id,workspace_id,native_id,title,policy_hash,instruction_hash,created_at,updated_at) VALUES(?,'demand',?,?,?,?,'','',?,?)").run(`${id}-${suffix}`, id, workspace, `${id}-${suffix}`, suffix, 'now', 'now')
  }
}
beforeEach(() => { db = new WorkbenchDb(':memory:'); seed(db) })
afterEach(() => db.close())
describe('workspace parallel view', () => {
  it.each(['columns', 'three-columns', 'grid'])('saves %s with real demand session identities, separately for each workspace', layout => {
    expect(getParallelView(db, 'w1')).toEqual({ layout: 'columns', panels: [], revision: 0 })
    const saved = saveParallelView(db, 'w1', { layout, panels: [{ demandId: 'd1', conversationId: 'd1-b' }, { demandId: 'd2', conversationId: null }], revision: 0 })
    expect(getParallelView(db, 'w1')).toEqual(saved)
    expect(getParallelView(db, 'w2').panels).toEqual([])
    expect(db.db.prepare('SELECT count(*) AS count FROM conversations').get()).toMatchObject({ count: 6 })
  })
  it.each(['columns', 'grid'])('upgrades an existing %s layout without losing selections, versions or workspace isolation', layout => {
    const root = mkdtempSync(join(tmpdir(), 'cody-parallel-layout-migration-'))
    const file = join(root, 'workspace.db')
    let store: WorkbenchDb | null = null
    const panels = [{ demandId: 'd1', conversationId: 'd1-b' }]
    try {
      store = new WorkbenchDb(file); seed(store)
      store.db.exec(`
        DROP TABLE workspace_parallel_views;
        CREATE TABLE workspace_parallel_views (
          workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
          layout TEXT NOT NULL CHECK(layout IN ('columns', 'grid')),
          panels_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
        );
      `)
      store.db.prepare('INSERT INTO workspace_parallel_views VALUES(?,?,?,?,?)').run('w1', layout, JSON.stringify(panels), 7, 'original-time')
      store.db.prepare('INSERT INTO workspace_parallel_views VALUES(?,?,?,?,?)').run('w2', 'grid', '[]', 3, 'other-time')
      store.close(); store = new WorkbenchDb(file)
      expect(getParallelView(store, 'w1')).toEqual({ layout, panels, revision: 7 })
      expect(store.db.prepare("SELECT updated_at FROM workspace_parallel_views WHERE workspace_id='w1'").get()).toMatchObject({ updated_at: 'original-time' })
      expect(() => saveParallelView(store!, 'w1', { layout: 'three-columns', panels, revision: 6 })).toThrow('其他页面更新')
      const saved = saveParallelView(store, 'w1', { layout: 'three-columns', panels, revision: 7 })
      store.close(); store = new WorkbenchDb(file)
      expect(getParallelView(store, 'w1')).toEqual(saved)
      expect(getParallelView(store, 'w2')).toEqual({ layout: 'grid', panels: [], revision: 3 })
      expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(() => store!.db.prepare("UPDATE workspace_parallel_views SET layout='invalid'").run()).toThrow()
      store.db.prepare("DELETE FROM workspaces WHERE id='w1'").run()
      expect(store.db.prepare('SELECT workspace_id FROM workspace_parallel_views').all()).toMatchObject([{ workspace_id: 'w2' }])
    } finally { store?.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('rejects cross-workspace demands, cross-demand conversations and duplicate panels without modifying saved configuration', () => {
    const initial = saveParallelView(db, 'w1', { layout: 'columns', panels: [], revision: 0 })
    for (const panels of [[{ demandId: 'other', conversationId: 'other-a' }], [{ demandId: 'd1', conversationId: 'd2-a' }], [{ demandId: 'd1', conversationId: 'other-a' }], [{ demandId: 'd1' }, { demandId: 'd1' }]]) {
      expect(() => saveParallelView(db, 'w1', { layout: 'grid', panels, revision: 1 })).toThrow()
      expect(getParallelView(db, 'w1')).toEqual(initial)
    }
  })
  it('rejects a stale tab and invalid data rather than overwriting a newer selection', () => {
    const next = saveParallelView(db, 'w1', { layout: 'columns', panels: [{ demandId: 'd1', conversationId: 'd1-a' }], revision: 0 })
    expect(() => saveParallelView(db, 'w1', { layout: 'grid', panels: [], revision: 0 })).toThrow('其他页面更新')
    for (const input of [{ layout: 'bad', panels: [], revision: 1 }, { layout: 'grid', panels: Array(5).fill({ demandId: 'd1' }), revision: 1 }, { layout: 'grid', panels: [], revision: -1 }]) expect(() => saveParallelView(db, 'w1', input)).toThrow()
    expect(getParallelView(db, 'w1')).toEqual(next)
  })
  it('recovers deleted bindings and removes layout with its workspace without stopping or deleting real sessions', () => {
    saveParallelView(db, 'w1', { layout: 'columns', panels: [{ demandId: 'd1', conversationId: 'd1-a' }, { demandId: 'd2', conversationId: 'd2-b' }], revision: 0 })
    db.db.prepare("DELETE FROM conversations WHERE id='d1-a'").run()
    expect(getParallelView(db, 'w1').panels[0]).toEqual({ demandId: 'd1', conversationId: null })
    db.db.prepare("DELETE FROM demands WHERE id='d2'").run()
    expect(getParallelView(db, 'w1').panels).toHaveLength(1)
    saveParallelView(db, 'w1', { layout: 'columns', panels: [], revision: 1 })
    expect(db.db.prepare("SELECT id FROM conversations WHERE id='d1-b'").get()).toBeDefined()
    db.db.prepare("DELETE FROM workspaces WHERE id='w1'").run()
    expect(db.db.prepare('SELECT * FROM workspace_parallel_views').all()).toEqual([])
  })
})
