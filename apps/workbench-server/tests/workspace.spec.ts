import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WorkbenchDb, makeId, nowIso } from '../src/db/index.js'
import { checkWorkspace, ensureWorkspaceControlPlane, inspectWorkspace, prepareWorkspace, prepareWorkspaceForAssistedSetup } from '../src/services/workspace.js'
import { listRepositories } from '../src/services/repositories.js'

function initRepository(cwd: string, branch: string): void {
  execFileSync('git', ['init'], { cwd })
  execFileSync('git', ['checkout', '-b', branch], { cwd })
}

describe('workspace-only server primitives', () => {
  it('stores only workspace registration and latest open time', () => {
    const db = new WorkbenchDb(':memory:')
    const now = nowIso()
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(makeId('ws'), 'demo', '/tmp/demo', now, now)
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    expect(tables.map(table => table.name)).toEqual(['workspaces', 'repositories', 'demands', 'demand_repositories', 'demand_operations', 'conversations', 'conversation_audits', 'conversation_images', 'quick_actions', 'quick_action_skills', 'quick_action_scenes', 'runtime_settings', 'dashboard_snapshots', 'auth_sessions', 'channel_accounts', 'channel_bindings', 'channel_inbox', 'channel_outbox', 'channel_turn_links', 'channel_presentations', 'channel_interactive_requests', 'channel_audit_events'])
    const conversationColumns = db.db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]
    expect(conversationColumns.map(column => column.name)).not.toEqual(expect.arrayContaining(['provider', 'last_event_id', 'goal_json', 'plan_json']))
    db.close()
  })

  it('cuts runtime settings over to the single Codex command without losing it', () => {
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
    expect(columns.map(column => column.name)).toEqual(['id', 'codex_command', 'updated_at'])
    const row = db.db.prepare('SELECT * FROM runtime_settings WHERE id = 1').get() as { codex_command: string }
    expect(row.codex_command).toBe('custom-codex app-server --stdio')
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('directly removes the obsolete SQLite conversation event mirror', () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-events-cutover-'))
    const path = join(root, 'workspace.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY, demand_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider TEXT NOT NULL,
        native_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, permission_mode TEXT NOT NULL,
        goal_json TEXT, plan_json TEXT, policy_hash TEXT NOT NULL, instruction_hash TEXT NOT NULL,
        last_event_id INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE conversation_events (id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL, type TEXT NOT NULL);
      CREATE INDEX conversation_events_conversation_id_id ON conversation_events(conversation_id, id);
    `)
    legacy.close()
    const db = new WorkbenchDb(path)
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_events'").all()
    const columns = db.db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]
    expect(tables).toEqual([])
    expect(columns.map(column => column.name)).not.toEqual(expect.arrayContaining(['provider', 'last_event_id', 'goal_json', 'plan_json']))
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

  it('allows an explicitly opted-in setup agent to inspect a non-empty directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-assisted-'))
    writeFileSync(join(root, 'README.md'), '# existing project\n')
    expect(() => prepareWorkspace({ type: 'folder', path: root })).toThrow('不会覆盖已有内容')
    const prepared = prepareWorkspaceForAssistedSetup({ type: 'folder', path: root })
    expect(prepared.action).toBe('initialize')
    expect(prepared.check.status).toBe('unsupported')
    expect(prepared.path).toBe(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('reuses an existing clone of the same remote but rejects a different remote', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-clone-retry-'))
    const source = join(root, 'source')
    const remote = join(root, 'source.git')
    const otherRemote = join(root, 'other.git')
    const destination = join(root, 'checkout')
    mkdirSync(source)
    initRepository(source, 'main')
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: source })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: source })
    writeFileSync(join(source, 'README.md'), '# source\n')
    execFileSync('git', ['add', '.'], { cwd: source })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: source })
    execFileSync('git', ['clone', '--bare', source, remote])
    execFileSync('git', ['init', '--bare', otherRemote])

    const first = prepareWorkspace({ type: 'git', url: remote, destination })
    expect(first.action).toBe('adopted')
    expect(first.check.status).toBe('ready')
    expect(prepareWorkspace({ type: 'git', url: remote, destination }).path).toBe(destination)
    expect(() => prepareWorkspaceForAssistedSetup({ type: 'git', url: otherRemote, destination }))
      .toThrow('不是同一 Git 仓库')
    rmSync(root, { recursive: true, force: true })
  })

  it('prepares only CodyWork control-plane folders before the setup agent runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-control-plane-'))
    writeFileSync(join(root, 'AGENTS.md'), '# Existing Team Rules\n')
    expect(ensureWorkspaceControlPlane(root)).toEqual(['services', 'docs', 'specs', 'worktrees', join('.agents', 'skills')])
    expect(inspectWorkspace(root).check.status).toBe('ready')
    expect(inspectWorkspace(root).entries).toContain('AGENTS.md')
    expect(inspectWorkspace(root).entries).toContain('.agents')
    expect(ensureWorkspaceControlPlane(root)).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })

  it('treats a Git project at the Workspace root as a baseline repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-root-repo-'))
    initRepository(root, 'main')
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
    writeFileSync(join(root, 'README.md'), '# root repo\n')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
    expect(checkWorkspace(root)).toMatchObject({ status: 'ready', missing: [] })
    expect(prepareWorkspace({ type: 'folder', path: root })).toMatchObject({ action: 'adopted' })
    for (const entry of ['services', 'docs', 'specs', 'worktrees']) mkdirSync(join(root, entry))
    const db = new WorkbenchDb(':memory:')
    const now = nowIso()
    const workspace = { id: makeId('ws'), name: 'root-repo', path: root, created_at: now, last_opened_at: now }
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(workspace.id, workspace.name, workspace.path, workspace.created_at, workspace.last_opened_at)
    expect(listRepositories(db, workspace)).toMatchObject([{ name: basename(root), baseline_path: root }])
    const service = join(root, 'services', 'service-repo')
    mkdirSync(service)
    initRepository(service, 'main')
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: service })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: service })
    writeFileSync(join(service, 'README.md'), '# service repo\n')
    execFileSync('git', ['add', '.'], { cwd: service })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: service })
    expect(listRepositories(db, workspace)).toMatchObject([{ name: 'service-repo', baseline_path: service }])
    db.close()
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
