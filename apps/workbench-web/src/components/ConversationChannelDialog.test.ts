// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConversationChannelDialog from './ConversationChannelDialog.vue'
import type { Conversation, FeishuChannelBinding } from '../api'

const conversation: Conversation = {
  id: 'conversation', demandId: 'demand', scope: 'demand', title: '需求沟通', nativeId: 'thread',
  permissionMode: 'workspace-write', createdVia: 'feishu', status: 'completed', policyHash: 'policy', instructionHash: 'instruction', createdAt: '', updatedAt: '',
}
const binding: FeishuChannelBinding = {
  id: 'binding', conversationKey: 'key', workspaceId: 'workspace', targetType: 'codywork-demand', demandId: 'demand',
  conversationId: conversation.id, conversationTitle: conversation.title, threadId: 'thread-native-id', ownerIdentity: 'ou_1234567890',
  channelConversationId: 'oc_topic_group', channelScope: 'topic', updatedAtIso: '', accountId: 'account', botName: 'Cody Work',
  connectionState: 'connected', pendingDeliveries: 0, deadLetters: 0,
}

function render(bindings = [binding]) {
  return mount(ConversationChannelDialog, { props: { visible: true, conversation, bindings, loading: false, error: '', message: '', unbindingId: '' } })
}

describe('ConversationChannelDialog', () => {
  it('shows channel details on demand and exposes explicit actions', async () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('飞书机器人')
    expect(wrapper.text()).toContain('需求沟通')
    expect(wrapper.text()).toContain('Cody Work')
    expect(wrapper.text()).toContain('话题 · 已绑定')
    expect(wrapper.text()).toContain('连接正常')
    expect(wrapper.text()).toContain('ou_••••7890')
    await wrapper.get('.channel-dialog-actions .btn').trigger('click')
    expect(wrapper.emitted('copy')).toHaveLength(1)
    await wrapper.get('.subtle-danger').trigger('click')
    expect(wrapper.emitted('unbind')?.[0]).toEqual([binding])
  })

  it('explains a Feishu-created conversation whose binding was removed', () => {
    const wrapper = render([])
    expect(wrapper.text()).toContain('当前没有飞书绑定')
    expect(wrapper.text()).toContain('由飞书机器人创建')
  })
})
