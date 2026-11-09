// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import ChatToolbarPopover from './ChatToolbarPopover.vue'

let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); document.body.replaceChildren() })
function create(inline = false) {
  wrapper = mount(ChatToolbarPopover, {
    props: { label: '更多会话操作', inline }, attachTo: document.body,
    slots: {
      trigger: '更多',
      default: ({ close }: { close: () => void }) => [h('button', { disabled: true }, '不可用'), h('button', { onClick: close }, '分享会话')],
    },
  })
}
describe('ChatToolbarPopover', () => {
  it('opens from the keyboard, skips disabled actions and restores focus on Escape', async () => {
    create()
    const trigger = wrapper.get('.chat-toolbar-trigger')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('分享会话')
    await wrapper.get('[role=dialog]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })
  it('closes outside and on action without taking focus from a newly opened dialog', async () => {
    create()
    await wrapper.get('.chat-toolbar-trigger').trigger('click')
    const outside = document.createElement('button'); document.body.append(outside)
    outside.focus(); outside.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick()
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
    expect(document.activeElement).toBe(outside)
    await wrapper.get('.chat-toolbar-trigger').trigger('click')
    await wrapper.get('[role=dialog] button:not(:disabled)').trigger('click')
    outside.focus(); await nextTick()
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
    expect(document.activeElement).toBe(outside)
  })
  it('keeps mobile actions directly available and dismisses a desktop popover on breakpoint change', async () => {
    create()
    await wrapper.get('.chat-toolbar-trigger').trigger('click')
    await wrapper.setProps({ inline: true })
    expect(wrapper.find('.chat-toolbar-trigger').exists()).toBe(false)
    expect(wrapper.get('[role=group]').text()).toContain('分享会话')
    await wrapper.setProps({ inline: false })
    expect(wrapper.get('.chat-toolbar-trigger').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
  })
})
