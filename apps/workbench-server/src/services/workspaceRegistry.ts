import { makeId, type WorkbenchDb, type WorkspaceRow } from '../db/index.js'

export interface WorkspaceView {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
  active: boolean
}

export interface WorkspaceRegistration {
  workspace: WorkspaceView
  created: boolean
}

export class WorkspaceRegistry {
  constructor(
    private readonly database: WorkbenchDb,
    private readonly onOpened?: (workspace: WorkspaceRow) => void,
  ) {}

  activeId(): string | undefined {
    const row = this.database.db.prepare('SELECT id FROM workspaces ORDER BY last_opened_at DESC, rowid DESC LIMIT 1').get() as { id?: string } | undefined
    return row?.id
  }

  list(): WorkspaceView[] {
    const rows = this.database.db.prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC, created_at DESC').all() as unknown as WorkspaceRow[]
    const activeId = this.activeId()
    return rows.map(row => this.view(row, activeId))
  }

  get(id: string): WorkspaceRow {
    const row = this.database.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined
    if (!row) throw new Error(`Workspace 不存在：${id}`)
    return row
  }

  register(path: string, name?: string): WorkspaceRegistration {
    const existing = this.database.db.prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as WorkspaceRow | undefined
    if (existing) return { workspace: this.openRow(existing), created: false }

    const openedAt = this.nextOpenedAt()
    const row: WorkspaceRow = {
      id: makeId('ws'),
      name: name?.trim() || path.split('/').filter(Boolean).at(-1) || path,
      path,
      created_at: openedAt,
      last_opened_at: openedAt,
    }
    this.database.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.path, row.created_at, row.last_opened_at)
    this.onOpened?.(row)
    return { workspace: this.view(row, row.id), created: true }
  }

  open(id: string): WorkspaceView {
    return this.openRow(this.get(id))
  }

  remove(id: string): void {
    this.get(id)
    this.database.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  }

  view(row: WorkspaceRow, activeId = this.activeId()): WorkspaceView {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: row.created_at,
      lastOpenedAt: row.last_opened_at,
      active: row.id === activeId,
    }
  }

  private openRow(row: WorkspaceRow): WorkspaceView {
    const openedAt = this.nextOpenedAt()
    this.database.db.prepare('UPDATE workspaces SET last_opened_at = ? WHERE id = ?').run(openedAt, row.id)
    const updated = { ...row, last_opened_at: openedAt }
    this.onOpened?.(updated)
    return this.view(updated, row.id)
  }

  private nextOpenedAt(): string {
    const latest = this.database.db.prepare('SELECT last_opened_at FROM workspaces ORDER BY last_opened_at DESC LIMIT 1').get() as { last_opened_at?: string } | undefined
    const current = Date.now()
    const latestTime = latest?.last_opened_at ? Date.parse(latest.last_opened_at) : Number.NaN
    return new Date(Number.isFinite(latestTime) && latestTime >= current ? latestTime + 1 : current).toISOString()
  }
}
