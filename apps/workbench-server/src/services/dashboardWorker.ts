import { WorkbenchDb, type WorkspaceRow } from '../db/index.js'
import { importExistingWorktrees } from './demands.js'
import { dashboardSnapshot } from './dashboard.js'

interface WorkerInput {
  dbPath: string
  workspace: WorkspaceRow
}

const encoded = process.argv[2]
if (!encoded) throw new Error('概览后台任务缺少输入')
const input = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as WorkerInput

try {
  const db = new WorkbenchDb(input.dbPath)
  // Reconcile newly discovered worktrees as part of the background pass. This
  // preserves automatic adoption without making Workspace opening synchronous.
  importExistingWorktrees(db, input.workspace)
  const snapshot = dashboardSnapshot(db, input.workspace)
  db.close()
  process.stdout.write(JSON.stringify({ ok: true, snapshot }))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
}
