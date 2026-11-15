<template>
  <section class="collaboration-settings">
    <header><div><h3>群内方案协作</h3><p>真人在群里 @ 多个机器人发起讨论。各自使用绑定会话的上下文；只讨论方案，不执行修改。</p></div><button type="button" :disabled="busy" @click="load">刷新记录</button></header>
    <p class="hint">参与者由每次消息中的 @ 决定，无需配置机器人名单。所有参与方都需开启协作，并授权接收机器人 @ 消息。</p>
    <div v-if="data.configs.length" class="config-list"><button v-for="item in data.configs" :key="item.chatId" type="button" @click="edit(item)">{{ item.chatId }} · {{ item.enabled ? '开启' : '关闭' }} · {{ item.maxRounds }} 轮 / {{ item.maxMinutes }} 分钟</button><button type="button" @click="reset">＋ 新群配置</button></div>
    <form @submit.prevent="save">
      <div class="fields">
        <label>群 ID<input v-model.trim="form.chatId" required placeholder="oc_…" /></label>
        <label>该群已有会话<select v-model="form.bindingId" required><option value="">选择已绑定的需求或会话</option><option v-for="binding in groupBindings" :key="binding.id" :value="binding.id">{{ binding.conversationTitle }} · {{ binding.targetType === 'codywork-demand' ? '需求' : '工作空间' }}</option></select></label>
        <label>最大轮次<input v-model.number="form.maxRounds" type="number" min="1" max="30" required /></label>
        <label>最长时间（分钟）<input v-model.number="form.maxMinutes" type="number" min="1" max="120" required /></label>
      </div>
      <p class="hint">先在飞书中绑定此群的会话，再在这里选择。双方上限不同时按较小值执行。每位参与的机器人完成一次判断计为一轮；当前支持 Codex 会话。</p>
      <div class="actions"><label class="toggle"><input v-model="form.enabled" type="checkbox" /> 启用这个群的协作</label><button type="submit" :disabled="busy || !form.bindingId">保存群协作配置</button></div>
    </form>
    <p v-if="message" :role="failed ? 'alert' : 'status'" :class="{ error: failed }">{{ message }}</p>
    <div class="records">
      <h4>讨论记录</h4><p v-if="!data.sessions.length" class="hint">尚无讨论。配置后，在群里 @ 两个或更多机器人说明要讨论的方案。</p>
      <article v-for="session in data.sessions" :key="session.id">
        <header><strong>{{ label(session.state.status) }} · {{ session.state.round }}/{{ session.state.maxRounds }} 轮</strong><button v-if="active(session.state.status)" type="button" :disabled="busy" @click="stop(session.id)">停止讨论</button></header>
        <p>{{ session.participants.map(item => item.name).join('、') }}</p>
        <small>群 {{ session.chatId }} · 话题 {{ session.state.topic }} · 批次 {{ session.state.batch }}</small>
        <small>截止 {{ new Date(session.state.deadline).toLocaleString() }}</small>
        <p v-if="active(session.state.status)" class="hint">等待：{{ waiting(session) }}</p>
        <p v-if="session.lastError" class="error">{{ session.lastError }}</p>
        <details><summary>查看各方判断</summary><div v-for="(item, slot) in session.state.decisions" :key="slot" class="decision"><strong>{{ session.participants[Number(slot)]?.name }} · 第 {{ item.round }} 轮 · {{ item.decision.action }}</strong><p>{{ item.decision.reason }}</p><p v-if="item.decision.pendingIssues.length">待解决：{{ item.decision.pendingIssues.join('；') }}</p></div></details>
      </article>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { api, type FeishuChannelBinding, type BotCollaborationConfig, type BotCollaborationSession } from '../api'
const props = defineProps<{ accountId: string; bindings: FeishuChannelBinding[] }>()
const form = reactive<BotCollaborationConfig>({ chatId: '', bindingId: '', enabled: false, maxRounds: 3, maxMinutes: 15 })
const data = ref<{ configs: BotCollaborationConfig[]; sessions: BotCollaborationSession[] }>({ configs: [], sessions: [] })
const busy = ref(false), message = ref(''), failed = ref(false)
let generation = 0
const groupBindings = computed(() => props.bindings.filter(binding => binding.channelScope !== 'private' && binding.channelConversationId === form.chatId))
function reset() { Object.assign(form, { chatId: '', bindingId: '', enabled: false, maxRounds: 3, maxMinutes: 15 }) }
function edit(config: BotCollaborationConfig) { Object.assign(form, config) }
function active(status: string) { return status === 'joining' || status === 'active' }
function label(status: string) { return ({ joining: '等待参与者', active: '讨论中', completed: '达成一致', needs_human: '需要人工确认', round_limit: '已达轮次上限', expired: '已到截止时间', stopped: '已停止' } as Record<string, string>)[status] || status }
function waiting(session: BotCollaborationSession) {
  return session.participants.filter((_, slot) => session.state.status === 'joining' ? !session.state.joined.includes(slot) : session.state.decisions[slot]?.round !== session.state.round).map(item => item.name).join('、') || '正在同步判断'
}
async function load() {
  const id = props.accountId, revision = ++generation
  try { const result = await api.botCollaboration(id); if (revision === generation && id === props.accountId) data.value = result }
  catch (error) { if (revision === generation) { failed.value = true; message.value = error instanceof Error ? error.message : String(error) } }
}
async function action(work: () => Promise<unknown>, success: string) {
  const id = props.accountId
  busy.value = true; message.value = ''
  try { await work(); if (id === props.accountId) { failed.value = false; message.value = success; await load() } }
  catch (error) { if (id === props.accountId) { failed.value = true; message.value = error instanceof Error ? error.message : String(error) } }
  finally { busy.value = false }
}
function save() { return action(() => api.saveBotCollaboration(props.accountId, { ...form }), '群协作配置已保存') }
function stop(id: string) { return action(() => api.stopBotCollaboration(props.accountId, id), '讨论已停止，后续消息不会继续触发本批次') }
watch(() => props.accountId, () => { reset(); data.value = { configs: [], sessions: [] }; message.value = ''; void load() }, { immediate: true })
watch(() => form.chatId, () => { if (!groupBindings.value.some(binding => binding.id === form.bindingId)) form.bindingId = '' })
const timer = setInterval(() => { if (!busy.value && (data.value.configs.some(config => config.enabled) || data.value.sessions.some(session => active(session.state.status)))) void load() }, 5000)
onBeforeUnmount(() => { generation++; clearInterval(timer) })
</script>
<style scoped>
.collaboration-settings{margin-top:24px;padding:24px;border:1px solid var(--border-default);border-radius:14px;background:var(--surface-panel);color:var(--ink-primary)}header,.actions{display:flex;align-items:center;justify-content:space-between;gap:16px}h3,h4,p{margin:0 0 10px}.hint,small{font-size:12px;color:var(--ink-tertiary);line-height:1.7}.fields{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0 12px}label{display:flex;flex-direction:column;gap:8px;font-size:13px}.toggle{flex-direction:row;align-items:center}input,select,button{font:inherit;border:1px solid var(--border-default);border-radius:8px;padding:9px 12px;background:var(--surface-panel);color:inherit}input,select{min-width:0}button{cursor:pointer}header>button,.actions>button{flex-shrink:0;white-space:nowrap}header>div,.fields>label{min-width:0}button:disabled{opacity:.5;cursor:default}.records{margin-top:26px}.records article{border-top:1px solid var(--border-default);padding:16px 0}.records small{display:block;overflow-wrap:anywhere}.decision{padding:12px 0;font-size:13px}.error{color:var(--danger)}summary{cursor:pointer;font-size:13px}.config-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media(max-width:700px){.fields{grid-template-columns:1fr}header,.actions{align-items:flex-start;flex-direction:column}.collaboration-settings{padding:16px}}
</style>
