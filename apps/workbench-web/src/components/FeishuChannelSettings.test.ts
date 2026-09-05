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
  return { id, provider: 'feishu', name: `Bot ${id}`, appId: `cli_${id}`, appSecretConfigured: true, domain: 'feishu', enabled, allowAllUsers: false, allowedUserIds: ['ou_test'], allowedConversationIds: [], groupMentionMode: 'always', privateConversationMode: 'chat', botOpenId: '', botName: '', connectionState: enabled ? 'connected' : 'idle', lastError: '', lastCloseCode: null, lastCloseReason: '', lastDisconnectedAt: null, reconnectAttempts: 0, nextReconnectAt: null, connectedAt: null, lastEventAt: null, lastDeliveryAt: null, createdAt: '', updatedAt: '' }
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

  it('does not claim that every enabled configuration save restarts the connection', async () => {
    const connected = account('live', true)
    api.listFeishuAccounts.mockResolvedValue([connected])
    api.feishuDiagnostics.mockResolvedValue(diagnostics('live'))
    api.listFeishuBindings.mockResolvedValue([])
    api.updateFeishuAccount.mockResolvedValue(connected)
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.updateFeishuAccount).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('配置已保存。长连接状态请以运行诊断为准。')
    expect(wrapper.text()).not.toContain('长连接正在建立')
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

  it('shows an unavailable SDK close code honestly instead of fabricating one', async () => {
    const disconnected = {
      ...account('reconnecting', true), connectionState: 'reconnecting', reconnectAttempts: 2,
      lastDisconnectedAt: '2026-09-05T01:00:00.000Z', lastCloseReason: 'SDK 正在自动重连', nextReconnectAt: '2026-09-05T01:00:10.000Z',
    }
    api.listFeishuAccounts.mockResolvedValue([disconnected])
    api.feishuDiagnostics.mockResolvedValue({ ...diagnostics('reconnecting'), account: disconnected })
    api.listFeishuBindings.mockResolvedValue([])
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    expect(wrapper.text()).toContain('关闭码 SDK 未提供')
    expect(wrapper.text()).toContain('SDK 正在自动重连')
    wrapper.unmount()
  })

  it('shows the CodyWork conversation title for each Feishu binding', async () => {
    api.listFeishuAccounts.mockResolvedValue([account('bound', true)])
    api.feishuDiagnostics.mockResolvedValue(diagnostics('bound'))
    api.listFeishuBindings.mockResolvedValue([{
      id: 'binding-1', accountId: 'bound', conversationKey: 'feishu:bound:private:chat:', workspaceId: 'workspace-1',
      targetType: 'codywork-workspace', demandId: null, conversationId: 'conversation-1', conversationTitle: '成本归属排查',
      threadId: '019ff043-116d-7500-b0be-c801978bf975', ownerIdentity: 'ou_test', channelConversationId: 'oc_test', channelScope: 'private', updatedAtIso: '',
    }])
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    await wrapper.find('details').trigger('toggle')
    expect(wrapper.text()).toContain('成本归属排查')
    expect(wrapper.text()).toContain('Workspace 只读搜索')
  })

  it('creates a second bot from a persistent new-bot action without changing the existing one', async () => {
    const first = account('first')
    const second = { ...account('second'), name: 'Second Bot' }
    api.listFeishuAccounts.mockResolvedValueOnce([first]).mockResolvedValue([first, second])
    api.feishuDiagnostics.mockImplementation((id: string) => Promise.resolve(diagnostics(id)))
    api.listFeishuBindings.mockResolvedValue([])
    api.createFeishuAccount.mockResolvedValue(second)
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text().includes('新建机器人'))!.trigger('click')
    expect(wrapper.text()).toContain('新配置 · 尚未保存')
    expect(wrapper.find('button[type="submit"]').text()).toBe('创建机器人')
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('Second Bot')
    await inputs[1]!.setValue('cli_second')
    await inputs[2]!.setValue('second-secret')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.createFeishuAccount).toHaveBeenCalledWith(expect.objectContaining({ name: 'Second Bot', appId: 'cli_second', appSecret: 'second-secret', enabled: false }))
    expect(wrapper.findAll('.account-row')).toHaveLength(2)
    expect(wrapper.text()).toContain('Bot first')
    expect(wrapper.text()).toContain('Second Bot')
  })

  it('cancels a new bot draft and restores the previous selection', async () => {
    api.listFeishuAccounts.mockResolvedValue([account('first'), account('second')])
    api.feishuDiagnostics.mockImplementation((id: string) => Promise.resolve(diagnostics(id)))
    api.listFeishuBindings.mockResolvedValue([])
    const wrapper = mount(FeishuChannelSettings)
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text().includes('新建机器人'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('新配置 · 尚未保存')
    expect(wrapper.find('input[placeholder="例如：CodyWork Bot"]').element).toHaveProperty('value', 'Bot first')
    expect(api.createFeishuAccount).not.toHaveBeenCalled()
  })
})
