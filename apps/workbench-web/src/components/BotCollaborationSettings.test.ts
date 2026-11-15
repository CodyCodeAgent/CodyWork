// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BotCollaborationSettings from './BotCollaborationSettings.vue'
const api = vi.hoisted(() => ({ botCollaboration: vi.fn(), saveBotCollaboration: vi.fn(), stopBotCollaboration: vi.fn() }))
vi.mock('../api', () => ({ api }))
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
const binding = { id: 'b', accountId: 'a', channelConversationId: 'oc_test', channelScope: 'topic', conversationTitle: '真实需求会话', targetType: 'codywork-demand' }
it('configures a group against its real bindings, persists limits, and stops a discussion', async () => {
  const session = { id: 's', chatId: 'oc_test', participants: [{ id: 'ou_a', name: '甲' }, { id: 'ou_b', name: '乙' }], lastError: '', state: { batch: 'm', topic: 'topic', round: 1, maxRounds: 3, deadline: new Date().toISOString(), joined: [0], decisions: {}, status: 'joining' } }
  api.botCollaboration.mockResolvedValue({ configs: [], sessions: [session] })
  api.saveBotCollaboration.mockResolvedValue({})
  api.stopBotCollaboration.mockResolvedValue({ stopped: true })
  const wrapper = mount(BotCollaborationSettings, { props: { accountId: 'a', bindings: [binding] as never } })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('等待：乙')
    await wrapper.find('input[placeholder="oc_…"]').setValue('oc_other')
    expect(wrapper.find('select').text()).not.toContain('真实需求会话')
    await wrapper.find('input[placeholder="oc_…"]').setValue('oc_test')
    await wrapper.find('select').setValue('b')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.saveBotCollaboration).toHaveBeenCalledWith('a', { chatId: 'oc_test', bindingId: 'b', enabled: true, maxRounds: 3, maxMinutes: 15 })
    await wrapper.findAll('button').find(item => item.text() === '停止讨论')!.trigger('click')
    await flushPromises()
    expect(api.stopBotCollaboration).toHaveBeenCalledWith('a', 's')
  } finally { wrapper.unmount() }
})

it('discovers a newly started discussion when an enabled group initially has no records', async () => {
  vi.useFakeTimers()
  api.botCollaboration.mockResolvedValue({ configs: [{ chatId: 'oc_test', bindingId: 'b', enabled: true, maxRounds: 3, maxMinutes: 15 }], sessions: [] })
  const wrapper = mount(BotCollaborationSettings, { props: { accountId: 'a', bindings: [binding] as never } })
  try {
    await flushPromises()
    api.botCollaboration.mockResolvedValue({ configs: [], sessions: [{ id: 'new', chatId: 'oc_test', participants: [], lastError: '', state: { status: 'joining', round: 1, maxRounds: 3, deadline: new Date().toISOString(), joined: [], decisions: {} } }] })
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(wrapper.text()).toContain('等待参与者')
  } finally { wrapper.unmount() }
})
