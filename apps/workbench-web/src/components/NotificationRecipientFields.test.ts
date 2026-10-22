// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import NotificationRecipientFields from './NotificationRecipientFields.vue'
import { api } from '../api'
vi.mock('../api', () => ({ api: { listFeishuAccounts: vi.fn(), validateNotificationRecipient: vi.fn() } }))
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.listFeishuAccounts).mockResolvedValue([{ id: 'a1', enabled: true, name: 'Fixture' }] as never) })
describe('recipient email validation', () => {
  it('does not require a bot for local-only notifications and validates under the chosen app', async () => {
    const wrapper = mount(NotificationRecipientFields, { props: { workspaceId: 'w1', accountId: 'a1', email: 'fixture@example.test', enabled: false } })
    await flushPromises(); expect(wrapper.find('input[type=email]').exists()).toBe(false)
    await wrapper.setProps({ enabled: true }); vi.mocked(api.validateNotificationRecipient).mockResolvedValue({ valid: true, email: 'fixture@example.test' })
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(api.validateNotificationRecipient).toHaveBeenCalledWith('w1', 'a1', 'fixture@example.test')
    expect(wrapper.text()).toContain('未发送消息')
    await wrapper.setProps({ accountId: 'a2' }); expect(wrapper.text()).not.toContain('校验成功')
    wrapper.unmount()
  })
  it('discards stale validation after switching account and displays permission failures', async () => {
    let done!: (value: unknown) => void
    vi.mocked(api.validateNotificationRecipient).mockReturnValueOnce(new Promise(resolve => { done = resolve }) as never)
    const wrapper = mount(NotificationRecipientFields, { props: { workspaceId: 'w1', accountId: 'a1', email: 'fixture@example.test', enabled: true } })
    await flushPromises(); await wrapper.get('button').trigger('click'); await wrapper.setProps({ accountId: 'a2' })
    done({ valid: true, email: 'fixture@example.test' }); await flushPromises(); expect(wrapper.text()).not.toContain('校验成功')
    vi.mocked(api.validateNotificationRecipient).mockRejectedValueOnce(new Error('缺少通讯录权限'))
    await wrapper.get('button').trigger('click'); await flushPromises(); expect(wrapper.get('[role=alert]').text()).toContain('缺少通讯录权限')
    wrapper.unmount()
  })
})
