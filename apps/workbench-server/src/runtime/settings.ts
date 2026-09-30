import type { ConversationRuntimeType, RuntimeSettingsRow, WorkbenchDb } from '../db/index.js'
import { nowIso } from '../db/index.js'

export interface RuntimeSettingsView {
  runtimeType: ConversationRuntimeType
  /** Command for runtimeType, retained as a convenient single-control value. */
  command: string
  /** Runtime-id keyed commands. Adding a Runtime does not change this schema. */
  commands: Record<string, string>
  updatedAt: string
}

export interface RuntimeSettingsPatch {
  runtimeType?: ConversationRuntimeType
  /** Replace or update individual Runtime commands by stable Runtime id. */
  commands?: Record<string, string>
  /** Legacy generic command input; applies to the selected Runtime. */
  command?: string
}

function row(db: WorkbenchDb): RuntimeSettingsRow {
  return db.db.prepare('SELECT * FROM runtime_settings WHERE id = 1').get() as unknown as RuntimeSettingsRow
}

function commandMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([id, value]) => id.trim() && typeof value === 'string')
      .map(([id, value]) => [id.trim(), (value as string).trim()]))
  } catch { return {} }
}

export function runtimeSettings(db: WorkbenchDb): RuntimeSettingsView {
  const value = row(db)
  const commands = commandMap(value.commands_json)
  const runtimeType = value.runtime_type?.trim() || 'codex'
  return { runtimeType, command: commands[runtimeType] ?? '', commands, updatedAt: value.updated_at }
}

export function updateRuntimeSettings(db: WorkbenchDb, patch: RuntimeSettingsPatch): RuntimeSettingsView {
  const current = row(db)
  const currentCommands = commandMap(current.commands_json)
  const runtimeType = typeof patch.runtimeType === 'string' && patch.runtimeType.trim()
    ? patch.runtimeType.trim()
    : current.runtime_type?.trim() || 'codex'
  const commands = { ...currentCommands }
  if (patch.commands && typeof patch.commands === 'object') {
    for (const [id, command] of Object.entries(patch.commands)) {
      if (!id.trim() || typeof command !== 'string') continue
      const normalized = command.trim()
      if (normalized) commands[id.trim()] = normalized
      else delete commands[id.trim()]
    }
  }
  if (typeof patch.command === 'string') {
    const normalized = patch.command.trim()
    if (normalized) commands[runtimeType] = normalized
    else delete commands[runtimeType]
  }
  const serialized = JSON.stringify(commands)
  if (runtimeType === (current.runtime_type?.trim() || 'codex') && serialized === JSON.stringify(currentCommands)) return runtimeSettings(db)
  db.db.prepare('UPDATE runtime_settings SET runtime_type = ?, commands_json = ?, updated_at = ? WHERE id = 1')
    .run(runtimeType, serialized, nowIso())
  return runtimeSettings(db)
}

export function runtimeSettingsRow(db: WorkbenchDb): RuntimeSettingsRow { return row(db) }
