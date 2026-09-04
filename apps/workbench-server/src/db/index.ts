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
  codex_command: string | null
  updated_at: string
}

export interface ConversationRow {
  id: string
  demand_id: string
  workspace_id: string
  native_id: string
  title: string
  status: ConversationStatus
  permission_mode: ConversationPermissionMode
  policy_hash: string
  instruction_hash: string
  created_at: string
  updated_at: string
}

export class WorkbenchDb {
  readonly db: DatabaseSync
  readonly path: string

  constructor(dbPath: string) {
    this.path = dbPath
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
        native_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        permission_mode TEXT NOT NULL DEFAULT 'workspace-write',
        policy_hash TEXT NOT NULL,
        instruction_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(native_id)
      );
      CREATE TABLE IF NOT EXISTS conversation_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_images (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversation_images_scope ON conversation_images(workspace_id, conversation_id);
      CREATE TABLE IF NOT EXISTS runtime_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        codex_command TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dashboard_snapshots (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        last_error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        credential_version TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_ms ON auth_sessions(expires_at_ms);
    `)
    // Direct cut-over: native Codex threads are the sole conversation history.
    // Rebuild the metadata tables once so no retired provider/event/goal shape
    // survives in the active schema. Message history is intentionally not copied.
    this.db.exec('DROP INDEX IF EXISTS conversation_events_conversation_id_id; DROP TABLE IF EXISTS conversation_events;')
    const conversationColumns = this.db.prepare('PRAGMA table_info(conversations)').all() as { name?: string }[]
    if (conversationColumns.some(column => ['provider', 'last_event_id', 'goal_json', 'plan_json'].includes(column.name ?? ''))) {
      this.db.exec('PRAGMA foreign_keys = OFF;')
      try {
        this.db.exec(`
          BEGIN IMMEDIATE;
          ALTER TABLE conversation_audits RENAME TO conversation_audits_retired;
          ALTER TABLE conversations RENAME TO conversations_retired;
          CREATE TABLE conversations (
            id TEXT PRIMARY KEY,
            demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            native_id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'idle',
            permission_mode TEXT NOT NULL DEFAULT 'workspace-write',
            policy_hash TEXT NOT NULL,
            instruction_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO conversations (id, demand_id, workspace_id, native_id, title, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at)
            SELECT id, demand_id, workspace_id, native_id, title, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at
            FROM conversations_retired;
          CREATE TABLE conversation_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          INSERT INTO conversation_audits (id, conversation_id, action, data_json, created_at)
            SELECT id, conversation_id, action, data_json, created_at FROM conversation_audits_retired;
          DROP TABLE conversation_audits_retired;
          DROP TABLE conversations_retired;
          COMMIT;
        `)
      } finally {
        this.db.exec('PRAGMA foreign_keys = ON;')
      }
    }
    const runtimeColumns = this.db.prepare('PRAGMA table_info(runtime_settings)').all() as { name?: string }[]
    if (runtimeColumns.some(column => column.name !== 'id' && column.name !== 'codex_command' && column.name !== 'updated_at')) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE runtime_settings RENAME TO runtime_settings_retired;
        CREATE TABLE runtime_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          codex_command TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO runtime_settings (id, codex_command, updated_at)
          SELECT id, codex_command, updated_at FROM runtime_settings_retired;
        DROP TABLE runtime_settings_retired;
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
