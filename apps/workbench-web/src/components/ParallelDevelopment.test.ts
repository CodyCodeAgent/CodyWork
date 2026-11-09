// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import { api, type Demand, type ParallelView, type Workspace } from '../api'
import ParallelDevelopment from './ParallelDevelopment.vue'

vi.mock('../api', () => ({ api: { getParallelView: vi.fn(), saveParallelView: vi.fn(), runtimeSettings: vi.fn() } }))
const mounted = vi.fn(), disposed = vi.fn()
const Panel = defineComponent({ props: ['demand'], emits: ['move'], setup(props, { emit }) {
  const draft = ref('')
  onMounted(() => mounted(props.demand.id)); onUnmounted(() => disposed(props.demand.id))
  return () => h('article', { 'data-demand-id': props.demand.id }, [h('input', { value: draft.value, onInput: (event: Event) => { draft.value = (event.target as HTMLInputElement).value } }), h('button', { 'aria-label': `move-${props.demand.id}`, onClick: () => emit('move', 1) }, 'move')])
} })
const panels = ['a', 'b', 'c'].map(id => ({ demandId: id, conversationId: `session-${id}` }))
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  vi.mocked(api.runtimeSettings).mockResolvedValue({ runtimes: [] } as unknown as Awaited<ReturnType<typeof api.runtimeSettings>>)
  vi.mocked(api.saveParallelView).mockImplementation(async (_workspace, input) => ({ ...input, revision: input.revision + 1 }))
})
afterEach(() => wrapper?.unmount())
describe('parallel panel identity while sorting', () => {
  it.each<ParallelView['layout']>(['columns', 'three-columns', 'grid'])('moves real session bindings and mounted draft state together in %s', async layout => {
    vi.mocked(api.getParallelView).mockResolvedValue({ layout, panels, revision: 5 })
    wrapper = mount(ParallelDevelopment, { props: { workspace: { id: 'w1' } as Workspace, demands: ['a', 'b', 'c'].map(id => ({ id, name: id, branchName: id })) as Demand[] }, global: { stubs: { ParallelDemandPanel: Panel } } })
    await flushPromises()
    const input = wrapper.get('[data-demand-id="a"] input').element
    await wrapper.get('[data-demand-id="a"] input').setValue('keep-running-session-draft')
    await wrapper.get('button[aria-label="move-a"]').trigger('click'); await flushPromises()
    expect(wrapper.findAll('[data-demand-id]').map(item => item.attributes('data-demand-id'))).toEqual(['b', 'a', 'c'])
    expect(wrapper.get('[data-demand-id="a"] input').element).toBe(input)
    expect((input as HTMLInputElement).value).toBe('keep-running-session-draft')
    expect(mounted).toHaveBeenCalledTimes(3); expect(disposed).not.toHaveBeenCalled()
    expect(api.saveParallelView).toHaveBeenCalledExactlyOnceWith('w1', { layout, panels: [panels[1], panels[0], panels[2]], revision: 5 })
  })
})
