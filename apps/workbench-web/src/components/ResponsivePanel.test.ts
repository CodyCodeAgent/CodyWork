// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ResponsivePanel from './ResponsivePanel.vue'
import { defineComponent, nextTick, ref } from 'vue'
import { vModalFocus } from '../modalFocus'

let mobile = false
let change: ((event: MediaQueryListEvent) => void) | undefined
let wrapper: ReturnType<typeof mount> | undefined
const removeListener = vi.fn()
const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); this.querySelector<HTMLElement>('[autofocus]')?.focus() })
const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })

beforeEach(() => {
  mobile = false
  change = undefined
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: mobile, addEventListener: (_type: string, callback: typeof change) => { change = callback }, removeEventListener: removeListener })))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals() })
async function render(open = false) {
  wrapper = mount(ResponsivePanel, { props: { open, title: '工作台导航' }, slots: { default: '<aside><button>工作区</button></aside>' }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('ResponsivePanel', () => {
  it('hands focus to a sibling modal and restores the visible drawer trigger after dismissal', async () => {
    mobile = true
    wrapper = mount(defineComponent({
      components: { ResponsivePanel }, directives: { modalFocus: vModalFocus },
      setup() { return { drawer: ref(false), modal: ref(false) } },
      template: `<button id="drawer-trigger" @click="drawer = true">Actions</button>
        <ResponsivePanel v-model:open="drawer" title="Actions"><button id="share" @click="drawer = false; modal = true">Share</button></ResponsivePanel>
        <section v-if="modal" id="share-modal" v-modal-focus="() => { modal = false }" role="dialog">Share dialog</section>`,
    }), { attachTo: document.body })
    ;(wrapper.get('#drawer-trigger').element as HTMLElement).focus()
    await wrapper.get('#drawer-trigger').trigger('click'); await flushPromises()
    ;(wrapper.get('#share').element as HTMLElement).focus()
    await wrapper.get('#share').trigger('click'); await flushPromises()
    expect(wrapper.get('dialog').attributes('open')).toBeUndefined()
    expect(document.activeElement?.id).toBe('share-modal')
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick(); await nextTick()
    expect(document.activeElement?.id).toBe('drawer-trigger')
  })
  it('renders the desktop slot without a layout wrapper or modal', async () => {
    const panel = await render()
    expect(panel.find('dialog').exists()).toBe(false)
    expect(panel.html().trim().startsWith('<aside>')).toBe(true)
    expect(showModal).not.toHaveBeenCalled()
  })
  it('keeps the mobile drawer closed until requested, with an accessible title', async () => {
    mobile = true
    const panel = await render()
    expect(panel.get('dialog').attributes('open')).toBeUndefined()
    await panel.setProps({ open: true }); await flushPromises()
    expect(showModal).toHaveBeenCalledOnce()
    expect(panel.get('dialog').attributes('open')).toBe('')
    expect(panel.get('dialog').attributes('aria-labelledby')).toBe(panel.get('h2').attributes('id'))
  })
  it('closes via its accessible close button and restores the triggering focus', async () => {
    mobile = true
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    const panel = await render(true)
    await panel.get('button[aria-label="关闭工作台导航"]').trigger('click')
    expect(close).toHaveBeenCalledOnce()
    expect(panel.emitted('update:open')?.at(-1)).toEqual([false])
    expect(document.activeElement).toBe(trigger)
  })
  it('handles Escape and outside clicks without dismissing clicks inside content', async () => {
    mobile = true
    const panel = await render(true)
    await panel.get('aside button').trigger('click')
    expect(panel.emitted('update:open')).toBeUndefined()
    await panel.get('dialog').trigger('cancel')
    expect(panel.emitted('update:open')?.at(-1)).toEqual([false])
    await panel.setProps({ open: false }); await panel.setProps({ open: true }); await flushPromises()
    await panel.get('dialog').trigger('click', { clientX: 500, clientY: 10 })
    expect(panel.emitted('update:open')).toHaveLength(2)
  })
  it('releases the top layer at desktop breakpoint and removes media listeners on unmount', async () => {
    mobile = true
    const panel = await render(true)
    change?.({ matches: false } as MediaQueryListEvent); await flushPromises()
    expect(close).toHaveBeenCalledOnce()
    expect(panel.find('dialog').exists()).toBe(false)
    expect(panel.find('aside').exists()).toBe(true)
    expect(panel.emitted('update:open')?.at(-1)).toEqual([false])
    panel.unmount(); wrapper = undefined
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
  it('closes the native modal when the parent changes open to false', async () => {
    mobile = true
    const panel = await render(true)
    await panel.setProps({ open: false }); await flushPromises()
    expect(close).toHaveBeenCalledOnce()
    expect(panel.get('dialog').attributes('open')).toBeUndefined()
  })
})
