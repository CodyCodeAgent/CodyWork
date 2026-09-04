// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FeishuChannelSettings from './FeishuChannelSettings.vue'

const api = vi.hoisted(() => ({
  listFeishuAccounts: vi.fn(), createFeishuAccount: vi.fn(), updateFeishuAccount: vi.fn(), deleteFeishuAccount: vi.fn(),
  reconnectFeishuAccount: vi.fn(), feishuDiagnostics: vi.fn(), listFeishuBindings: vi.fn(), retryFeishuOutbox: vi.fn(),
}))

vi.mock('../api', () => ({ api }))

function account(id: string, enabled = false) {
  return { id, provider: 'feishu', name: `Bot ${id}`, appId: `cli_${id}`, appSecretConfigured: true, domain: 'feishu', enabled, allowAllUsers: false, allowedUserIds: ['ou_test'], allowedConversationIds: [], groupMentionMode: 'always', privateConversationMode: 'chat', botOpenId: '', botName: '', connectionState: enabled ? 'connected' : 'idle', lastError: '', connectedAt: null, lastEventAt: null, lastDeliveryAt: null, createdAt: '', updatedAt: '' }
}

function diagnostics(id: string) {
  return { account: account(id), bindings: id === 'second' ? 2 : 1, runtime: { observedConversations: id === 'second' ? 2 : 1 }, inbox: { waiting: 0, failed: 0, submitted: 0, queued: 0 }, outbox: { pending: 0, deadLetter: 0, failures: [] } }
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('FeishuChannelSettings', () => {
  it('disables reconnect for disabled accounts and documents open_id-only allowlists', async () => {
    api.listFeishuAccounts.mockResolvedValue([account('disabled')])
    api.feishuDiagnostics.mockResolvedValue(diagnostics('disabled'))
    api.listFeishuBindings.mockResolvedValue([])
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    const reconnect = wrapper.findAll('button').find(button => button.text() === '重新连接')
    expect(reconnect?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('允许用户 open_id')
    expect(wrapper.find('textarea[placeholder*="open_id"]').attributes('placeholder')).toContain('不支持 union_id')
    expect(api.reconnectFeishuAccount).not.toHaveBeenCalled()
  })

  it('ignores stale diagnostics when accounts are switched quickly', async () => {
    let resolveFirst!: (value: ReturnType<typeof diagnostics>) => void
    const firstDiagnostics = new Promise<ReturnType<typeof diagnostics>>(resolve => { resolveFirst = resolve })
    api.listFeishuAccounts.mockResolvedValue([account('first'), account('second', true)])
    api.feishuDiagnostics.mockImplementation((id: string) => id === 'first' ? firstDiagnostics : Promise.resolve(diagnostics('second')))
    api.listFeishuBindings.mockResolvedValue([])
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    await wrapper.findAll('.account-row')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Bot second')
    expect(wrapper.find('.metrics').text()).toContain('2')

    resolveFirst(diagnostics('first'))
    await flushPromises()
    expect(wrapper.find('.metrics').text()).toContain('2')
  })

  it('surfaces delete failures without clearing the selected account', async () => {
    api.listFeishuAccounts.mockResolvedValue([account('kept')])
    api.feishuDiagnostics.mockResolvedValue(diagnostics('kept'))
    api.listFeishuBindings.mockResolvedValue([])
    api.deleteFeishuAccount.mockRejectedValue(new Error('删除失败'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    await wrapper.find('.danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('删除失败')
    expect(wrapper.text()).toContain('Bot kept')
  })

  it('surfaces diagnostics failures instead of leaving stale metrics visible', async () => {
    api.listFeishuAccounts.mockResolvedValue([account('diagnostics')])
    api.feishuDiagnostics.mockRejectedValue(new Error('诊断读取失败'))
    api.listFeishuBindings.mockResolvedValue([])
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    expect(wrapper.text()).toContain('诊断读取失败')
    expect(wrapper.find('.metrics').exists()).toBe(false)
  })

  it('automatically converges a transient connection state without requiring a page refresh', async () => {
    vi.useFakeTimers()
    const connecting = { ...account('live', true), connectionState: 'connecting' }
    const connected = { ...account('live', true), connectionState: 'connected', connectedAt: '2026-09-05T00:00:00.000Z' }
    api.listFeishuAccounts.mockResolvedValueOnce([connecting]).mockResolvedValue([connected])
    api.feishuDiagnostics.mockResolvedValue({ ...diagnostics('live'), account: connected })
    api.listFeishuBindings.mockResolvedValue([])
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()
    expect(wrapper.text()).toContain('连接中')

    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()

    expect(wrapper.text()).toContain('已连接')
    wrapper.unmount()
  })

  it('shows durable delivery failures and retries them explicitly', async () => {
    api.listFeishuAccounts.mockResolvedValue([account('failed', true)])
    api.feishuDiagnostics.mockResolvedValue({
      ...diagnostics('failed'),
      outbox: { pending: 1, deadLetter: 1, failures: [{ id: 'outbox-1', kind: 'send_card', targetId: 'chat-1', status: 'dead_letter', attempts: 5, lastError: 'request failed', updatedAt: '2026-09-05T00:00:00.000Z' }] },
    })
    api.listFeishuBindings.mockResolvedValue([])
    api.retryFeishuOutbox.mockResolvedValue(undefined)
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    expect(wrapper.text()).toContain('request failed')
    await wrapper.findAll('button').find(button => button.text() === '立即重试')!.trigger('click')
    await flushPromises()

    expect(api.retryFeishuOutbox).toHaveBeenCalledWith('failed', 'outbox-1')
  })
})
