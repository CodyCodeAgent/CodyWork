import { WorkbenchDb, WorkspaceRow, DemandRow } from '../db/index.js'
import { codeChanges, knowledgeSummary, listRepositories, repoSummary, skillsSummary } from './repositories.js'

export function dashboardSnapshot(db: WorkbenchDb, workspace: WorkspaceRow) {
  const repositories = listRepositories(db, workspace)
  const demands = db.db.prepare('SELECT status, COUNT(*) AS count FROM demands WHERE workspace_id = ? GROUP BY status').all(workspace.id) as { status: DemandRow['status']; count: number }[]
  const counts = new Map(demands.map(row => [row.status, Number(row.count)]))
  const repoCounts = { normal: 0, dirty: 0, pullFailed: 0 }
  for (const repository of repositories) repoCounts[repoSummary(repository)] += 1
  return {
    generatedAt: new Date().toISOString(),
    demands: { total: demands.reduce((sum, row) => sum + Number(row.count), 0), inProgress: counts.get('in_progress') ?? 0, completed: counts.get('completed') ?? 0, blocked: counts.get('blocked') ?? 0 },
    repositories: { total: repositories.length, ...repoCounts },
    codeChanges: codeChanges(db, workspace),
    knowledge: knowledgeSummary(workspace),
    skills: skillsSummary(workspace),
  }
}
