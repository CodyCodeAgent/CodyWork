// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { vModalFocus } from './modalFocus'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.style.display === 'none' ? [] : [{}]) as unknown as DOMRectList
  })
})
afterEach(async () => {
  wrapper?.unmount()
  await nextTick()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
function key(value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
  document.activeElement?.dispatchEvent(event)
  return event
}
function setup() {
  wrapper = mount(defineComponent({
    directives: { modalFocus: vModalFocus },
    setup() {
      const open = ref(false), nested = ref(false), busy = ref(false)
      return { open, nested, busy }
    },
    template: `<button id="launch" @click="open = true">Open</button><button id="background">Background</button>
      <section v-if="open" id="parent" v-modal-focus="() => { if (!busy) open = false }" role="dialog" aria-modal="true">
        <button id="first" @click="nested = true">Directory</button><input disabled />
        <button hidden>Hidden</button><button style="display:none">Hidden CSS</button><button tabindex="-1">Programmatic</button>
        <button id="last">Last</button>
      </section>
      <section v-if="nested" id="child" v-modal-focus="() => { nested = false }" role="dialog" aria-modal="true"><button id="child-close" @click="nested = false">Close</button></section>`,
  }), { attachTo: document.body })
  return wrapper
}
async function open() {
  const view = setup()
  ;(view.get('#launch').element as HTMLElement).focus()
  await view.get('#launch').trigger('click')
  return view
}

describe('modal keyboard scope', () => {
  it('focuses the modal and wraps only visible, enabled tab stops', async () => {
    const view = await open()
    expect(document.activeElement?.id).toBe('parent')
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('first')
    key('Tab', true)
    expect(document.activeElement?.id).toBe('last')
    key('Tab')
    expect(document.activeElement?.id).toBe('first')
    ;(view.get('#background').element as HTMLElement).focus()
    expect(document.activeElement?.id).toBe('parent')
  })
  it('closes only the top modal, restores nested focus, then restores its original opener', async () => {
    const view = await open()
    ;(view.get('#first').element as HTMLElement).focus()
    await view.get('#first').trigger('click')
    expect(document.activeElement?.id).toBe('child')
    key('Escape')
    await nextTick(); await nextTick()
    expect(view.find('#child').exists()).toBe(false)
    expect(view.find('#parent').exists()).toBe(true)
    expect(document.activeElement?.id).toBe('first')
    key('Escape')
    await nextTick(); await nextTick()
    expect(view.find('#parent').exists()).toBe(false)
    expect(document.activeElement?.id).toBe('launch')
  })
  it('honours current busy guards and removes listeners when the view unmounts', async () => {
    const view = await open()
    ;(view.vm as unknown as { busy: boolean }).busy = true
    await nextTick()
    key('Escape')
    await nextTick()
    expect(view.find('#parent').exists()).toBe(true)
    view.unmount(); wrapper = undefined
    await nextTick()
    const outside = document.createElement('button')
    document.body.append(outside); outside.focus()
    expect(document.activeElement).toBe(outside)
    expect(key('Tab').defaultPrevented).toBe(false)
  })
})
