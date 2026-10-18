// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import type { FollowupTask } from '../followups'
import FollowupSettings from './FollowupSettings.vue'

vi.mock('../api', () => ({ api: {
  listFollowups: vi.fn(), createFollowup: vi.fn(), updateFollowup: vi.fn(), followupAction: vi.fn(), followupRuns: vi.fn(), listFeishuAccounts: vi.fn(), smartNotificationSettings: vi.fn(),
} }))
const task: FollowupTask = { id: 't1', workspaceId: 'w1', demandId: 'd1', conversationId: 'c1', name: '检查构建', prompt: '检查最新构建', completionCondition: '构建成功', deadlineAt: '2099-12-01T12:00:00.000Z', intervalMinutes: 15, notification: { mode: 'change', accountId: 'a1', recipientOpenId: 'ou_test' }, revision: 4, status: 'active' }
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(item => item.text() === text)!
async function setup(items: FollowupTask[] = []) {
  vi.mocked(api.listFollowups).mockResolvedValue({ items })
  const wrapper = mount(FollowupSettings, { props: { workspaceId: 'w1', originConversationId: 'c1' } })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  window.history.replaceState({}, '', '/')
  vi.resetAllMocks()
  vi.mocked(api.followupRuns).mockResolvedValue({ items: [] })
  vi.mocked(api.listFeishuAccounts).mockResolvedValue([{ id: 'a1', enabled: true, name: 'Test bot', botName: 'Test bot' }] as Awaited<ReturnType<typeof api.listFeishuAccounts>>)
  vi.mocked(api.smartNotificationSettings).mockResolvedValue({ accountId: 'a1', recipientOpenId: 'ou_test' } as Awaited<ReturnType<typeof api.smartNotificationSettings>>)
})
describe('FollowupSettings', () => {
  it.each(['failed', 'dead_letter', 'retry_wait'].flatMap(deliveryStatus =>
    ['completed', 'pending', 'failed', 'needs_attention'].map(runStatus => ({ deliveryStatus, runStatus })),
  ))('retries $deliveryStatus delivery for a $runStatus run without executing again', async ({ deliveryStatus, runStatus }) => {
    const taskStatus = runStatus === 'pending' ? 'active' : 'completed'
    const wrapper = await setup([{ ...task, status: taskStatus, revision: 9, lastRun: { id: 'r1', phase: 'finished', outboxId: 'outbox-1' } }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [{ id: 'r1', status: runStatus, startedAt: '2026-10-18T00:00:00Z', deliveryStatus, outboxId: 'outbox-1' }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    expect(wrapper.get('fieldset').attributes('disabled') !== undefined).toBe(taskStatus === 'completed')
    await button(wrapper, '重试通知（不重新检查）').trigger('click'); await flushPromises()
    expect(api.followupAction).toHaveBeenCalledExactlyOnceWith('w1', 't1', 'retry-notification', 9)
    expect(api.updateFollowup).not.toHaveBeenCalled()
    expect(api.createFollowup).not.toHaveBeenCalled()
  })
  it.each(['failed', 'dead_letter', 'retry_wait'])('allows %s notification retry after task expiry', async deliveryStatus => {
    const wrapper = await setup([{ ...task, status: 'expired', revision: 12, lastRun: { id: 'expiry-run', phase: 'finished', outboxId: 'expiry-outbox' } }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [{ id: 'expiry-run', status: 'failed', startedAt: '2026-10-18T00:00:00Z', deliveryStatus, outboxId: 'expiry-outbox' }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    await button(wrapper, '重试通知（不重新检查）').trigger('click'); await flushPromises()
    expect(api.followupAction).toHaveBeenCalledExactlyOnceWith('w1', 't1', 'retry-notification', 12)
  })
  it.each(['pending', 'sent', 'delivered', 'not_requested'])('does not offer retry for %s delivery', async deliveryStatus => {
    const wrapper = await setup([{ ...task, status: 'completed' }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [{ id: 'r1', status: 'completed', startedAt: '2026-10-18T00:00:00Z', deliveryStatus }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    expect(button(wrapper, '重试通知（不重新检查）')).toBeUndefined()
  })
  it('retries an interrupted notification on needs_attention with the latest revision', async () => {
    const wrapper = await setup([{ ...task, status: 'needs_attention', revision: 8, lastRun: { id: 'r1', phase: 'interrupted', result: { status: 'pending' }, outboxId: null } }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [{ id: 'r1', status: 'pending', phase: 'interrupted', result: { status: 'pending' }, startedAt: '2026-10-18T00:00:00Z', deliveryStatus: 'needs_attention' }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    await button(wrapper, '重试通知（不重新检查）').trigger('click'); await flushPromises()
    expect(api.followupAction).toHaveBeenCalledExactlyOnceWith('w1', 't1', 'retry-notification', 8)
  })
  it('blocks duplicate retries and refreshes delivery and revision after retry admission', async () => {
    const wrapper = await setup([{ ...task, status: 'completed', lastRun: { id: 'r1', phase: 'finished' } }])
    const run = { id: 'r1', status: 'completed', startedAt: '2026-10-18T00:00:00Z', deliveryStatus: 'failed' }
    vi.mocked(api.followupRuns).mockResolvedValueOnce({ items: [run] }).mockResolvedValue({ items: [{ ...run, deliveryStatus: 'pending' }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    let resolve!: (value: unknown) => void
    vi.mocked(api.followupAction).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const retry = button(wrapper, '重试通知（不重新检查）')
    await retry.trigger('click'); await retry.trigger('click')
    expect(api.followupAction).toHaveBeenCalledExactlyOnceWith('w1', 't1', 'retry-notification', 4)
    expect(retry.attributes()).toHaveProperty('disabled')
    vi.mocked(api.listFollowups).mockResolvedValue({ items: [{ ...task, status: 'completed', revision: 5, lastRun: { id: 'r1', phase: 'finished' } }] })
    resolve({}); await flushPromises()
    expect(wrapper.text()).toContain('v5')
    expect(wrapper.get('.run').text()).toContain('投递：pending')
    expect(button(wrapper, '重试通知（不重新检查）')).toBeUndefined()
  })
  it('never offers retry for an interrupted execution or an older failed delivery', async () => {
    const wrapper = await setup([{ ...task, status: 'needs_attention', lastRun: { id: 'current', phase: 'interrupted', result: null } }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [
      { id: 'current', status: 'interrupted', phase: 'interrupted', result: null, startedAt: '2026-10-18T00:00:00Z', deliveryStatus: 'needs_attention' },
      { id: 'old', status: 'completed', startedAt: '2026-10-17T00:00:00Z', deliveryStatus: 'failed' },
    ] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    expect(button(wrapper, '重试通知（不重新检查）')).toBeUndefined()
    expect(api.followupAction).not.toHaveBeenCalled()
  })
  it.each(['paused', 'cancelled'] as const)('does not retry notifications for %s tasks', async status => {
    const wrapper = await setup([{ ...task, status }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [{ id: 'r1', status: 'completed', startedAt: '2026-10-18T00:00:00Z', deliveryStatus: 'failed' }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    expect(button(wrapper, '重试通知（不重新检查）')).toBeUndefined()
  })
  it('allows editing and resuming tasks needing attention despite a transient failed run', async () => {
    const wrapper = await setup([{ ...task, status: 'needs_attention', revision: 7 }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [{ id: 'r-failed', status: 'failed', startedAt: '2026-10-18T00:00:00Z', error: '临时运行失败', deliveryStatus: 'skipped' }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    expect(wrapper.get('.task-row').text()).toContain('待人工处理')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.run').text()).toContain('临时运行失败')
    expect(button(wrapper, '立即运行')).toBeUndefined()
    await button(wrapper, '恢复').trigger('click'); await flushPromises()
    expect(api.followupAction).toHaveBeenCalledWith('w1', 't1', 'resume', 7)
  })
  it('links source and background conversations with workspace and demand context', async () => {
    window.history.replaceState({}, '', '/?workspace=old&demand=old&conversation=old&view=settings&settings=followups')
    const wrapper = await setup([{ ...task, conversationId: 'source/&id', demandId: 'demand/&id', backgroundConversationId: 'background/&id' }])
    await wrapper.get('.task-row').trigger('click')
    const links = wrapper.get('[aria-label="跟进关联会话"]').findAll('a')
    expect(links.map(link => link.text())).toEqual(['打开原始会话', '查看后台跟进历史'])
    for (const [index, conversationId] of ['source/&id', 'background/&id'].entries()) {
      const url = new URL(links[index]!.attributes('href')!)
      expect(url.searchParams.get('workspace')).toBe('w1')
      expect(url.searchParams.get('demand')).toBe('demand/&id')
      expect(url.searchParams.get('conversation')).toBe(conversationId)
      expect(url.searchParams.has('view')).toBe(false)
      expect(url.searchParams.has('settings')).toBe(false)
    }
  })
  it('links workspace conversation history without stale demand context and handles missing history', async () => {
    window.history.replaceState({}, '', '/?workspace=old&demand=old&conversation=old&view=settings&settings=followups')
    const wrapper = await setup([{ ...task, demandId: null, backgroundConversationId: null }])
    await wrapper.get('.task-row').trigger('click')
    const nav = wrapper.get('[aria-label="跟进关联会话"]')
    expect(nav.findAll('a')).toHaveLength(1)
    expect(nav.text()).toContain('后台会话尚未创建')
    const url = new URL(nav.get('a').attributes('href')!)
    expect(url.searchParams.get('workspace')).toBe('w1')
    expect(url.searchParams.get('conversation')).toBe('c1')
    expect(url.searchParams.has('demand')).toBe(false)
    expect(url.searchParams.has('settings')).toBe(false)
    expect(url.searchParams.has('view')).toBe(false)
    vi.mocked(api.listFollowups).mockResolvedValue({ items: [{ ...task, demandId: null, backgroundConversationId: 'background-ws' }] })
    await button(wrapper, '刷新列表').trigger('click'); await flushPromises()
    const backgroundUrl = new URL(wrapper.get('[aria-label="跟进关联会话"]').findAll('a')[1]!.attributes('href')!)
    expect(backgroundUrl.searchParams.get('conversation')).toBe('background-ws')
    expect(backgroundUrl.searchParams.has('demand')).toBe(false)
  })
  it('prefills source, selects notification defaults and creates a workspace-scoped task', async () => {
    const wrapper = await setup()
    expect(wrapper.get('[name=conversationId]').element).toHaveProperty('value', 'c1')
    await wrapper.get('[name=name]').setValue('检查构建')
    await wrapper.get('[name=prompt]').setValue('检查最新构建')
    await wrapper.get('[name=completionCondition]').setValue('构建成功')
    await wrapper.get('[name=deadline]').setValue('2099-12-01T20:00')
    await wrapper.get('[name=intervalMinutes]').setValue(15)
    await button(wrapper, '使用智能通知默认设置').trigger('click')
    await wrapper.get('[name=notificationMode]').setValue('terminal')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.createFollowup).toHaveBeenCalledWith('w1', expect.objectContaining({ conversationId: 'c1', name: '检查构建', intervalMinutes: 15, deadlineAt: new Date('2099-12-01T20:00').toISOString(), notification: { mode: 'terminal', accountId: 'a1', recipientOpenId: 'ou_test' } }))
  })
  it('validates required fields, integer interval and future deadline without requests', async () => {
    const wrapper = await setup([task])
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('必填')
    await wrapper.get('.task-row').trigger('click')
    await wrapper.get('[name=intervalMinutes]').setValue(1.5)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('正整数')
    await wrapper.get('[name=intervalMinutes]').setValue(15)
    await wrapper.get('[name=deadline]').setValue('2000-01-01T12:00')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('晚于')
    expect(api.createFollowup).not.toHaveBeenCalled()
    expect(api.updateFollowup).not.toHaveBeenCalled()
  })
  it('edits with expectedRevision and preserves the draft on conflict', async () => {
    const wrapper = await setup([task])
    await wrapper.get('.task-row').trigger('click')
    await wrapper.get('[name=name]').setValue('新名字')
    vi.mocked(api.updateFollowup).mockRejectedValue(new Error('revision conflict'))
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.updateFollowup).toHaveBeenCalledWith('w1', 't1', expect.objectContaining({ name: '新名字', expectedRevision: 4 }))
    expect(wrapper.get('[role=alert]').text()).toContain('刷新列表')
    expect(wrapper.get('[name=name]').element).toHaveProperty('value', '新名字')
  })
  it('pauses, resumes, runs now and confirms cancellation with revisions', async () => {
    const wrapper = await setup([task])
    await wrapper.get('.task-row').trigger('click')
    for (const [label, action] of [['暂停', 'pause'], ['立即运行', 'run-now']]) {
      await button(wrapper, label!).trigger('click'); await flushPromises()
      expect(api.followupAction).toHaveBeenLastCalledWith('w1', 't1', action, 4)
    }
    await button(wrapper, '取消任务').trigger('click')
    expect(api.followupAction).toHaveBeenCalledTimes(2)
    await button(wrapper, '确认取消任务').trigger('click'); await flushPromises()
    expect(api.followupAction).toHaveBeenLastCalledWith('w1', 't1', 'cancel', 4)
    vi.mocked(api.listFollowups).mockResolvedValue({ items: [{ ...task, status: 'paused', revision: 5 }] })
    await button(wrapper, '刷新列表').trigger('click'); await flushPromises()
    await button(wrapper, '恢复').trigger('click'); await flushPromises()
    expect(api.followupAction).toHaveBeenLastCalledWith('w1', 't1', 'resume', 5)
  })
  it('shows run and delivery failures independently and makes terminal tasks read-only', async () => {
    const wrapper = await setup([{ ...task, status: 'completed' }])
    vi.mocked(api.followupRuns).mockResolvedValue({ items: [{ id: 'r1', status: 'completed', startedAt: '2026-10-18T00:00:00Z', summary: '构建成功', deliveryStatus: 'failed', deliveryError: '接收人不可用' }] })
    await wrapper.get('.task-row').trigger('click'); await flushPromises()
    expect(wrapper.get('.run').text()).toContain('构建成功')
    expect(wrapper.get('.run').text()).toContain('接收人不可用')
    expect(wrapper.get('fieldset').attributes()).toHaveProperty('disabled')
    expect(button(wrapper, '取消任务')).toBeUndefined()
  })
  it('discards late workspace responses and clears source drafts on workspace change', async () => {
    let resolve!: (value: { items: FollowupTask[] }) => void
    vi.mocked(api.listFollowups).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const wrapper = mount(FollowupSettings, { props: { workspaceId: 'w1', originConversationId: 'c1' } })
    vi.mocked(api.listFollowups).mockResolvedValue({ items: [] })
    await wrapper.setProps({ workspaceId: 'w2', originConversationId: '' }); await flushPromises()
    resolve({ items: [task] }); await flushPromises()
    expect(wrapper.findAll('.task-row')).toHaveLength(0)
    expect(wrapper.get('[name=conversationId]').element).toHaveProperty('value', '')
  })
  it('keeps late run responses out of another task and exposes run loading failures', async () => {
    const wrapper = await setup([task, { ...task, id: 't2', name: '另一个任务' }])
    let resolve!: (value: { items: [] }) => void
    vi.mocked(api.followupRuns).mockReturnValueOnce(new Promise(done => { resolve = done }))
    await wrapper.findAll('.task-row')[0]!.trigger('click')
    vi.mocked(api.followupRuns).mockRejectedValueOnce(new Error('记录暂时不可用'))
    await wrapper.findAll('.task-row')[1]!.trigger('click'); await flushPromises()
    resolve({ items: [] }); await flushPromises()
    expect(wrapper.get('[aria-label="运行记录"] [role=alert]').text()).toContain('记录暂时不可用')
    expect(api.followupRuns).toHaveBeenLastCalledWith('w1', 't2')
  })
  it('shows list failures and allows retry without inventing task data', async () => {
    vi.mocked(api.listFollowups).mockRejectedValueOnce(new Error('服务尚未可用'))
    const wrapper = mount(FollowupSettings, { props: { workspaceId: 'w1' } })
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('服务尚未可用')
    vi.mocked(api.listFollowups).mockResolvedValue({ items: [task] })
    await button(wrapper, '刷新列表').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.task-row')).toHaveLength(1)
  })
})
