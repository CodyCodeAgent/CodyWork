import type { DemandFluxBindingRow, WorkbenchDb, WorkspaceRow } from '../db/index.js'
import { nowIso } from '../db/index.js'

export interface FluxBinding {
  deliveryId: string
  spaceId: string
  url: string
  previewTaskId: string | null
}

const fluxId = '[A-Za-z0-9_-]+'
const collaborationPath = new RegExp(`^/(?:flux/)?(home|team)/(${fluxId})/collaboration/(${fluxId})/?$`)
const navigationValue = /^[A-Za-z0-9_-]{1,64}$/

function toBinding(row: DemandFluxBindingRow): FluxBinding {
  return {
    deliveryId: row.delivery_id,
    spaceId: row.space_id,
    url: row.collaboration_url,
    previewTaskId: row.preview_task_id,
  }
}

/** Parse and canonicalize a user-facing Flux collaboration URL without contacting Flux. */
export function parseFluxCollaborationUrl(value: string | undefined): FluxBinding | null {
  const raw = value?.trim()
  if (!raw) return null
  if (raw.length > 2_048) throw new Error('Bits Flux 协作链接过长')

  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Bits Flux 协作链接格式不正确') }
  const supportedHost = url.hostname === 'flux.bytedance.net' || url.hostname === 'bits.bytedance.net'
  if (url.protocol !== 'https:' || !supportedHost || url.port || url.username || url.password) {
    throw new Error('请粘贴 Bits Flux 的 HTTPS 协作链接')
  }

  const match = collaborationPath.exec(url.pathname)
  if (!match || (url.hostname === 'bits.bytedance.net' && !url.pathname.startsWith('/flux/'))) {
    throw new Error('链接中没有可识别的 Bits Flux 协作 ID')
  }

  const [, scope, spaceId, deliveryId] = match
  const previewTaskId = url.searchParams.get('preview_task')
  if (previewTaskId && !new RegExp(`^${fluxId}$`).test(previewTaskId)) throw new Error('Bits Flux 链接中的 preview_task 不正确')

  const canonical = new URL(`https://flux.bytedance.net/${scope}/${spaceId}/collaboration/${deliveryId}`)
  for (const key of ['view', 'tab'] as const) {
    const parameter = url.searchParams.get(key)
    if (!parameter) continue
    if (!navigationValue.test(parameter)) throw new Error(`Bits Flux 链接中的 ${key} 不正确`)
    canonical.searchParams.set(key, parameter)
  }
  if (previewTaskId) canonical.searchParams.set('preview_task', previewTaskId)

  return { spaceId: spaceId!, deliveryId: deliveryId!, url: canonical.toString(), previewTaskId: previewTaskId || null }
}

export function getDemandFluxBinding(db: WorkbenchDb, demandId: string): FluxBinding | null {
  const row = db.db.prepare('SELECT * FROM demand_flux_bindings WHERE demand_id = ?').get(demandId) as DemandFluxBindingRow | undefined
  return row ? toBinding(row) : null
}

export function insertDemandFluxBinding(db: WorkbenchDb, demandId: string, binding: FluxBinding, timestamp: string): void {
  db.db.prepare('INSERT INTO demand_flux_bindings (demand_id, delivery_id, space_id, collaboration_url, preview_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(demandId, binding.deliveryId, binding.spaceId, binding.url, binding.previewTaskId, timestamp, timestamp)
}

export function bindDemandToFlux(db: WorkbenchDb, workspace: WorkspaceRow, demandId: string, value: string): FluxBinding {
  const demand = db.db.prepare('SELECT id FROM demands WHERE id = ? AND workspace_id = ?').get(demandId, workspace.id) as { id: string } | undefined
  if (!demand) throw new Error('需求不存在')
  const binding = parseFluxCollaborationUrl(value)
  if (!binding) throw new Error('Bits Flux 协作链接不能为空')
  const timestamp = nowIso()
  db.db.exec('BEGIN')
  try {
    db.db.prepare(`INSERT INTO demand_flux_bindings (demand_id, delivery_id, space_id, collaboration_url, preview_task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(demand_id) DO UPDATE SET delivery_id = excluded.delivery_id, space_id = excluded.space_id, collaboration_url = excluded.collaboration_url, preview_task_id = excluded.preview_task_id, updated_at = excluded.updated_at`)
      .run(demandId, binding.deliveryId, binding.spaceId, binding.url, binding.previewTaskId, timestamp, timestamp)
    db.db.prepare('UPDATE demands SET updated_at = ? WHERE id = ?').run(timestamp, demandId)
    db.db.exec('COMMIT')
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
  return binding
}

export function unbindDemandFromFlux(db: WorkbenchDb, workspace: WorkspaceRow, demandId: string): { removed: boolean } {
  const demand = db.db.prepare('SELECT id FROM demands WHERE id = ? AND workspace_id = ?').get(demandId, workspace.id) as { id: string } | undefined
  if (!demand) throw new Error('需求不存在')
  const timestamp = nowIso()
  db.db.exec('BEGIN')
  try {
    const result = db.db.prepare('DELETE FROM demand_flux_bindings WHERE demand_id = ?').run(demandId)
    db.db.prepare('UPDATE demands SET updated_at = ? WHERE id = ?').run(timestamp, demandId)
    db.db.exec('COMMIT')
    return { removed: result.changes > 0 }
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
}
