// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsOverview from './SettingsOverview.vue'

describe('SettingsOverview', () => {
  it('gives every settings tile an icon, readable copy and a decorative arrow', () => {
    const wrapper = mount(SettingsOverview, { props: { actionCount: 0 } })
    const tiles = wrapper.findAll('.settings-tile')
    expect(tiles).toHaveLength(5)
    for (const tile of tiles) {
      expect(tile.get('.tile-icon').attributes('aria-hidden')).toBe('true')
      expect(tile.get('.tile-copy strong').text()).not.toBe('')
      expect(tile.get('.tile-copy small').text()).not.toBe('')
      expect(tile.get('.tile-arrow').attributes('aria-hidden')).toBe('true')
    }
    expect(tiles[0]?.get('.tile-copy strong').text()).toBe('定时跟进')
  })

  it('opens each section without changing the target', async () => {
    const wrapper = mount(SettingsOverview, { props: { actionCount: 0 } })
    for (const tile of wrapper.findAll('.settings-tile')) await tile.trigger('click')
    expect(wrapper.emitted('open')).toEqual([
      ['followups'], ['quick-actions'], ['runtime'], ['feishu'], ['smart-notifications'],
    ])
  })

  it('keeps the count badge separate from the quick action copy', () => {
    const wrapper = mount(SettingsOverview, { props: { actionCount: 12 } })
    expect(wrapper.findAll('.tile-count')).toHaveLength(1)
    expect(wrapper.get('.tile-count').text()).toBe('12 条')
    expect(wrapper.findAll('.settings-tile')[1]?.get('.tile-copy strong').text()).toBe('快捷指令')
  })
})
