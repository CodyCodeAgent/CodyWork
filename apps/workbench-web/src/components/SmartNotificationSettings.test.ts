// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SmartNotificationSettings from './SmartNotificationSettings.vue'

const api = vi.hoisted(() => ({
  listFeishuAccounts: vi.fn(), smartNotificationSettings: vi.fn(), updateSmartNotificationSettings: vi.fn(), testSmartNotification: vi.fn(),
}))
vi.mock('../api', () => ({ api }))

const account = {
  id:'account-1',provider:'feishu',name:'Cody Work',appId:'cli_1',appSecretConfigured:true,domain:'feishu',enabled:true,
  allowAllUsers:false,allowAllConversations:true,allowedUserIds:['ou_owner'],allowedConversationIds:[],groupMentionMode:'always',privateConversationMode:'chat',
  botOpenId:'ou_bot',botName:'Cody Work',connectionState:'connected',lastError:'',lastCloseCode:null,lastCloseReason:'',lastDisconnectedAt:null,
  reconnectAttempts:0,nextReconnectAt:null,connectedAt:null,lastEventAt:null,lastDeliveryAt:null,createdAt:'',updatedAt:'',
}
const settings = { workspaceId:'workspace-1',enabled:false,accountId:'',recipientOpenId:'',minActiveMinutes:30,notifyDemand:true,notifyWorkspace:true,updatedAt:'' }

beforeEach(()=>{vi.clearAllMocks();api.listFeishuAccounts.mockResolvedValue([account]);api.smartNotificationSettings.mockResolvedValue(settings)})

describe('SmartNotificationSettings',()=>{
  it('explains the smart threshold and persists one workspace policy',async()=>{
    api.updateSmartNotificationSettings.mockResolvedValue({...settings,enabled:true,feishuEnabled:true,recipientEmail:'fixture@example.test',accountId:'account-1',updatedAt:'now'})
    const wrapper=mount(SmartNotificationSettings,{props:{workspaceId:'workspace-1'}})
    await flushPromises()
    expect(wrapper.text()).toContain('只在值得打断你时通知')
    expect(wrapper.text()).toContain('等待审批、等待回答的时间会从有效执行时间中扣除')
    await wrapper.find('.switch input').setValue(true)
    await wrapper.get('.recipient-fields .check input').setValue(true)
    await wrapper.get('.recipient-fields select').setValue('account-1')
    await flushPromises()
    await wrapper.get('input[type=email]').setValue('fixture@example.test')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.updateSmartNotificationSettings).toHaveBeenCalledWith('workspace-1',expect.objectContaining({enabled:true,accountId:'account-1',recipientEmail:'fixture@example.test',feishuEnabled:true,recipientOpenId:'',minActiveMinutes:30,notifyDemand:true,notifyWorkspace:true}))
    expect(wrapper.text()).toContain('智能通知设置已保存')
  })

  it('only enables test delivery after saved settings are active',async()=>{
    api.smartNotificationSettings.mockResolvedValue({...settings,enabled:true,accountId:'account-1',recipientOpenId:'ou_owner'})
    api.testSmartNotification.mockResolvedValue({queued:true,outboxId:'outbox-1'})
    const wrapper=mount(SmartNotificationSettings,{props:{workspaceId:'workspace-1'}})
    await flushPromises()
    const button=wrapper.findAll('button').find(item=>item.text()==='创建测试通知')!
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await flushPromises()
    expect(api.testSmartNotification).toHaveBeenCalledWith('workspace-1')
    expect(wrapper.text()).toContain('测试结果已保存到通知中心')
  })
})
