// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { usePanelReorder } from './usePanelReorder'

let wrapper: ReturnType<typeof mount>, controls: ReturnType<typeof usePanelReorder>
let hit: Element | null, root: HTMLElement
const order = ref(['a', 'b', 'c']), move = vi.fn(), raf = vi.fn((_callback: FrameRequestCallback) => 1), cancelFrame = vi.fn()
function pointer(target: EventTarget, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } })
  target.dispatchEvent(event)
}
beforeEach(() => {
  vi.clearAllMocks(); order.value = ['a', 'b', 'c']; hit = null
  vi.stubGlobal('requestAnimationFrame', raf); vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => hit ? [hit] : []) })
  wrapper = mount(defineComponent({ setup() {
    const board = ref<HTMLElement | null>(null)
    controls = usePanelReorder(board, () => order.value, move)
    return () => h('div', { ref: board }, order.value.map(id => h('article', { key: id, 'data-demand-id': id }, [h('button', { onPointerdown: (event: PointerEvent) => controls.begin(id, event) }, id)])))
  } }), { attachTo: document.body })
  root = wrapper.element as HTMLElement
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 200 } as DOMRect)
})
afterEach(() => { wrapper.unmount(); vi.unstubAllGlobals() })
function startDrag() {
  pointer(wrapper.get('button').element, 'pointerdown', 10, 10)
  hit = wrapper.get('[data-demand-id="c"]').element
  pointer(window, 'pointermove', 120, 90)
}
describe('panel pointer sorting', () => {
  it('ignores a click/tiny movement, then commits once on a matching pointer release', () => {
    pointer(wrapper.get('button').element, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 12, 11); pointer(window, 'pointerup', 12, 11)
    expect(move).not.toHaveBeenCalled()
    startDrag()
    expect(controls.dragging.value).toBe('a'); expect(controls.over.value).toBe('c')
    expect(move).not.toHaveBeenCalled()
    pointer(window, 'pointerup', 120, 90, 2)
    expect(move).not.toHaveBeenCalled()
    pointer(window, 'pointerup', 120, 90)
    expect(move).toHaveBeenCalledExactlyOnceWith('a', 'c')
    expect(controls.dragging.value).toBe(''); expect(cancelFrame).toHaveBeenCalled()
    pointer(window, 'pointerup', 120, 90)
    expect(move).toHaveBeenCalledTimes(1)
  })
  it.each(['Escape', 'pointercancel', 'outside', 'blur'])('cancels on %s without changing saved order', kind => {
    startDrag()
    if (kind === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    else if (kind === 'blur') window.dispatchEvent(new Event('blur'))
    else if (kind === 'pointercancel') pointer(window, 'pointercancel', 120, 90)
    else { hit = null; pointer(window, 'pointerup', 400, 400) }
    expect(controls.dragging.value).toBe(''); expect(move).not.toHaveBeenCalled()
  })
  it('scrolls the board near its edge and releases listeners/animation on disposal', () => {
    startDrag(); pointer(window, 'pointermove', 100, 198)
    const tick = raf.mock.calls.at(-1)![0] as FrameRequestCallback
    tick(16)
    expect(root.scrollTop).toBe(16)
    wrapper.unmount()
    expect(cancelFrame).toHaveBeenCalled()
    pointer(window, 'pointerup', 100, 198)
    expect(move).not.toHaveBeenCalled()
  })
  it('cancels when the source panel is removed by another layout update', async () => {
    startDrag(); order.value = ['b', 'c']; await flushPromises()
    expect(controls.dragging.value).toBe('')
    pointer(window, 'pointerup', 120, 90)
    expect(move).not.toHaveBeenCalled()
  })
})
