import type { RuntimeSettingsRow, WorkbenchDb } from '../db/index.js'
import { nowIso } from '../db/index.js'

export interface RuntimeSettingsView {
  provider: 'codex'
  codex: { url: string; command: string }
  updatedAt: string
}

export interface RuntimeSettingsPatch {
  codex?: { url?: string; command?: string }
}

function row(db: WorkbenchDb): RuntimeSettingsRow {
  return db.db.prepare('SELECT * FROM runtime_settings WHERE id = 1').get() as unknown as RuntimeSettingsRow
}

export function runtimeSettings(db: WorkbenchDb): RuntimeSettingsView {
  const value = row(db)
  return {
    provider: 'codex',
    codex: { url: value.codex_url ?? '', command: value.codex_command ?? '' },
    updatedAt: value.updated_at,
  }
}

export function updateRuntimeSettings(db: WorkbenchDb, patch: RuntimeSettingsPatch): RuntimeSettingsView {
  const current = row(db)
  const codex = patch.codex ?? {}
  db.db.prepare('UPDATE runtime_settings SET codex_url = ?, codex_command = ?, updated_at = ? WHERE id = 1')
    .run(typeof codex.url === 'string' ? codex.url.trim() : current.codex_url, typeof codex.command === 'string' ? codex.command.trim() : current.codex_command, nowIso())
  return runtimeSettings(db)
}

export function runtimeSettingsRow(db: WorkbenchDb): RuntimeSettingsRow { return row(db) }
