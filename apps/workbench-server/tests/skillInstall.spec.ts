import { describe, expect, it } from 'vitest'
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
})
