// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { api, type Conversation, type Demand } from '../api'
import ParallelDemandPanel from './ParallelDemandPanel.vue'

vi.mock('../api', () => ({ api: { listConversations: vi.fn(), createConversation: vi.fn() } }))
const session = (id: string, demandId = 'd1'): Conversation => ({ id, scope: 'demand', demandId, nativeId: `native-${id}`, title: id, status: 'idle', runtimeType: 'codex', createdVia: 'browser', permissionMode: 'workspace-write', policyHash: '', instructionHash: '', createdAt: '', updatedAt: '' })
const demand = { id: 'd1', name: '第一需求', branchName: 'feature' } as Demand
let wrapper: ReturnType<typeof mount>
const Session = defineComponent({ props: ['conversation'], setup(props) { const draft = ref(''); return () => h('input', { 'aria-label': `草稿${props.conversation.id}`, value: draft.value, onInput: (event: Event) => { draft.value = (event.target as HTMLInputElement).value } }) } })
beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  vi.mocked(api.listConversations).mockResolvedValue([session('a'), session('b'), session('wrong', 'other')])
})
afterEach(() => wrapper?.unmount())
async function start() { wrapper = mount(ParallelDemandPanel, { props: { workspaceId: 'w1', demand, conversationId: 'a', active: true, expanded: false, runtimes: [{ id: 'codex', label: 'Codex' }] }, global: { stubs: { DemandConversationSession: Session } } }); await flushPromises() }
describe('real demand session panel', () => {
  it('offers bounded keyboard reordering without changing the selected session or draft', async () => {
    await start()
    await wrapper.setProps({ canMoveEarlier: false, canMoveLater: true })
    await wrapper.get('input[aria-label="草稿a"]').setValue('keep-current-session')
    await wrapper.get('.parallel-drag-handle').trigger('keydown', { key: 'ArrowRight', altKey: true })
    await wrapper.get('.parallel-drag-handle').trigger('keydown', { key: 'ArrowLeft', altKey: true })
    expect(wrapper.emitted('move')).toEqual([[1]])
    expect((wrapper.get('input[aria-label="草稿a"]').element as HTMLInputElement).value).toBe('keep-current-session')
    expect(wrapper.emitted('select')).toBeUndefined()
  })
  it('lists only sessions from this demand and retains each visited session instance when switching', async () => {
    await start()
    expect(wrapper.findAll('.parallel-panel-session-row select option').map(item => item.text())).toEqual(['a · 就绪', 'b · 就绪'])
    await wrapper.get('input[aria-label="草稿a"]').setValue('draft-a')
    await wrapper.get('.parallel-panel-session-row select').setValue('b')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['b'])
    await wrapper.setProps({ conversationId: 'b' }); await flushPromises()
    await wrapper.get('input[aria-label="草稿b"]').setValue('draft-b')
    await wrapper.setProps({ conversationId: 'a' }); await flushPromises()
    expect((wrapper.get('input[aria-label="草稿a"]').element as HTMLInputElement).value).toBe('draft-a')
    expect((wrapper.get('input[aria-label="草稿b"]').element as HTMLInputElement).value).toBe('draft-b')
    expect(api.createConversation).not.toHaveBeenCalled()
  })
  it('does not mount late data after the workspace panel was removed', async () => {
    let finish!: (items: Conversation[]) => void
    vi.mocked(api.listConversations).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await start(); wrapper.unmount()
    finish([session('late')]); await flushPromises()
    expect(wrapper.emitted('select')).toBeUndefined()
  })
  it('retains a newly created session when an older metadata refresh returns afterwards', async () => {
    await start()
    let finish!: (items: Conversation[]) => void
    vi.mocked(api.listConversations).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await wrapper.get('.parallel-panel-session-row select').trigger('focus')
    vi.mocked(api.createConversation).mockResolvedValue(session('created'))
    await wrapper.get('.parallel-new-session').trigger('click')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    await wrapper.setProps({ conversationId: 'created' })
    finish([session('a'), session('b')]); await flushPromises()
    expect(wrapper.findAll('.parallel-panel-session-row select option').map(item => item.attributes('value'))).toContain('created')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['created'])
  })
})
