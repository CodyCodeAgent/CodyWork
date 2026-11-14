// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SkillInstallDialog from './SkillInstallDialog.vue'
import type { SkillInstallStatus } from '../api'

let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })
const job: SkillInstallStatus = {
  id: 'install-1', workspaceId: 'workspace-1', source: '/disposable/skill',
  status: 'running', startedAt: '2026-11-14T00:00:00Z', events: [],
}

describe('SkillInstallDialog streaming accessibility', () => {
  it('keeps internal diagnostics accessible while prioritizing command output and terminal feedback', async () => {
    wrapper = mount(SkillInstallDialog, { props: { visible: true, pausing: false, job: { ...job, events: [
      { type: 'provider.extension', data: {} },
      { type: 'tool.completed', data: { tool: { title: 'Command execution', output: 'README verified' } } },
      { type: 'thread.context.updated', data: {} },
    ] } }, attachTo: document.body })
    await flushPromises()
    const diagnostics = wrapper.get('details')
    expect(diagnostics.attributes('open')).toBeUndefined()
    expect(diagnostics.get('summary').text()).toBe('运行诊断 · 2 条')
    expect(diagnostics.text()).toContain('provider.extension')
    expect(wrapper.get('.skill-run-log > article').text()).toContain('README verified')
    await wrapper.setProps({ job: { ...job, status: 'paused', message: '安装已暂停', events: [{ type: 'provider.extension', data: {} }] } })
    expect(wrapper.find('.skill-run-spinner').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toBe('安装已暂停')
  })

  it('keeps keyboard focus on the chosen action across polling and incoming events', async () => {
    wrapper = mount(SkillInstallDialog, { props: { visible: true, job, pausing: false }, attachTo: document.body })
    await flushPromises()
    const pause = wrapper.get('.skill-pause-button').element as HTMLButtonElement
    pause.focus()
    await wrapper.setProps({ job: { ...job } })
    await flushPromises()
    expect(document.activeElement).toBe(pause)
    await wrapper.setProps({ job: { ...job, events: [{ type: 'assistant.delta', data: { text: 'Progress' } }] } })
    await flushPromises()
    expect(document.activeElement).toBe(pause)
    await wrapper.get('.skill-pause-button').trigger('click')
    expect(wrapper.emitted('pause')).toHaveLength(1)
    await wrapper.setProps({ pausing: true })
    await flushPromises()
    expect(document.activeElement?.textContent).toBe('收起')
    await wrapper.setProps({ job: { ...job, status: 'pausing' } })
    await flushPromises()
    expect(document.activeElement?.textContent).toBe('收起')
    await wrapper.setProps({ job: { ...job, status: 'completed' } })
    await flushPromises()
    expect(document.activeElement?.textContent).toBe('关闭')
  })

  it('does not pull a reader away from earlier log entries when new output arrives', async () => {
    wrapper = mount(SkillInstallDialog, { props: { visible: true, job, pausing: false }, attachTo: document.body })
    await flushPromises()
    const log = wrapper.get('[role="log"]').element as HTMLElement
    Object.defineProperties(log, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } })
    log.scrollTop = 100
    await wrapper.setProps({ job: { ...job, events: [{ type: 'assistant.delta', data: { text: 'Update' } }] } })
    await flushPromises()
    expect(log.scrollTop).toBe(100)
    log.scrollTop = 800
    await wrapper.setProps({ job: { ...job, events: [
      { type: 'assistant.delta', data: { text: 'Update' } },
      { type: 'assistant.completed', data: { text: 'Done' } },
    ] } })
    await flushPromises()
    expect(log.scrollTop).toBe(1000)
  })
})
