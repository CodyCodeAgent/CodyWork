import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceRow } from '../src/db/index.js'
import { SkillInstallCoordinator } from '../src/services/skillInstall.js'

const workspace: WorkspaceRow = {
  id: 'ws-1',
  name: 'Workspace',
  path: '/workspace',
  created_at: '2026-01-01T00:00:00.000Z',
  last_opened_at: '2026-01-01T00:00:00.000Z',
}

describe('SkillInstallCoordinator', () => {
  it('owns job lifecycle and bounds runtime events', async () => {
    let sequence = 0
    const coordinator = new SkillInstallCoordinator({
      makeId: () => 'skillrun-1',
      now: () => `2026-01-01T00:00:0${sequence++}.000Z`,
      run: async (_workspace, _source, onEvent) => {
        for (let index = 0; index < 205; index += 1) {
          onEvent({ id: `event-${index}`, conversationId: 'conversation', type: 'assistant.delta', atIso: '2026-01-01T00:00:00.000Z', timestamp: '2026-01-01T00:00:00.000Z', data: { text: String(index) } })
        }
        return {
          message: 'installed',
          events: [],
          installed: [{ id: 'workspace:demo', name: 'demo', path: '/workspace/.agents/skills/demo/SKILL.md', source: 'workspace', status: 'available', modelInvocable: true, content: '', updatedAt: '' }],
        }
      },
    })

    const started = coordinator.start(workspace, '  https://example.com/SKILL.md  ')
    expect(started).toMatchObject({ id: 'skillrun-1', source: 'https://example.com/SKILL.md', status: 'running' })
    const completed = await coordinator.wait(workspace.id, started.id)
    expect(completed).toMatchObject({ status: 'completed', message: 'installed', installed: [{ name: 'demo' }] })
    expect(completed.events).toHaveLength(0)
  })

  it('contains failures inside the job and isolates workspace ownership', async () => {
    const coordinator = new SkillInstallCoordinator({
      makeId: () => 'skillrun-failed',
      now: () => '2026-01-01T00:00:00.000Z',
      run: async () => { throw new Error('runtime disconnected') },
    })
    const job = coordinator.start(workspace, 'source')
    await expect(coordinator.wait(workspace.id, job.id)).resolves.toMatchObject({ status: 'failed', message: 'runtime disconnected' })
    expect(() => coordinator.get('another-workspace', job.id)).toThrow('不存在')
    expect(() => coordinator.start(workspace, ' '.repeat(10))).toThrow('不能为空')
  })

  it('pauses a running job through its abort signal without treating it as a failure', async () => {
    let observedSignal: AbortSignal | undefined
    const coordinator = new SkillInstallCoordinator({
      makeId: () => 'skillrun-paused',
      now: () => '2026-01-01T00:00:00.000Z',
      run: async (_workspace, _source, _onEvent, signal) => {
        observedSignal = signal
        await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }))
      },
    })

    const started = coordinator.start(workspace, 'source')
    expect(coordinator.pause(workspace.id, started.id)).toMatchObject({ status: 'pausing' })
    expect(observedSignal?.aborted).toBe(true)
    await expect(coordinator.wait(workspace.id, started.id)).resolves.toMatchObject({
      status: 'paused',
      message: 'Agent 执行已暂停。已产生的文件变更不会自动回滚。',
    })
    expect(coordinator.pause(workspace.id, started.id).status).toBe('paused')
    expect(() => coordinator.pause('another-workspace', started.id)).toThrow('不存在')
  })

  it('does not stop a healthy install after the former 120 second deadline', async () => {
    vi.useFakeTimers()
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve })
    const coordinator = new SkillInstallCoordinator({
      makeId: () => 'skillrun-long',
      now: () => '2026-01-01T00:00:00.000Z',
      run: async () => {
        await pending
        return { message: 'installed after waiting', events: [], installed: [] }
      },
    })

    const started = coordinator.start(workspace, 'source')
    await vi.advanceTimersByTimeAsync(121_000)
    expect(coordinator.get(workspace.id, started.id).status).toBe('running')
    complete()
    await expect(coordinator.wait(workspace.id, started.id)).resolves.toMatchObject({ status: 'completed' })
    vi.useRealTimers()
  })
})
