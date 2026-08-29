import { describe, expect, it, vi } from 'vitest'
import { WorkbenchDb } from '../src/db/index.js'
import { WorkspaceRegistry } from '../src/services/workspaceRegistry.js'

describe('WorkspaceRegistry', () => {
  it('owns registration, open ordering, and removal', () => {
    const db = new WorkbenchDb(':memory:')
    const onOpened = vi.fn()
    const registry = new WorkspaceRegistry(db, onOpened)

    const first = registry.register('/tmp/alpha', 'Alpha')
    const second = registry.register('/tmp/beta')
    expect(first.created).toBe(true)
    expect(second.workspace.name).toBe('beta')
    expect(registry.list()).toHaveLength(2)
    expect(registry.activeId()).toBe(second.workspace.id)

    const reopened = registry.register('/tmp/alpha', 'Ignored')
    expect(reopened.created).toBe(false)
    expect(reopened.workspace.name).toBe('Alpha')
    expect(reopened.workspace.active).toBe(true)
    expect(registry.activeId()).toBe(first.workspace.id)

    registry.remove(second.workspace.id)
    expect(registry.list().map(workspace => workspace.id)).toEqual([first.workspace.id])
    expect(onOpened).toHaveBeenCalledTimes(3)
    db.close()
  })

  it('rejects unknown workspace ids consistently', () => {
    const db = new WorkbenchDb(':memory:')
    const registry = new WorkspaceRegistry(db)
    expect(() => registry.get('missing')).toThrow('Workspace 不存在：missing')
    expect(() => registry.remove('missing')).toThrow('Workspace 不存在：missing')
    db.close()
  })
})
