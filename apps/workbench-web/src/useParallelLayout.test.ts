// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { api, type ParallelView } from './api'
import { useParallelLayout } from './useParallelLayout'

vi.mock('./api', () => ({ api: { getParallelView: vi.fn(), saveParallelView: vi.fn() } }))
const initial: ParallelView = { layout: 'columns', panels: [], revision: 0 }
let wrapper: ReturnType<typeof mount>, layout: ReturnType<typeof useParallelLayout>
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.getParallelView).mockResolvedValue(structuredClone(initial)) })
afterEach(() => wrapper?.unmount())
async function start() { wrapper = mount(defineComponent({ setup() { layout = useParallelLayout('w1'); void layout.load(); return () => null } })); await flushPromises() }
describe('parallel layout persistence', () => {
  it('serializes quick edits and preserves a newer selection when an old acknowledgement arrives', async () => {
    await start()
    let acknowledge!: (view: ParallelView) => void
    vi.mocked(api.saveParallelView).mockReturnValueOnce(new Promise(resolve => { acknowledge = resolve }))
    vi.mocked(api.saveParallelView).mockImplementationOnce(async (_workspace, input) => ({ ...input, revision: input.revision + 1 }))
    layout.update({ layout: 'columns', panels: [{ demandId: 'd1', conversationId: 'c1' }] })
    layout.update({ layout: 'grid', panels: [{ demandId: 'd1', conversationId: 'c2' }] })
    acknowledge({ layout: 'columns', panels: [{ demandId: 'd1', conversationId: 'c1' }], revision: 1 })
    await flushPromises()
    expect(api.saveParallelView).toHaveBeenLastCalledWith('w1', { layout: 'grid', panels: [{ demandId: 'd1', conversationId: 'c2' }], revision: 1 })
    expect(layout.view.value).toEqual({ layout: 'grid', panels: [{ demandId: 'd1', conversationId: 'c2' }], revision: 2 })
    expect(layout.dirty.value).toBe(false)
  })
  it('keeps failed edits visibly unsaved, retries explicitly and can reload a conflicting server view', async () => {
    await start()
    vi.mocked(api.saveParallelView).mockRejectedValueOnce(new Error('视图已在其他页面更新'))
    layout.update({ layout: 'grid', panels: [] }); await flushPromises()
    expect(layout.error.value).toContain('其他页面更新'); expect(layout.dirty.value).toBe(true)
    vi.mocked(api.getParallelView).mockResolvedValue({ layout: 'columns', panels: [], revision: 3 })
    await layout.load()
    expect(layout.dirty.value).toBe(false); expect(layout.view.value.revision).toBe(3)
    vi.mocked(api.saveParallelView).mockResolvedValue({ layout: 'grid', panels: [], revision: 4 })
    layout.update({ layout: 'grid', panels: [] }); await flushPromises()
    expect(layout.error.value).toBe(''); expect(layout.view.value.revision).toBe(4)
  })
  it('ignores delayed loads and write acknowledgements after leaving the workspace', async () => {
    let resolve!: (view: ParallelView) => void
    vi.mocked(api.getParallelView).mockReturnValueOnce(new Promise(done => { resolve = done }))
    await start(); wrapper.unmount()
    resolve({ layout: 'grid', panels: [{ demandId: 'other', conversationId: 'other-c' }], revision: 4 }); await flushPromises()
    expect(layout.view.value.panels).toEqual([])
  })
})
