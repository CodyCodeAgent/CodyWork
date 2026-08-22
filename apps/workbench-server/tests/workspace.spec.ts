import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WorkbenchDb, makeId, nowIso } from '../src/db/index.js'
import { checkWorkspace, inspectWorkspace, prepareWorkspace } from '../src/services/workspace.js'

describe('workspace-only server primitives', () => {
  it('stores only workspace registration and latest open time', () => {
    const db = new WorkbenchDb(':memory:')
    const now = nowIso()
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(makeId('ws'), 'demo', '/tmp/demo', now, now)
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    expect(tables.map(table => table.name)).toEqual(['workspaces', 'repositories', 'demands', 'demand_repositories', 'demand_operations', 'conversations', 'conversation_events', 'conversation_audits', 'runtime_settings'])
    db.close()
  })

  it('migrates legacy runtime settings to Codex-only without losing the saved command', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-db-migration-'))
    const path = join(root, 'workspace.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE runtime_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL,
        legacy_transport TEXT NOT NULL,
        legacy_url TEXT,
        legacy_api_key TEXT,
        legacy_model TEXT,
        codex_url TEXT,
        codex_command TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO runtime_settings VALUES (1, 'legacy', 'sdk', 'https://example.invalid', 'secret', 'legacy-model', '', 'custom-codex app-server --stdio', '2026-08-22T00:00:00.000Z');
    `)
    legacy.close()
    const db = new WorkbenchDb(path)
    const columns = db.db.prepare('PRAGMA table_info(runtime_settings)').all() as { name: string }[]
    expect(columns.map(column => column.name)).toEqual(['id', 'codex_url', 'codex_command', 'updated_at'])
    const row = db.db.prepare('SELECT * FROM runtime_settings WHERE id = 1').get() as { codex_command: string }
    expect(row.codex_command).toBe('custom-codex app-server --stdio')
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('accepts an empty local folder without creating a competing scaffold', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-only-'))
    const folder = join(root, 'empty')
    const prepared = prepareWorkspace({ type: 'folder', path: folder })
    expect(prepared.path).toBe(folder)
    expect(prepared.action).toBe('initialize')
    expect(prepared.check.status).toBe('empty')
    expect(inspectWorkspace(folder).entries).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })

  it('recognizes the ai_hub shape from its root markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-shape-'))
    mkdirSync(join(root, 'services'))
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'specs'))
    mkdirSync(join(root, 'worktrees'))
    const summary = inspectWorkspace(root)
    expect(summary.isRecognized).toBe(true)
    expect(summary.check.status).toBe('ready')
    expect(summary.runtime.cwd).toBe(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('does not operate on a non-empty invalid folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-invalid-'))
    mkdirSync(join(root, 'notes'))
    expect(checkWorkspace(root).status).toBe('unsupported')
    expect(() => prepareWorkspace({ type: 'folder', path: root })).toThrow('不会覆盖已有内容')
    rmSync(root, { recursive: true, force: true })
  })

  it('adopts a complete folder without changing its contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-ready-'))
    for (const entry of ['services', 'docs', 'specs', 'worktrees']) mkdirSync(join(root, entry))
    const prepared = prepareWorkspace({ type: 'folder', path: root })
    expect(prepared.action).toBe('adopted')
    expect(prepared.check.status).toBe('ready')
    expect(inspectWorkspace(root).entries).toEqual(['docs', 'services', 'specs', 'worktrees'])
    rmSync(root, { recursive: true, force: true })
  })
})
