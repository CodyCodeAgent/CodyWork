// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemePicker from './ThemePicker.vue'
import { initializeTheme, currentTheme, importedSkins } from '../theme'
import { BUILT_IN_SKINS } from '../skins/skins'
describe('appearance settings', () => {
  let dispose: () => void
  beforeEach(() => {
    const data=new Map<string,string>()
    vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)})
    dispose=initializeTheme()
  })
  afterEach(() => { dispose(); vi.unstubAllGlobals() })
  it('selects a builtin, imports JSON, confirms deletion and reports invalid JSON without losing selection', async () => {
    const wrapper=mount(ThemePicker)
    expect(wrapper.findAll('.skin-card')).toHaveLength(4)
    await wrapper.findAll('.skin-card')[3].trigger('click')
    expect(currentTheme.value).toBe('qq-2007')
    await wrapper.get('.skin-advanced-toggle').trigger('click')
    const textarea=wrapper.get('textarea')
    await textarea.setValue('{oops')
    await wrapper.findAll('.skin-advanced button')[1].trigger('click')
    expect(wrapper.get('[role=alert]').text()).toContain('JSON')
    expect(currentTheme.value).toBe('qq-2007')
    await textarea.setValue(JSON.stringify({...BUILT_IN_SKINS[0],id:'user-theme'}))
    await wrapper.findAll('.skin-advanced button')[1].trigger('click')
    expect(importedSkins.value).toHaveLength(1)
    expect(wrapper.get('[role=status]').text()).toContain('已导入')
    await wrapper.get('.skin-delete').trigger('click')
    expect(importedSkins.value).toHaveLength(1)
    await wrapper.findAll('.skin-delete-confirm button')[1].trigger('click')
    expect(importedSkins.value).toHaveLength(0)
    expect(currentTheme.value).toBe('professional')
    wrapper.unmount()
  })
})
