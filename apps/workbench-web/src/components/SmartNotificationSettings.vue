<template>
  <div class="notification-settings">
    <section class="notification-hero">
      <div><div class="kicker">SMART COMPLETION</div><h2>只在值得打断你时通知</h2><p>普通问答不会发送。CodyWork 会在 Turn 结束后，综合有效执行时长、工具调用、文件修改、计划和验证信号，识别真正的长时间复杂任务。</p></div>
      <span :class="['hero-state',{enabled:form.enabled}]">{{ form.enabled ? '已启用' : '未启用' }}</span>
    </section>

    <form class="notification-card" @submit.prevent="save">
      <div class="card-head"><div><div class="kicker">DELIVERY</div><h3>站内小铃铛 · 可选飞书通知</h3></div><label class="switch"><input v-model="form.enabled" type="checkbox" /><span>启用智能通知</span></label></div>
      <div v-if="loading" class="loading">正在加载配置…</div>
      <template v-else>
        <NotificationRecipientFields :workspace-id="workspaceId" v-model:account-id="form.accountId" :email="form.recipientEmail || ''" :enabled="form.feishuEnabled" :disabled="saving" @update:email="form.recipientEmail = $event" @update:enabled="form.feishuEnabled = $event" />
        <p v-if="settings?.recipientOpenId && !form.recipientEmail" class="field-note">旧配置仍保留 Open ID；请改填邮箱并保存，避免跨应用投递失败。</p>

        <div class="policy-box">
          <div><strong>智能判断</strong><small>等待审批、等待回答的时间会从有效执行时间中扣除；普通聊天即使回复较长也不会仅凭文字长度触发。</small></div>
          <label>最短有效执行时间
            <select v-model.number="form.minActiveMinutes" :disabled="saving">
              <option :value="15">15 分钟</option><option :value="30">30 分钟（推荐）</option><option :value="45">45 分钟</option><option :value="60">60 分钟</option><option :value="90">90 分钟</option><option :value="120">120 分钟</option>
            </select>
          </label>
        </div>

        <fieldset><legend>通知范围</legend>
          <label class="scope"><input v-model="form.notifyDemand" type="checkbox" /><span><strong>需求会话</strong><small>Demand / Worktree 中的长任务</small></span></label>
          <label class="scope"><input v-model="form.notifyWorkspace" type="checkbox" /><span><strong>Workspace 会话</strong><small>Workspace 级搜索、排查和维护任务</small></span></label>
        </fieldset>

        <div class="preview"><div class="preview-icon">✓</div><div><strong>通知包含什么</strong><p>完成状态、有效执行时长、结果摘要、工具与文件修改信号，以及返回原会话的链接。每个 Turn 最多发送一次。</p></div></div>
        <p v-if="message" :class="['message',messageKind]" role="status">{{ message }}</p>
        <div class="actions"><button type="button" :disabled="saving || testing || !settings?.enabled" @click="testNotification">{{ testing ? '处理中…' : '创建测试通知' }}</button><button class="primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存设置' }}</button></div>
      </template>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, type FeishuChannelAccount, type SmartNotificationSettings, type SmartNotificationSettingsInput } from '../api'
import NotificationRecipientFields from './NotificationRecipientFields.vue'

const props = defineProps<{ workspaceId: string }>()
const accounts=ref<FeishuChannelAccount[]>([]);const settings=ref<SmartNotificationSettings|null>(null);const loading=ref(true);const saving=ref(false);const testing=ref(false);const message=ref('');const messageKind=ref<'ok'|'error'>('ok')
const form=reactive<SmartNotificationSettingsInput>({enabled:true,feishuEnabled:false,recipientEmail:'',accountId:'',recipientOpenId:'',minActiveMinutes:30,notifyDemand:true,notifyWorkspace:true})
const enabledAccounts=computed(()=>accounts.value.filter(account=>account.enabled))
const selectedAccount=computed(()=>accounts.value.find(account=>account.id===form.accountId))
const recipientSuggestions=computed(()=>selectedAccount.value?.allowedUserIds??[])
function apply(value:SmartNotificationSettings):void{settings.value=value;form.enabled=value.enabled;form.feishuEnabled=value.feishuEnabled??Boolean(value.accountId);form.recipientEmail=value.recipientEmail??'';form.accountId=value.accountId;form.recipientOpenId=value.recipientOpenId;form.minActiveMinutes=value.minActiveMinutes;form.notifyDemand=value.notifyDemand;form.notifyWorkspace=value.notifyWorkspace}
async function load():Promise<void>{loading.value=true;message.value='';try{const [nextAccounts,nextSettings]=await Promise.all([api.listFeishuAccounts(),api.smartNotificationSettings(props.workspaceId)]);accounts.value=nextAccounts;apply(nextSettings)}catch(cause){messageKind.value='error';message.value=cause instanceof Error?cause.message:String(cause)}finally{loading.value=false}}
async function save():Promise<void>{message.value='';if(form.enabled&&form.feishuEnabled&&(!form.accountId||!form.recipientEmail)){messageKind.value='error';message.value='请选择发送机器人并填写企业邮箱。';return}if(form.enabled&&!form.notifyDemand&&!form.notifyWorkspace){messageKind.value='error';message.value='至少选择一种通知范围。';return}saving.value=true;try{apply(await api.updateSmartNotificationSettings(props.workspaceId,{...form,recipientOpenId:form.recipientEmail?'':form.recipientOpenId}));messageKind.value='ok';message.value='智能通知设置已保存。'}catch(cause){messageKind.value='error';message.value=cause instanceof Error?cause.message:String(cause)}finally{saving.value=false}}
async function testNotification():Promise<void>{testing.value=true;message.value='';try{await api.testSmartNotification(props.workspaceId);messageKind.value='ok';message.value='测试结果已保存到通知中心；如开启飞书，可在那里查看投递状态。'}catch(cause){messageKind.value='error';message.value=cause instanceof Error?cause.message:String(cause)}finally{testing.value=false}}
onMounted(load)
</script>

<style scoped>
.notification-settings{max-width:940px;padding:30px 36px 64px}.notification-hero,.notification-card{background: var(--surface-panel);border: 1px solid var(--border-default);border-radius: var(--radius-panel);box-shadow: var(--shadow-panel);}.notification-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:24px;margin-bottom:16px;background: var(--surface-panel);}.kicker{color: var(--ink-tertiary);font-size:9px;font-weight:800;letter-spacing:.16em}.notification-hero h2{margin:7px 0 7px;font-size:20px}.notification-hero p{max-width:690px;margin:0;color: var(--ink-secondary);font-size:12px;line-height:1.75}.hero-state{flex:none;padding:6px 10px;color: var(--ink-secondary);background: var(--surface-subtle);border-radius:999px;font-size:10px;font-weight:700}.hero-state.enabled{color: var(--success);background: var(--success-bg);}.notification-card{padding:25px}.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.card-head h3{margin:6px 0 0;font-size:18px}.switch{display:flex!important;grid-template-columns:18px auto!important;align-items:center;gap:8px;min-height:42px;padding:0 12px!important;margin:0!important;background: var(--surface-subtle);border-radius: var(--radius-panel);font-weight:700!important}.loading{padding:50px;color: var(--ink-tertiary);text-align:center}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}.notification-card label{display:grid;gap:7px;color: var(--ink-secondary);font-size:11px;font-weight:700}.notification-card input:not([type=checkbox]),.notification-card select{box-sizing:border-box;width:100%;min-height:42px;padding:9px 11px;color: var(--ink-primary);background: var(--surface-panel);border: 1px solid var(--border-default);border-radius: var(--radius-control);font:inherit}.field-note{margin:9px 0 0;color: var(--ink-tertiary);font-size:10px}.policy-box{display:grid;grid-template-columns:minmax(0,1fr) 220px;align-items:end;gap:24px;margin-top:20px;padding:17px;background: var(--surface-panel);border: 1px solid var(--border-default);border-radius: var(--radius-panel)}.policy-box strong,.policy-box small{display:block}.policy-box small{margin-top:5px;color: var(--ink-tertiary);font-size:10px;line-height:1.65}fieldset{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0 0;padding:14px;border: 1px solid var(--border-default);border-radius: var(--radius-panel)}legend{padding:0 6px;color: var(--ink-secondary);font-size:11px;font-weight:750}.scope{grid-template-columns:18px 1fr!important;align-items:start;padding:10px;margin:0!important;background: var(--surface-panel);border-radius: var(--radius-control)}.scope strong,.scope small{display:block}.scope small{margin-top:3px;color: var(--ink-tertiary);font-size:10px}.preview{display:flex;gap:12px;margin-top:18px;padding:15px;color: var(--accent);background: var(--surface-panel);border: 1px solid var(--border-default);border-radius: var(--radius-panel)}.preview-icon{display:grid;place-items:center;width:29px;height:29px;flex:none;color: var(--on-accent);background: var(--accent);border-radius: var(--radius-control)}.preview strong{font-size:12px}.preview p{margin:4px 0 0;font-size:10px;line-height:1.6}.message{margin:14px 0 0;padding:10px 12px;border-radius: var(--radius-control);font-size:11px}.message.ok{color: var(--success);background: var(--surface-subtle);}.message.error{color: var(--danger);background: var(--surface-panel);}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.actions button{min-height:42px;padding:9px 14px;color: var(--ink-secondary);background: var(--surface-panel);border: 1px solid var(--border-default);border-radius: var(--radius-control);font:inherit;font-weight:700}.actions button:disabled{opacity:.5}.actions .primary{color: var(--on-accent);background: var(--accent);border-color: var(--accent-border);}@media(max-width:760px){.notification-settings{padding:22px}.notification-hero,.card-head{flex-direction:column}.field-grid,.policy-box,fieldset{grid-template-columns:1fr}}
</style>
