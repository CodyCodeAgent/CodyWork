import { describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../src/runtime/protocol.js'
import { WorkspaceSetupCoordinator, type WorkspaceSetupDependencies } from '../src/services/workspaceSetup.js'

function dependencies(overrides: Partial<WorkspaceSetupDependencies> = {}): WorkspaceSetupDependencies {
  let tick = 0
  return {
    prepare: () => ({ path: '/workspace', name: 'workspace', check: { status: 'incomplete', message: '需要准备' } }),
    ensureControlPlane: () => ['services', 'worktrees'],
    inspect: () => ({ check: { status: 'ready', message: 'ready', missing: [] } }),
    initialize: async (_path, onEvent) => {
      onEvent({
        type: 'assistant.delta',
        data: { text: 'prepared' },
        conversationId: 'setup',
        timestamp: '2026-08-29T00:00:01.000Z',
      } as RuntimeEvent)
      return { status: 'initialized', message: 'done' }
    },
    register: (path, name) => ({
      created: true,
      workspace: { id: 'ws-1', name: name ?? 'workspace', path, createdAt: 'now', lastOpenedAt: 'now', active: true },
    }),
    makeId: () => 'setup-1',
    now: () => `2026-08-29T00:00:0${tick++}.000Z`,
    prompt: 'setup safely',
    ...overrides,
  }
}

describe('WorkspaceSetupCoordinator', () => {
  it('runs the complete setup state machine and exposes bounded progress', async () => {
    const register = vi.fn(dependencies().register)
    const coordinator = new WorkspaceSetupCoordinator(dependencies({ register }))
    const started = coordinator.start({ type: 'folder', path: '/workspace' }, 'Demo')

    expect(started).toMatchObject({ status: 'running', stage: 'agent', prompt: 'setup safely' })
    const completed = await coordinator.wait(started.id)

    expect(completed).toMatchObject({ status: 'completed', stage: 'completed', progress: 100, response: 'done' })
    expect(completed.workspace).toMatchObject({ id: 'ws-1', name: 'Demo', path: '/workspace' })
    expect(completed.events.map(event => event.type)).toEqual([
      'preflight.completed',
      'control-plane.prepared',
      'agent.attempt',
      'assistant.delta',
    ])
    expect(register).toHaveBeenCalledWith('/workspace', 'Demo')
  })

  it('retries only transient runtime failures before registration', async () => {
    const initialize = vi.fn()
      .mockResolvedValueOnce({ status: 'error', message: 'responseStreamDisconnected: request timed out' })
      .mockResolvedValueOnce({ status: 'initialized', message: 'recovered' })
    const coordinator = new WorkspaceSetupCoordinator(dependencies({ initialize }))

    const completed = await coordinator.wait(coordinator.start({ type: 'folder', path: '/workspace' }).id)
    expect(completed.status).toBe('completed')
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(completed.events.some(event => event.type === 'agent.retry')).toBe(true)
  })

  it('fails closed when verification does not produce a ready workspace', async () => {
    const register = vi.fn(dependencies().register)
    const coordinator = new WorkspaceSetupCoordinator(dependencies({
      inspect: () => ({ check: { status: 'incomplete', message: 'missing roots', missing: ['worktrees'] } }),
      register,
    }))

    const failed = await coordinator.wait(coordinator.start({ type: 'folder', path: '/workspace' }).id)
    expect(failed).toMatchObject({ status: 'failed', stage: 'failed', progress: 100 })
    expect(failed.error).toContain('缺少：worktrees')
    expect(register).not.toHaveBeenCalled()
  })
})
