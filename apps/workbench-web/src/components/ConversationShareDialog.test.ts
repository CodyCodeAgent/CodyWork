// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConversationShareDialog from './ConversationShareDialog.vue'
import type { ConversationShareResult, FeishuChannelAccount } from '../api'

const account = {
  id: 'channel-1', provider: 'feishu', name: 'Cody Work', appId: 'cli_test', appSecretConfigured: true,
  domain: 'feishu', enabled: true, allowAllUsers: true, allowAllConversations: true,
  allowedUserIds: [], allowedConversationIds: [], groupMentionMode: 'always', privateConversationMode: 'chat',
  botOpenId: 'ou_bot', botName: 'Cody Work Bot', connectionState: 'connected', lastError: '',
  lastCloseCode: null, lastCloseReason: '', lastDisconnectedAt: null, reconnectAttempts: 0, nextReconnectAt: null,
  connectedAt: '', lastEventAt: '', lastDeliveryAt: '', createdAt: '', updatedAt: '',
} satisfies FeishuChannelAccount

const baseProps = {
  visible: true,
  title: '【会话分享】需求 - 沟通',
  accountId: account.id,
  accounts: [account],
  sharing: false,
  error: '',
  result: null as ConversationShareResult | null,
}

describe('ConversationShareDialog', () => {
  it('explains the filtered snapshot and submits the selected bot', async () => {
    const wrapper = mount(ConversationShareDialog, { props: baseProps })
    expect(wrapper.text()).toContain('只保留用户文字输入和 AI 文字输出')
    expect(wrapper.text()).toContain('不会导出')
    expect(wrapper.text()).toContain('组织内持链接者可查看')
    expect(wrapper.get('select').element.value).toBe(account.id)
    await wrapper.get('button.btn.primary').trigger('click')
    expect(wrapper.emitted('share')).toHaveLength(1)
  })

  it('shows the generated document link and exported message count', async () => {
    const result: ConversationShareResult = {
      documentId: 'docx-1', url: 'https://feishu.cn/docx/docx-1', title: baseProps.title, messageCount: 8,
    }
    const wrapper = mount(ConversationShareDialog, { props: { ...baseProps, result } })
    expect(wrapper.text()).toContain('已导出 8 条')
    expect(wrapper.get('a').attributes('href')).toBe(result.url)
    await wrapper.get('button.btn').trigger('click')
    expect(wrapper.emitted('copy')?.[0]).toEqual([result.url])
  })
})
