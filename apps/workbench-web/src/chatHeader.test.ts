import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('chat header action grouping', () => {
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
    const followup = header.indexOf('@click="openConversationFollowup"')
    expect(header.match(/@click="openConversationFollowup"/g)).toHaveLength(1)
    expect(followup).toBeGreaterThan(actions)
    expect(header.indexOf('<h1>')).toBeLessThan(actions)
    expect(header.slice(actions, followup)).toContain('v-if="selectedConversation"')
  })
})
