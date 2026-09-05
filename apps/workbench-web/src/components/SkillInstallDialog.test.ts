// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SkillInstallDialog from './SkillInstallDialog.vue'

function job(status: 'running' | 'pausing' | 'paused' | 'completed' | 'failed' = 'running') {
  return {
    id: 'job-1', workspaceId: 'workspace', source: 'https://example.com/SKILL.md', status,
    events: [{ type: 'tool.completed', timestamp: '2026-09-05T01:02:05.000Z', data: { tool: { title: 'Command execution', summary: 'ls', details: ['exit: 0'], output: 'SKILL.md' } } }],
    startedAt: '2026-09-05T01:02:00.000Z',
  }
}

describe('SkillInstallDialog', () => {
  it('shows live agent output and emits a real pause action', async () => {
    const wrapper = mount(SkillInstallDialog, { props: { visible: true, job: job(), pausing: false } })
    expect(wrapper.attributes('role')).not.toBe('dialog')
    expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.text()).toContain('Command execution')
    expect(wrapper.text()).toContain('SKILL.md')
    expect(wrapper.text()).toContain('任务不设自动超时')
    await wrapper.find('.skill-pause-button').trigger('click')
    expect(wrapper.emitted('pause')).toHaveLength(1)
    wrapper.unmount()
  })

  it('removes the pause control after the job reaches a terminal state', () => {
    const wrapper = mount(SkillInstallDialog, { props: { visible: true, job: job('paused'), pausing: false } })
    expect(wrapper.text()).toContain('已暂停')
    expect(wrapper.find('.skill-pause-button').exists()).toBe(false)
    wrapper.unmount()
  })
})
