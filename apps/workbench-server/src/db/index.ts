import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WorkspaceRow {
  id: string
  name: string
  path: string
  created_at: string
  last_opened_at: string
}

export interface RepositoryRow {
  id: string
  workspace_id: string
  name: string
  baseline_path: string
  origin_url: string | null
  default_ref: string | null
  sync_status: 'ok' | 'pull_failed'
  sync_error: string | null
  dirty: number
  present: number
  inspected_at: string
}

export interface DemandRow {
  id: string
  workspace_id: string
  name: string
  branch_name: string
  worktree_key: string
  status: 'in_progress' | 'completed' | 'blocked'
  created_at: string
  updated_at: string
}

export type ConversationStatus = 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'disconnected'
export type ConversationPermissionMode = 'read-only' | 'workspace-write' | 'yolo'

export interface RuntimeSettingsRow {
  id: number
  codex_url: string | null
  codex_command: string | null
  updated_at: string
}

export interface ConversationRow {
  id: string
  demand_id: string
  workspace_id: string
  provider: string
  native_id: string
  title: string
  status: ConversationStatus
  permission_mode: ConversationPermissionMode
  goal_json: string | null
  plan_json: string | null
  policy_hash: string
  instruction_hash: string
  last_event_id: number
  created_at: string
  updated_at: string
}

export interface ConversationEventRow {
  id: number
  conversation_id: string
  type: string
  turn_id: string | null
  item_id: string | null
  provider: string
  timestamp: string
  data_json: string
}

export class WorkbenchDb {
  readonly db: DatabaseSync

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        baseline_path TEXT NOT NULL,
        origin_url TEXT,
        default_ref TEXT,
        sync_status TEXT NOT NULL DEFAULT 'ok',
        sync_error TEXT,
        dirty INTEGER NOT NULL DEFAULT 0,
        present INTEGER NOT NULL DEFAULT 1,
        inspected_at TEXT NOT NULL,
        UNIQUE(workspace_id, baseline_path)
      );
      CREATE TABLE IF NOT EXISTS demands (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        worktree_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, worktree_key)
      );
      CREATE TABLE IF NOT EXISTS demand_repositories (
        demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        branch_name TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        base_ref TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(demand_id, repository_id),
        UNIQUE(repository_id, branch_name)
      );
      CREATE TABLE IF NOT EXISTS demand_operations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        native_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        permission_mode TEXT NOT NULL DEFAULT 'workspace-write',
        goal_json TEXT,
        plan_json TEXT,
        policy_hash TEXT NOT NULL,
        instruction_hash TEXT NOT NULL,
        last_event_id INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, native_id)
      );
      CREATE TABLE IF NOT EXISTS conversation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        turn_id TEXT,
        item_id TEXT,
        provider TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversation_events_conversation_id_id ON conversation_events(conversation_id, id);
      CREATE TABLE IF NOT EXISTS conversation_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        codex_url TEXT,
        codex_command TEXT,
        updated_at TEXT NOT NULL
      );
    `)
    const runtimeColumns = this.db.prepare('PRAGMA table_info(runtime_settings)').all() as { name?: string }[]
    if (runtimeColumns.some(column => column.name === 'provider' || column.name?.startsWith('legacy_'))) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE runtime_settings RENAME TO runtime_settings_legacy;
        CREATE TABLE runtime_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          codex_url TEXT,
          codex_command TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO runtime_settings (id, codex_url, codex_command, updated_at)
          SELECT id, codex_url, codex_command, updated_at FROM runtime_settings_legacy;
        DROP TABLE runtime_settings_legacy;
        COMMIT;
      `)
    }
    this.db.prepare('INSERT OR IGNORE INTO runtime_settings (id, updated_at) VALUES (1, ?)').run(nowIso())
  }

  close() {
    this.db.close()
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
