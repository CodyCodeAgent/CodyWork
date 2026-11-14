// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import QuickActionSettings from './QuickActionSettings.vue'

let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })
const props = { actions: [], skills: [], selectedId: '', saving: false, message: '' }

describe('quick action form keyboard interaction', () => {
  it('focuses the missing required field without emitting a write', async () => {
    wrapper = mount(QuickActionSettings, { props, attachTo: document.body })
    await wrapper.get('form').trigger('submit')
    expect(document.activeElement).toBe(wrapper.get('#quick-action-name').element)
    await wrapper.get('#quick-action-name').setValue('Review')
    await wrapper.get('form').trigger('submit')
    expect(document.activeElement).toBe(wrapper.get('#quick-action-prompt').element)
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('keeps save focus during persistence and ignores repeated submissions', async () => {
    wrapper = mount(QuickActionSettings, { props, attachTo: document.body })
    await wrapper.get('#quick-action-name').setValue('Review')
    await wrapper.get('#quick-action-prompt').setValue('Inspect only')
    const save = wrapper.get('.save-button').element as HTMLButtonElement
    save.focus()
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ saving: true })
    expect(document.activeElement).toBe(save)
    expect(save.getAttribute('aria-disabled')).toBe('true')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toHaveLength(1)
    await wrapper.setProps({ saving: false, message: '快捷指令已创建。' })
    expect(document.activeElement).toBe(save)
    expect(save.getAttribute('aria-disabled')).toBe('false')
  })
})
