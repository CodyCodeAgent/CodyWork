import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('chat header action grouping', () => {
  it('groups low-frequency actions while keeping frequent actions directly available', () => {
    const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
    const header = source.match(/<header class="topbar chat-topbar">([\s\S]*?)<\/header>/)![1]
    expect(header).toContain('<div class="chat-toolbar-menu"><div class="topbar-actions">')
    expect(header).not.toContain('<details')
    expect(header).not.toContain('<summary')
    expect(header).toContain('class="btn toolbar-quiet-action"')
    expect(header).toContain('label="连接状态与 Runtime"')
    expect(header).toContain('更多会话操作')
    expect(header).toContain(':inline="isCompactViewport"')
  })
  it('keeps mobile context and composer settings on demand without forking Core', () => {
    const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
    expect(source).toContain('<ResponsivePanel v-model:open="mobileContextOpen" title="会话详情与操作">')
    expect(source).toContain('aria-label="打开历史会话"')
    expect(source.match(/<CodyComposer\b/g)).toHaveLength(1)
    expect(source.match(/<CodyConversation\b/g)).toHaveLength(1)
    expect(source).toContain('<template #controls>')
    expect(source).toContain(':aria-expanded="mobileComposerSettingsOpen"')
  })
  it('mounts exactly one global notification entry outside the sidebar for every page', () => {
    const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
    expect(source.match(/<NotificationBell\b/g)).toHaveLength(1)
    expect(source).toContain('class="global-notification-entry"')
    expect(source.indexOf('<NotificationBell')).toBeGreaterThan(source.indexOf('</WorkbenchSidebar>'))
    expect(source).not.toContain('#notifications')
    expect(source).toContain('.has-notifications .topbar { padding-right:')
  })
  it('keeps the followup entry in the right action group instead of before the title', () => {
    const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
    const header = source.match(/<header class="topbar chat-topbar">([\s\S]*?)<\/header>/)![1]
    const actions = header.indexOf('<div class="topbar-actions">')
    const followup = header.indexOf('@click="mobileContextOpen = false; openConversationFollowup()"')
    expect(header.match(/@click="mobileContextOpen = false; openConversationFollowup\(\)"/g)).toHaveLength(1)
    expect(followup).toBeGreaterThan(actions)
    expect(header.indexOf('<h1>')).toBeLessThan(actions)
    expect(header.slice(actions, followup)).toContain('v-if="selectedConversation"')
  })
})
