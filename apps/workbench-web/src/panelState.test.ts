import { describe, expect, it } from 'vitest'
import { readPanelCollapsed, writePanelCollapsed } from './panelState'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  } as Storage
}

describe('workbench panel state', () => {
  it('persists each collapsible panel independently', () => {
    const storage = memoryStorage()
    writePanelCollapsed(storage, 'workspace-sidebar', true)
    writePanelCollapsed(storage, 'conversation-sidebar', false)

    expect(readPanelCollapsed(storage, 'workspace-sidebar')).toBe(true)
    expect(readPanelCollapsed(storage, 'conversation-sidebar')).toBe(false)
  })

  it('keeps panels expanded when storage is unavailable', () => {
    expect(readPanelCollapsed(null, 'workspace-sidebar')).toBe(false)
    expect(() => writePanelCollapsed(null, 'workspace-sidebar', true)).not.toThrow()
  })
})
