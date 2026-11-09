import { WorkbenchDb, nowIso } from '../db/index.js'

export interface ParallelView {
  layout: 'columns' | 'three-columns' | 'grid'
  panels: Array<{ demandId: string; conversationId: string | null }>
  revision: number
}
type Row = { layout: ParallelView['layout']; panels_json: string; revision: number }
export const MAX_PARALLEL_DEMANDS = 4

/** Product layout only. Native conversation history is never stored here. */
export function getParallelView(db: WorkbenchDb, workspaceId: string): ParallelView {
  const row = db.db.prepare('SELECT layout, panels_json, revision FROM workspace_parallel_views WHERE workspace_id=?').get(workspaceId) as Row | undefined
  if (!row) return { layout: 'columns', panels: [], revision: 0 }
  const panels = (JSON.parse(row.panels_json) as ParallelView['panels']).filter(panel =>
    db.db.prepare('SELECT id FROM demands WHERE id=? AND workspace_id=?').get(panel.demandId, workspaceId),
  ).map(panel => ({
    demandId: panel.demandId,
    conversationId: panel.conversationId && db.db.prepare("SELECT id FROM conversations WHERE id=? AND workspace_id=? AND demand_id=? AND scope='demand'").get(panel.conversationId, workspaceId, panel.demandId) ? panel.conversationId : null,
  }))
  return { layout: row.layout, panels, revision: row.revision }
}

export function saveParallelView(db: WorkbenchDb, workspaceId: string, input: Record<string, unknown>): ParallelView {
  if (input.layout !== 'columns' && input.layout !== 'three-columns' && input.layout !== 'grid') throw new Error('请选择两列、三列或四宫格布局')
  if (!Array.isArray(input.panels) || input.panels.length > MAX_PARALLEL_DEMANDS) throw new Error(`并行视图最多添加 ${MAX_PARALLEL_DEMANDS} 个需求`)
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new Error('视图版本无效，请重新加载')
  const seen = new Set<string>()
  const panels = input.panels.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('需求面板无效')
    const panel = item as Record<string, unknown>
    if (typeof panel.demandId !== 'string' || seen.has(panel.demandId)) throw new Error('每个需求只能添加一个面板')
    seen.add(panel.demandId)
    if (!db.db.prepare('SELECT id FROM demands WHERE id=? AND workspace_id=?').get(panel.demandId, workspaceId)) throw new Error('需求不属于当前工作空间或已被删除')
    const conversationId = panel.conversationId ?? null
    if (conversationId !== null && (typeof conversationId !== 'string' || !db.db.prepare("SELECT id FROM conversations WHERE id=? AND workspace_id=? AND demand_id=? AND scope='demand'").get(conversationId, workspaceId, panel.demandId))) throw new Error('请选择该需求下的真实会话')
    return { demandId: panel.demandId, conversationId: conversationId as string | null }
  })
  const row = db.db.prepare('SELECT revision FROM workspace_parallel_views WHERE workspace_id=?').get(workspaceId) as { revision: number } | undefined
  if ((row?.revision ?? 0) !== input.revision) throw new Error('并行视图已在其他页面更新，请重新加载后再修改')
  const revision = Number(input.revision) + 1
  db.db.prepare(`INSERT INTO workspace_parallel_views(workspace_id,layout,panels_json,revision,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(workspace_id) DO UPDATE SET layout=excluded.layout,panels_json=excluded.panels_json,revision=excluded.revision,updated_at=excluded.updated_at`).run(workspaceId, input.layout, JSON.stringify(panels), revision, nowIso())
  return { layout: input.layout, panels, revision }
}
