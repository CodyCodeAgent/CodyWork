import { parentPort, workerData } from 'node:worker_threads'
import { WorkbenchDb, type WorkspaceRow } from '../db/index.js'
import { importExistingWorktrees } from './demands.js'
import { dashboardSnapshot } from './dashboard.js'

interface WorkerInput {
  dbPath: string
  workspace: WorkspaceRow
}

const input = workerData as WorkerInput

try {
  const db = new WorkbenchDb(input.dbPath)
  // Reconcile newly discovered worktrees as part of the background pass. This
  // preserves automatic adoption without making Workspace opening synchronous.
  importExistingWorktrees(db, input.workspace)
  const snapshot = dashboardSnapshot(db, input.workspace)
  db.close()
  parentPort?.postMessage({ ok: true, snapshot })
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
}
