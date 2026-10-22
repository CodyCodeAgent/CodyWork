<template>
  <div class="followup-settings">
    <header><div><h2>定时跟进</h2><p>在当前 Workspace 后台持续跟进，达到完成条件或截止时间后停止。</p></div><button type="button" :disabled="busy" @click="newTask">新建跟进</button></header>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
    <div class="followup-layout">
      <section class="task-list" aria-label="跟进任务">
        <button type="button" :disabled="busy || loading" @click="load">{{ loading ? '加载中…' : '刷新列表' }}</button>
        <p v-if="!loading && !tasks.length">还没有跟进任务。从会话创建，或填写来源会话开始。</p>
        <button v-for="task in tasks" :key="task.id" type="button" class="task-row" :aria-pressed="selected?.id === task.id" :disabled="busy" @click="selectTask(task)">
          <strong>{{ task.name }}</strong><span>{{ statusLabel(task.status) }} · 每 {{ task.intervalMinutes }} 分钟</span><small>来源：{{ task.demandId ? `需求 ${task.demandId}` : 'Workspace' }} / {{ task.conversationId }}</small><small v-if="task.nextRunAt">下次：{{ formatDate(task.nextRunAt) }}</small>
        </button>
      </section>
      <div class="editor">
        <form @submit.prevent="save">
          <h3>{{ selected ? '编辑跟进' : '新建跟进' }}</h3>
          <p v-if="selected">{{ statusLabel(selected.status) }} · v{{ selected.revision }} · {{ selected.demandId ? `来源需求：${selected.demandId}` : '来源：Workspace 会话' }}</p>
          <nav v-if="selected" class="conversation-links" aria-label="跟进关联会话">
            <a :href="conversationUrl(selected.conversationId)">打开原始会话</a>
            <a v-if="selected.backgroundConversationId" :href="conversationUrl(selected.backgroundConversationId)">查看后台跟进历史</a>
            <span v-else>后台会话尚未创建</span>
          </nav>
          <fieldset :disabled="busy || loading || Boolean(selected && terminal(selected))">
            <label>来源会话 ID<input v-model.trim="form.conversationId" name="conversationId" required :readonly="Boolean(selected || originConversationId)" /></label>
            <small>仅使用当前 Workspace 内可访问的会话；来源需求由服务端解析。</small>
            <label>任务名称<input v-model.trim="form.name" name="name" required maxlength="120" /></label>
            <label>执行内容<textarea v-model.trim="form.prompt" name="prompt" required rows="4" /></label>
            <label>完成条件<textarea v-model.trim="form.completionCondition" name="completionCondition" required rows="2" /></label>
            <div class="field-grid"><label>截止时间（本地时间）<input v-model="deadlineLocal" name="deadline" type="datetime-local" required /></label><label>间隔（分钟）<input v-model.number="form.intervalMinutes" name="intervalMinutes" type="number" min="1" step="1" required /></label></div>
            <label>通知频率<select v-model="form.notification.mode" name="notificationMode"><option value="every">每次运行</option><option value="change">有变化时</option><option value="terminal">仅结束时</option></select></label>
            <button type="button" :disabled="!defaults" @click="useDefaults">使用智能通知默认设置</button>
            <NotificationRecipientFields :workspace-id="workspaceId" v-model:account-id="form.notification.accountId" :email="form.notification.recipientEmail || ''" :enabled="form.notification.feishuEnabled" @update:email="form.notification.recipientEmail = $event" @update:enabled="form.notification.feishuEnabled = $event" />
            <small v-if="form.notification.recipientOpenId && !form.notification.recipientEmail">旧配置使用 Open ID，建议改填邮箱。已完成任务可在下方修正接收人并补发。</small>
            <button type="submit" class="primary">{{ busy ? '处理中…' : selected ? '保存修改' : '创建跟进' }}</button>
          </fieldset>
        </form>
        <template v-if="selected">
          <fieldset class="task-actions" :disabled="busy || loading">
            <button v-if="selected.status === 'active' || selected.status === 'running'" type="button" :disabled="busy" @click="act('pause')">暂停</button>
            <button v-if="selected.status === 'paused' || selected.status === 'needs_attention'" type="button" :disabled="busy" @click="act('resume')">恢复</button>
            <button v-if="selected.status === 'active'" type="button" :disabled="busy" @click="act('run-now')">立即运行</button>
            <button v-if="canRetryNotification" type="button" :disabled="busy || runsLoading" @click="resendOpen = !resendOpen">重试通知（不重新检查）</button>
            <button v-if="!terminal(selected)" type="button" :disabled="busy" @click="act('cancel')">{{ confirmingCancel ? '确认取消任务' : '取消任务' }}</button>
          </fieldset>
          <form v-if="resendOpen" class="resend-result" @submit.prevent="resendResult"><h3>修正接收人并补发已有结果</h3><NotificationRecipientFields :workspace-id="workspaceId" v-model:account-id="resendAccount" v-model:email="resendEmail" always-enabled :disabled="busy" /><button type="submit" :disabled="busy || !resendAccount || !resendEmail">确认补发（不重新检查）</button></form>
          <section aria-label="运行记录"><header><h3>运行记录与投递</h3><button type="button" :disabled="runsLoading || busy" @click="loadRuns">刷新记录</button></header>
            <p v-if="runsLoading" role="status">加载记录中…</p><p v-else-if="runsError" role="alert">{{ runsError }}</p><p v-else-if="!runs.length">暂无运行记录。</p>
            <article v-for="run in runs" :key="run.id" class="run"><strong>{{ run.status }}</strong><small>{{ formatDate(run.startedAt) }}<template v-if="run.finishedAt"> — {{ formatDate(run.finishedAt) }}</template></small><p>{{ run.summary || run.error || '暂无摘要' }}</p><p>投递：{{ run.deliveryStatus }}<template v-if="run.deliveryError"> · {{ run.deliveryError }}</template></p></article>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { FollowupAction, FollowupInput, FollowupRun, FollowupTask } from '../followups'
import { api, type FeishuChannelAccount, type SmartNotificationSettings } from '../api'
import { workbenchUrl } from '../workbenchUi'
import NotificationRecipientFields from './NotificationRecipientFields.vue'

const props = defineProps<{ workspaceId: string; originConversationId?: string }>()
const tasks = ref<FollowupTask[]>([])
const selected = ref<FollowupTask | null>(null)
const runs = ref<FollowupRun[]>([])
const loading = ref(false), busy = ref(false), runsLoading = ref(false)
const error = ref(''), runsError = ref(''), message = ref(''), deadlineLocal = ref(''), confirmingCancel = ref(false)
let generation = 0, runGeneration = 0, mutationGeneration = 0
const resendOpen = ref(false), resendAccount = ref(''), resendEmail = ref('')
const accounts = ref<FeishuChannelAccount[]>([]), defaults = ref<SmartNotificationSettings | null>(null)
const empty = (): FollowupInput => ({ conversationId: props.originConversationId || '', name: '', prompt: '', completionCondition: '', deadlineAt: '', intervalMinutes: 30, notification: { mode: 'change', accountId: '', recipientOpenId: '', recipientEmail: '', feishuEnabled: false } })
function useDefaults(): void { if (defaults.value) { form.notification.accountId = defaults.value.accountId; form.notification.recipientOpenId = defaults.value.recipientOpenId; form.notification.recipientEmail = defaults.value.recipientEmail ?? ''; form.notification.feishuEnabled = defaults.value.feishuEnabled ?? Boolean(defaults.value.accountId) } }
async function loadNotificationOptions(): Promise<void> {
  const token = generation
  const results = await Promise.allSettled([api.listFeishuAccounts(), api.smartNotificationSettings(props.workspaceId)])
  if (token !== generation) return
  if (results[0].status === 'fulfilled') accounts.value = results[0].value
  else error.value = `通知账号加载失败：${reason(results[0].reason)}`
  if (results[1].status === 'fulfilled') defaults.value = results[1].value
}
const form = reactive<FollowupInput>(empty())
const terminal = (task: FollowupTask) => ['completed', 'cancelled', 'expired'].includes(task.status)
const canRetryNotification = computed(() => {
  const task = selected.value
  if (!task || loading.value || runsLoading.value || runsError.value || ['paused', 'cancelled'].includes(task.status)) return false
  // The endpoint retries this task's current run/outbox; never offer it for an older failed delivery.
  const run = task.lastRun ? runs.value.find(item => item.id === task.lastRun?.id) : runs.value[0]
  if (!run) return false
  return (task.status === 'needs_attention' && run.phase === 'interrupted' && Boolean(run.result))
    || ['failed', 'dead_letter', 'superseded', 'local_only'].includes(run.deliveryStatus)
})
const statusLabel = (status: string) => ({ active: '进行中', paused: '已暂停', running: '运行中', needs_attention: '待人工处理', completed: '已完成', cancelled: '已取消', expired: '已到期' }[status] || status)
function conversationUrl(conversationId: string): string {
  return workbenchUrl(window.location.href, props.workspaceId, selected.value?.demandId ?? null, { conversationId }).toString()
}
const formatDate = (value: string) => new Date(value).toLocaleString()
const reason = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)
function localDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
function newTask(): void {
  resendOpen.value = false
  selected.value = null; Object.assign(form, empty()); deadlineLocal.value = ''; confirmingCancel.value = false
  runs.value = []; runsError.value = ''; runsLoading.value = false; runGeneration++; message.value = ''
}
function selectTask(task: FollowupTask): void {
  resendOpen.value = false; resendAccount.value = task.notification.accountId; resendEmail.value = task.notification.recipientEmail ?? ''
  selected.value = task
  Object.assign(form, { conversationId: task.conversationId, name: task.name, prompt: task.prompt, completionCondition: task.completionCondition, deadlineAt: task.deadlineAt, intervalMinutes: task.intervalMinutes, notification: { ...task.notification } })
  deadlineLocal.value = localDate(task.deadlineAt); confirmingCancel.value = false; message.value = ''
  void loadRuns()
}
async function load(): Promise<void> {
  const token = ++generation, workspaceId = props.workspaceId
  loading.value = true; error.value = ''
  try {
    const result = await api.listFollowups(workspaceId)
    if (token !== generation) return
    tasks.value = result.items
    if (selected.value) {
      const current = result.items.find(task => task.id === selected.value?.id)
      if (current) selectTask(current); else newTask()
    }
  } catch (cause) { if (token === generation) error.value = reason(cause) }
  finally { if (token === generation) loading.value = false }
}
async function loadRuns(): Promise<void> {
  if (!selected.value) return
  const token = ++runGeneration, workspaceId = props.workspaceId, id = selected.value.id
  runs.value = []; runsError.value = ''; runsLoading.value = true
  try { const result = await api.followupRuns(workspaceId, id); if (token === runGeneration) runs.value = result.items }
  catch (cause) { if (token === runGeneration) runsError.value = reason(cause) }
  finally { if (token === runGeneration) runsLoading.value = false }
}
async function mutate(operation: () => Promise<unknown>): Promise<void> {
  if (busy.value) return
  const token = ++mutationGeneration
  busy.value = true; error.value = ''; message.value = ''
  try {
    await operation()
    if (token !== mutationGeneration) return
    await load()
    if (token === mutationGeneration) message.value = '操作已提交。'
  } catch (cause) { if (token === mutationGeneration) error.value = `${reason(cause)} 如任务已更新，请刷新列表后重新编辑。` }
  finally { if (token === mutationGeneration) busy.value = false }
}
function save(): void {
  if (busy.value || loading.value || (selected.value && terminal(selected.value))) return
  const deadline = new Date(deadlineLocal.value)
  if (!form.conversationId.trim() || !form.name.trim() || !form.prompt.trim() || !form.completionCondition.trim() || (form.notification.feishuEnabled && (!form.notification.accountId.trim() || !form.notification.recipientEmail?.trim()))) { error.value = '请填写所有必填项；开启飞书时需要机器人及企业邮箱。'; return }
  if (!Number.isInteger(form.intervalMinutes) || form.intervalMinutes < 1) { error.value = '间隔必须为正整数分钟。'; return }
  if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) { error.value = '截止时间必须晚于当前时间。'; return }
  const input: FollowupInput = { ...form, deadlineAt: deadline.toISOString(), notification: { ...form.notification } }
  const task = selected.value, workspaceId = props.workspaceId, requestGeneration = generation
  void mutate(async () => {
    if (task) return api.updateFollowup(workspaceId, task.id, { ...input, expectedRevision: task.revision })
    const result = await api.createFollowup(workspaceId, input)
    if (generation === requestGeneration && props.workspaceId === workspaceId) newTask()
    return result
  })
}
function act(action: FollowupAction): void {
  const task = selected.value
  if (!task || busy.value || loading.value) return
  if (action === 'retry-notification' ? !canRetryNotification.value : terminal(task)) return
  if (action === 'cancel' && !confirmingCancel.value) { confirmingCancel.value = true; return }
  confirmingCancel.value = false
  const workspaceId = props.workspaceId
  void mutate(() => api.followupAction(workspaceId, task.id, action, task.revision))
}
function resendResult(): void {
  const task = selected.value
  if (!task || busy.value || !canRetryNotification.value) return
  const workspaceId = props.workspaceId
  void mutate(() => api.resendFollowupResult(workspaceId, task.id, task.revision, resendAccount.value, resendEmail.value))
}
watch(() => [props.workspaceId, props.originConversationId], () => { generation++; runGeneration++; mutationGeneration++; tasks.value = []; accounts.value = []; defaults.value = null; busy.value = false; newTask(); void load(); void loadNotificationOptions() }, { immediate: true })
onBeforeUnmount(() => { generation++; runGeneration++; mutationGeneration++ })
</script>

<style scoped>
.conversation-links{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:12px 0}.conversation-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--blue);text-underline-offset:3px}.conversation-links a:focus-visible{outline:3px solid var(--blue);outline-offset:2px}.conversation-links span{color:var(--text);opacity:.75}
.followup-settings{max-width:1180px;margin:auto;padding:28px 32px 60px;color:var(--text)}header,.task-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}h2,h3{margin:0 0 8px}p{line-height:1.6}header p,small{color:var(--text);opacity:.75}.followup-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px;margin-top:20px}.task-list,.editor{min-width:0;padding:20px;background:var(--card);border:1px solid var(--line);border-radius:14px}.task-list{align-self:start}.task-row{display:grid;width:100%;gap:5px;margin-top:10px;text-align:left;overflow-wrap:anywhere}.task-row[aria-pressed=true]{border-color:var(--blue);background:var(--blue-soft)}button,input,textarea,select{font:inherit;border:1px solid var(--line);border-radius:8px;min-height:44px;padding:10px;color:var(--text);background:var(--card)}button:hover{border-color:var(--blue)}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--blue);outline-offset:2px}.primary{background:var(--blue);color:var(--card);margin-top:16px}fieldset{border:0;padding:0;margin:0;min-width:0}label{display:grid;gap:6px;margin-top:16px}input,textarea,select{width:100%;min-width:0}textarea{resize:vertical}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.task-actions{justify-content:flex-start;margin:20px 0}.run{padding:16px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.run small{display:block}[role=alert]{border-left:3px solid var(--blue);padding:12px;background:var(--blue-soft);overflow-wrap:anywhere}@media(max-width:800px){.followup-settings{padding:20px}.followup-layout,.field-grid{grid-template-columns:1fr}}
</style>
