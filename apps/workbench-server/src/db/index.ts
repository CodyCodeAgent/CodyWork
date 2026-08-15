import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WorkspaceRow {
  id: string
  name: string
  path: string
  created_at: string
}

export interface RepoRow {
  id: string
  workspace_id: string
  name: string
  created_at: string
}

export interface DemandRow {
  id: string
  workspace_id: string
  name: string
  slug: string
  status: string
  created_at: string
}

export type DemandStatus =
  | 'draft'
  | 'spec'
  | 'plan'
  | 'tasks'
  | 'implement'
  | 'review'
  | 'test-report'
  | 'done'
  | 'compound'

export const SDD_STEPS: DemandStatus[] = [
  'draft',
  'spec',
  'plan',
  'tasks',
  'implement',
  'review',
  'test-report',
  'done',
  'compound',
]

export class WorkbenchDb {
  readonly db: DatabaseSync

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, name)
      );
      CREATE TABLE IF NOT EXISTS demands (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, slug)
      );
    `)
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

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
