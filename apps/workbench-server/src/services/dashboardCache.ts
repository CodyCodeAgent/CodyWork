import { Worker } from 'node:worker_threads'
import { WorkbenchDb, WorkspaceRow, nowIso } from '../db/index.js'

export interface DashboardData {
  generatedAt: string
  demands: { total: number; inProgress: number; completed: number; blocked: number }
  repositories: { total: number; normal: number; dirty: number; pullFailed: number }
  codeChanges: { additions: number; deletions: number; filesChanged: number }
  knowledge: { documents: number; lastUpdatedAt: string | null }
  skills: { available: number; disabled: number; loadFailed: number }
}

export interface DashboardView extends DashboardData {
  cache: {
    state: 'fresh' | 'stale' | 'refreshing' | 'empty'
    generatedAt: string | null
    ageSeconds: number | null
    lastError: string | null
  }
}

interface SnapshotRow { payload_json: string; generated_at: string; last_error: string | null }
type Collector = (workspace: WorkspaceRow) => Promise<DashboardData>

const STALE_AFTER_MS = 5 * 60_000

function emptySnapshot(db: WorkbenchDb, workspace: WorkspaceRow): DashboardData {
  const demands = db.db.prepare('SELECT status, COUNT(*) AS count FROM demands WHERE workspace_id = ? GROUP BY status').all(workspace.id) as { status: string; count: number }[]
  const counts = new Map(demands.map(row => [row.status, Number(row.count)]))
  const repositories = db.db.prepare('SELECT * FROM repositories WHERE workspace_id = ? AND present = 1').all(workspace.id) as { sync_status: 'ok' | 'pull_failed'; dirty: number }[]
  const repoCounts = { normal: 0, dirty: 0, pullFailed: 0 }
  for (const repository of repositories) {
    if (repository.sync_status === 'pull_failed') repoCounts.pullFailed += 1
    else if (repository.dirty) repoCounts.dirty += 1
    else repoCounts.normal += 1
  }
  return {
    generatedAt: nowIso(),
    demands: { total: demands.reduce((total, row) => total + Number(row.count), 0), inProgress: counts.get('in_progress') ?? 0, completed: counts.get('completed') ?? 0, blocked: counts.get('blocked') ?? 0 },
    repositories: { total: repositories.length, ...repoCounts },
    codeChanges: { additions: 0, deletions: 0, filesChanged: 0 },
    knowledge: { documents: 0, lastUpdatedAt: null },
    skills: { available: 0, disabled: 0, loadFailed: 0 },
  }
}

function workerCollector(dbPath: string): Collector {
  return (workspace) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dashboardWorker.ts', import.meta.url), { workerData: { dbPath, workspace } })
    worker.once('message', (message: { ok: boolean; snapshot?: DashboardData; error?: string }) => {
      void worker.terminate()
      if (message.ok && message.snapshot) resolve(message.snapshot)
      else reject(new Error(message.error ?? '概览后台刷新失败'))
    })
    worker.once('error', reject)
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`概览后台任务异常退出：${code}`)) })
  })
}

export class DashboardCache {
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly collect: Collector

  constructor(private readonly db: WorkbenchDb, collector: Collector = workerCollector(db.path)) {
    this.collect = collector
  }

  read(workspace: WorkspaceRow): DashboardView {
    const row = this.db.db.prepare('SELECT payload_json, generated_at, last_error FROM dashboard_snapshots WHERE workspace_id = ?').get(workspace.id) as SnapshotRow | undefined
    const refreshing = this.inFlight.has(workspace.id)
    if (!row) {
      return { ...emptySnapshot(this.db, workspace), cache: { state: refreshing ? 'refreshing' : 'empty', generatedAt: null, ageSeconds: null, lastError: null } }
    }
    try {
      const snapshot = JSON.parse(row.payload_json) as DashboardData
      const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(row.generated_at)) / 1000))
      const stale = ageSeconds * 1000 >= STALE_AFTER_MS
      return { ...snapshot, cache: { state: refreshing ? 'refreshing' : stale ? 'stale' : 'fresh', generatedAt: row.generated_at, ageSeconds, lastError: row.last_error } }
    } catch {
      return { ...emptySnapshot(this.db, workspace), cache: { state: refreshing ? 'refreshing' : 'empty', generatedAt: null, ageSeconds: null, lastError: '概览缓存已损坏，正在重建。' } }
    }
  }

  refreshIfStale(workspace: WorkspaceRow): DashboardView {
    const view = this.read(workspace)
    if (view.cache.state === 'empty' || view.cache.state === 'stale') void this.refresh(workspace)
    return view
  }

  refresh(workspace: WorkspaceRow): DashboardView {
    if (!this.inFlight.has(workspace.id)) {
      const task = this.collect(workspace).then(snapshot => {
        this.db.db.prepare(`
          INSERT INTO dashboard_snapshots (workspace_id, payload_json, generated_at, last_error, updated_at)
          VALUES (?, ?, ?, NULL, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET payload_json = excluded.payload_json, generated_at = excluded.generated_at, last_error = NULL, updated_at = excluded.updated_at
        `).run(workspace.id, JSON.stringify(snapshot), snapshot.generatedAt, nowIso())
      }).catch(error => {
        this.db.db.prepare(`
          INSERT INTO dashboard_snapshots (workspace_id, payload_json, generated_at, last_error, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET last_error = excluded.last_error, updated_at = excluded.updated_at
        `).run(workspace.id, JSON.stringify(emptySnapshot(this.db, workspace)), nowIso(), error instanceof Error ? error.message : String(error), nowIso())
      }).finally(() => { this.inFlight.delete(workspace.id) })
      this.inFlight.set(workspace.id, task)
    }
    return this.read(workspace)
  }

  dispose(): Promise<void> {
    // Process shutdown uses process.exit after the HTTP listener closes; do
    // not hold termination hostage to a long Git scan in a worker.
    return Promise.resolve()
  }

  waitForIdle(): Promise<void> {
    return Promise.allSettled(this.inFlight.values()).then(() => undefined)
  }
}
