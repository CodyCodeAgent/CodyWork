// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { api, type WorkbenchNotification } from '../api'
import NotificationBell from './NotificationBell.vue'
vi.mock('../api', () => ({ api: { listNotifications: vi.fn(), readNotifications: vi.fn(), resendNotification: vi.fn(), listFeishuAccounts: vi.fn(), validateNotificationRecipient: vi.fn() } }))
const note: WorkbenchNotification = { id: 'n1', workspaceId: 'w1', title: '构建完成', summary: '已通过验证', outcome: 'completed', conversationId: 'source', demandId: 'demand', createdAt: '2026-10-22T00:00:00Z', readAt: null, accountId: 'a1', recipientEmail: 'fixture@example.test', deliveryStatus: 'dead_letter', deliveryError: 'open_id cross app' }
let wrapper: ReturnType<typeof mount>
const button = (text: string) => wrapper.findAll('button').find(item => item.text() === text)!
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listNotifications).mockResolvedValue({ items: [note], unreadCount: 1, nextCursor: null })
  vi.mocked(api.listFeishuAccounts).mockResolvedValue([{ id: 'a1', name: 'Fixture', enabled: true }] as never)
})
afterEach(() => { wrapper?.unmount() })
async function open() { wrapper = mount(NotificationBell, { props: { workspaceId: 'w1' }, global: { stubs: { Teleport: true } }, attachTo: document.body }); await flushPromises(); await wrapper.get('.bell').trigger('click'); await flushPromises() }
describe('NotificationBell', () => {
  it('shows persisted unread status, separates result from delivery and links original context', async () => {
    await open()
    expect(wrapper.get('.bell').attributes('aria-label')).toContain('1 条未读')
    expect(wrapper.text()).toContain('已完成'); expect(wrapper.text()).toContain('发送失败')
    expect(wrapper.text()).toContain('旧 Open ID 不属于所选机器人')
    const href = new URL(wrapper.get('.actions a').attributes('href')!)
    expect(href.searchParams.get('conversation')).toBe('source'); expect(href.searchParams.get('demand')).toBe('demand')
    await button('标为已读').trigger('click'); await flushPromises()
    expect(api.readNotifications).toHaveBeenCalledWith('w1', 'n1', true)
    await wrapper.get('[role=dialog]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
  })
  it('requires explicit confirmation to resend and never invokes a task API', async () => {
    await open()
    await button('修正接收人并补发').trigger('click'); await flushPromises()
    expect(api.resendNotification).not.toHaveBeenCalled()
    await wrapper.get('input[type=email]').setValue('corrected@example.test')
    vi.mocked(api.resendNotification).mockResolvedValue({ ...note, deliveryStatus: 'pending', recipientEmail: 'corrected@example.test' })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.resendNotification).toHaveBeenCalledExactlyOnceWith('w1', 'n1', 'a1', 'corrected@example.test')
    expect(wrapper.text()).toContain('已有结果已进入投递队列')
  })
  it('filters unread, marks all and preserves visible failures', async () => {
    await open()
    await button('未读').trigger('click'); await flushPromises()
    expect(api.listNotifications).toHaveBeenLastCalledWith('w1', true, undefined)
    await button('全部已读').trigger('click'); await flushPromises()
    expect(api.readNotifications).toHaveBeenCalledWith('w1')
    vi.mocked(api.listNotifications).mockRejectedValueOnce(new Error('服务暂不可用'))
    await button('刷新').trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('服务暂不可用')
  })
  it('does not display old workspace responses after a scope switch', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(api.listNotifications).mockReturnValueOnce(new Promise(done => { resolve = done }) as never)
    wrapper = mount(NotificationBell, { props: { workspaceId: 'w1' }, global: { stubs: { Teleport: true } } })
    vi.mocked(api.listNotifications).mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null })
    await wrapper.setProps({ workspaceId: 'w2' }); await flushPromises()
    resolve({ items: [note], unreadCount: 99, nextCursor: null }); await flushPromises()
    expect(wrapper.get('.bell').attributes('aria-label')).toContain('0 条未读')
  })
})
