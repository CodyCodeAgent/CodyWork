import type { RuntimeSettingsRow, WorkbenchDb } from '../db/index.js'
import { nowIso } from '../db/index.js'

export interface RuntimeSettingsView {
  command: string
  updatedAt: string
}

export interface RuntimeSettingsPatch {
  command?: string
}

function row(db: WorkbenchDb): RuntimeSettingsRow {
  return db.db.prepare('SELECT * FROM runtime_settings WHERE id = 1').get() as unknown as RuntimeSettingsRow
}

export function runtimeSettings(db: WorkbenchDb): RuntimeSettingsView {
  const value = row(db)
  return {
    command: value.codex_command?.trim() ?? '',
    updatedAt: value.updated_at,
  }
}

export function updateRuntimeSettings(db: WorkbenchDb, patch: RuntimeSettingsPatch): RuntimeSettingsView {
  const current = row(db)
  const currentCommand = current.codex_command?.trim() ?? ''
  const command = typeof patch.command === 'string' ? patch.command.trim() : currentCommand
  if (currentCommand === command) return runtimeSettings(db)
  db.db.prepare('UPDATE runtime_settings SET codex_command = ?, updated_at = ? WHERE id = 1')
    .run(command, nowIso())
  return runtimeSettings(db)
}

export function runtimeSettingsRow(db: WorkbenchDb): RuntimeSettingsRow { return row(db) }
