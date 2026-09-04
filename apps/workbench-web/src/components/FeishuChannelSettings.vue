<template>
  <div class="channel-settings">
    <div class="channel-intro">
      <div><div class="kicker">CHANNEL HOST</div><h2>飞书机器人</h2><p>机器人消息与浏览器共享同一个 CodyWork 会话和原生 Codex Thread。凭证加密保存在本机 SQLite；CodyWeb 不受本配置影响。</p></div>
      <button class="primary" type="button" :disabled="busy" @click="newAccount">＋ 添加机器人</button>
    </div>

    <div class="channel-layout">
      <aside class="account-list">
        <button v-for="account in accounts" :key="account.id" :class="['account-row', { active: account.id === selectedId }]" type="button" :disabled="busy" @click="select(account.id)">
          <span :class="['state-dot', account.connectionState]" /><span><strong>{{ account.name }}</strong><small>{{ account.botName || account.appId }}</small></span><em>{{ account.enabled ? stateLabel(account.connectionState) : '未启用' }}</em>
        </button>
        <p v-if="!accounts.length" class="empty">还没有机器人。添加后仍需显式启用。</p>
      </aside>

      <main class="editor">
        <form @submit.prevent="save">
          <div class="editor-head"><div><h3>{{ form.id ? '机器人配置' : '添加飞书机器人' }}</h3><p>默认拒绝访问；群聊默认必须 @机器人。</p></div><span v-if="form.id" :class="['connection-pill', selected?.connectionState]">{{ stateLabel(selected?.connectionState || 'idle') }}</span></div>
          <div class="field-grid">
            <label><span>名称</span><input v-model.trim="form.name" required placeholder="例如：CodyWork Bot" /></label>
            <label><span>区域</span><select v-model="form.domain"><option value="feishu">飞书</option><option value="lark">Lark</option></select></label>
            <label><span>App ID</span><input v-model.trim="form.appId" required autocomplete="off" placeholder="cli_…" /></label>
            <label><span>App Secret</span><input v-model="form.appSecret" :required="!form.id" type="password" autocomplete="new-password" :placeholder="form.id ? '留空保持原 Secret' : '仅写入加密存储'" /></label>
          </div>
          <div class="policy-grid">
            <label><span>私聊隔离</span><select v-model="form.privateConversationMode"><option value="topic">每条根消息独立绑定</option><option value="chat">整个私聊共享绑定</option></select></label>
            <label><span>群聊触发</span><select v-model="form.groupMentionMode"><option value="always">每次必须 @机器人</option><option value="bound">已绑定群可直接发</option></select></label>
          </div>
          <label class="check"><input v-model="form.allowAllUsers" type="checkbox" /><span><strong>允许所有用户</strong><small>仅建议在受控测试环境临时开启；关闭时必须填写允许用户 ID。</small></span></label>
          <label><span>允许用户 open_id</span><textarea v-model="form.allowedUserIds" :disabled="form.allowAllUsers" rows="3" placeholder="每行一个 open_id；当前不支持 union_id" /></label>
          <label><span>允许群聊 ID</span><textarea v-model="form.allowedConversationIds" rows="3" placeholder="每行一个 chat_id；留空表示拒绝所有群聊" /></label>
          <label class="enable"><input v-model="form.enabled" type="checkbox" /><span><strong>启用长连接</strong><small>保存后立即验证身份并连接飞书事件流；不会重启 Codex App Server。</small></span></label>
          <div v-if="message" :class="['message', messageType]" role="status">{{ message }}</div>
          <div class="actions"><button v-if="form.id" class="danger" type="button" :disabled="busy" @click="remove">删除</button><span /><button v-if="form.id" type="button" :disabled="busy || !selected?.enabled" :title="selected?.enabled ? '重新建立飞书长连接' : '请先启用并保存机器人'" @click="reconnect">重新连接</button><button class="primary" type="submit" :disabled="busy">{{ busy ? '处理中…' : '保存配置' }}</button></div>
        </form>

        <section v-if="diagnostics" class="diagnostics">
          <div class="section-head"><div><div class="kicker">DIAGNOSTICS</div><h3>运行诊断</h3></div><button type="button" :disabled="detailsBusy" @click="refreshDetails">{{ detailsBusy ? '刷新中…' : '刷新' }}</button></div>
          <div class="metrics"><article><small>绑定</small><strong>{{ diagnostics.bindings }}</strong></article><article><small>待绑定</small><strong>{{ diagnostics.inbox.waiting }}</strong></article><article><small>入站失败</small><strong>{{ diagnostics.inbox.failed }}</strong></article><article><small>待投递</small><strong>{{ diagnostics.outbox.pending }}</strong></article><article><small>死信</small><strong>{{ diagnostics.outbox.deadLetter }}</strong></article></div>
          <p v-if="selected?.lastError" class="last-error">{{ selected.lastError }}</p>
          <details><summary>已绑定对话（{{ bindings.length }}）</summary><div class="bindings"><div v-for="binding in bindings" :key="binding.id"><strong>{{ binding.channelScope }} · {{ binding.channelConversationId }}</strong><code>{{ binding.threadId }}</code></div><p v-if="!bindings.length">尚无绑定。首次给机器人发消息后会出现选择卡片。</p></div></details>
        </section>

        <section class="setup-guide"><div class="kicker">FEISHU SETUP</div><h3>开放平台准备</h3><ol><li>为应用启用机器人能力及消息读写权限。</li><li>事件订阅选择“使用长连接接收事件”，订阅 <code>im.message.receive_v1</code>。</li><li>卡片回调启用长连接，供绑定、审批和问题回答使用。</li><li>发布应用版本，并将机器人加入允许的测试会话。</li></ol></section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, type FeishuChannelAccount, type FeishuChannelBinding, type FeishuChannelDiagnostics } from '../api'

const accounts = ref<FeishuChannelAccount[]>([])
const selectedId = ref('')
const diagnostics = ref<FeishuChannelDiagnostics | null>(null)
const bindings = ref<FeishuChannelBinding[]>([])
const busy = ref(false)
const detailsBusy = ref(false)
const message = ref('')
const messageType = ref<'ok' | 'error'>('ok')
let detailsRequestVersion = 0
const form = reactive({ id: '', name: '', appId: '', appSecret: '', domain: 'feishu' as 'feishu' | 'lark', enabled: false, allowAllUsers: false, allowedUserIds: '', allowedConversationIds: '', groupMentionMode: 'always' as 'always' | 'bound', privateConversationMode: 'chat' as 'topic' | 'chat' })
const selected = computed(() => accounts.value.find(account => account.id === selectedId.value))

function lines(value: string): string[] { return [...new Set(value.split(/[\n,]/u).map(item => item.trim()).filter(Boolean))] }
function stateLabel(value: string): string { return ({ connected: '已连接', connecting: '连接中', reconnecting: '重连中', failed: '连接失败', idle: '未连接' } as Record<string, string>)[value] ?? value }
function showError(error: unknown): void { messageType.value = 'error'; message.value = error instanceof Error ? error.message : String(error) }
function fill(account?: FeishuChannelAccount): void {
  Object.assign(form, account ? { id: account.id, name: account.name, appId: account.appId, appSecret: '', domain: account.domain, enabled: account.enabled, allowAllUsers: account.allowAllUsers, allowedUserIds: account.allowedUserIds.join('\n'), allowedConversationIds: account.allowedConversationIds.join('\n'), groupMentionMode: account.groupMentionMode, privateConversationMode: account.privateConversationMode } : { id: '', name: '', appId: '', appSecret: '', domain: 'feishu', enabled: false, allowAllUsers: false, allowedUserIds: '', allowedConversationIds: '', groupMentionMode: 'always', privateConversationMode: 'chat' })
}
async function load(preferredId = selectedId.value): Promise<void> {
  accounts.value = await api.listFeishuAccounts()
  selectedId.value = accounts.value.some(account => account.id === preferredId) ? preferredId : accounts.value[0]?.id ?? ''
  fill(selected.value)
  await refreshDetails()
}
async function select(id: string): Promise<void> {
  selectedId.value = id
  diagnostics.value = null
  bindings.value = []
  fill(selected.value)
  message.value = ''
  await refreshDetails()
}
function newAccount(): void {
  detailsRequestVersion += 1
  detailsBusy.value = false
  selectedId.value = ''
  diagnostics.value = null
  bindings.value = []
  message.value = ''
  fill()
}
async function refreshDetails(): Promise<void> {
  const accountId = selectedId.value
  const requestVersion = ++detailsRequestVersion
  if (!accountId) { diagnostics.value = null; bindings.value = []; detailsBusy.value = false; return }
  detailsBusy.value = true
  try {
    const [nextDiagnostics, nextBindings] = await Promise.all([api.feishuDiagnostics(accountId), api.listFeishuBindings(accountId)])
    if (requestVersion !== detailsRequestVersion || selectedId.value !== accountId) return
    diagnostics.value = nextDiagnostics
    bindings.value = nextBindings
  } catch (error) {
    if (requestVersion !== detailsRequestVersion || selectedId.value !== accountId) return
    diagnostics.value = null
    bindings.value = []
    showError(error)
  } finally {
    if (requestVersion === detailsRequestVersion) detailsBusy.value = false
  }
}
function payload() { return { name: form.name, appId: form.appId, ...(form.appSecret ? { appSecret: form.appSecret } : {}), domain: form.domain, enabled: form.enabled, allowAllUsers: form.allowAllUsers, allowedUserIds: lines(form.allowedUserIds), allowedConversationIds: lines(form.allowedConversationIds), groupMentionMode: form.groupMentionMode, privateConversationMode: form.privateConversationMode } }
async function save(): Promise<void> { busy.value = true; message.value = ''; try { const saved = form.id ? await api.updateFeishuAccount(form.id, payload()) : await api.createFeishuAccount(payload()); await load(saved.id); messageType.value = 'ok'; message.value = saved.enabled ? '配置已保存，长连接正在建立。' : '配置已保存，机器人尚未启用。' } catch (error) { showError(error) } finally { busy.value = false } }
async function reconnect(): Promise<void> {
  const accountId = form.id
  if (!accountId) return
  if (!selected.value?.enabled) { showError(new Error('请先启用并保存机器人，再重新连接。')); return }
  busy.value = true
  message.value = ''
  try { await api.reconnectFeishuAccount(accountId); await load(accountId); messageType.value = 'ok'; message.value = '已重新建立长连接。' } catch (error) { showError(error) } finally { busy.value = false }
}
async function remove(): Promise<void> {
  const accountId = form.id
  if (!accountId || !confirm(`删除机器人“${form.name}”及其绑定和投递记录？`)) return
  busy.value = true
  message.value = ''
  try { await api.deleteFeishuAccount(accountId); await load(); messageType.value = 'ok'; message.value = '机器人已删除。' } catch (error) { showError(error) } finally { busy.value = false }
}
onMounted(() => { void load().catch(showError) })
</script>

<style scoped>
.channel-settings{max-width:1180px;margin:0 auto;padding:30px 34px 70px;color:#202535}.channel-intro,.editor-head,.section-head,.actions{display:flex;align-items:center;justify-content:space-between;gap:20px}.channel-intro{margin-bottom:18px;padding:22px 24px;border:1px solid #dde4ee;border-radius:16px;background:#fff}.channel-intro h2,.editor h3{margin:4px 0 6px}.channel-intro p,.editor-head p{margin:0;color:#788397;font-size:12px;line-height:1.6}.kicker{color:#8995aa;font-size:10px;font-weight:800;letter-spacing:.18em}.channel-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px}.account-list,.editor>form,.diagnostics,.setup-guide{border:1px solid #dfe5ee;border-radius:16px;background:#fff}.account-list{align-self:start;padding:8px}.account-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;padding:13px 12px;border:0;border-radius:11px;background:transparent;text-align:left}.account-row.active{background:#eef1ff}.account-row strong,.account-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-row small{margin-top:4px;color:#8a94a5}.account-row em{font-size:10px;font-style:normal;color:#657086}.state-dot{width:8px;height:8px;border-radius:50%;background:#aab2bf}.state-dot.connected{background:#32b77b}.state-dot.failed{background:#df5c68}.state-dot.connecting,.state-dot.reconnecting{background:#e6a238}.empty{padding:18px;color:#8a94a5;font-size:12px}.editor{display:grid;gap:16px}.editor>form,.diagnostics,.setup-guide{padding:24px}.connection-pill{padding:6px 10px;border-radius:999px;background:#f0f3f7;color:#657086;font-size:11px}.connection-pill.connected{background:#e8f8f0;color:#23845b}.connection-pill.failed{background:#fff0f1;color:#b13b47}.field-grid,.policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}.policy-grid{margin-top:14px}label{display:grid;gap:7px;margin-top:14px;color:#586276;font-size:12px}input,select,textarea,button{font:inherit}input:not([type=checkbox]),select,textarea{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #ccd5e2;border-radius:9px;background:#fff;color:#202535}textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.check,.enable{grid-template-columns:18px minmax(0,1fr);align-items:start;padding:13px;border:1px solid #e4e8ef;border-radius:10px}.check strong,.check small,.enable strong,.enable small{display:block}.check small,.enable small{margin-top:3px;color:#8993a4}.enable{background:#f7f8ff}.actions{margin-top:20px}.actions span{flex:1}button{padding:9px 13px;border:1px solid #ced6e2;border-radius:9px;background:#fff;color:#3c4659;cursor:pointer}.primary{border-color:#5959eb;background:#5b5bf0;color:#fff}.danger{color:#b53c48}.message{margin-top:14px;padding:10px 12px;border-radius:9px;font-size:12px}.message.ok{background:#eaf8f1;color:#217b56}.message.error,.last-error{background:#fff0f1;color:#a93441}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:16px 0}.metrics article{padding:12px;border-radius:10px;background:#f5f7fa}.metrics small,.metrics strong{display:block}.metrics strong{margin-top:5px;font-size:20px}.last-error{padding:10px;border-radius:9px;font-size:12px}details{margin-top:14px}.bindings{display:grid;gap:7px;margin-top:10px}.bindings>div{display:flex;justify-content:space-between;gap:12px;padding:9px;background:#f7f8fa;border-radius:8px}.bindings code{overflow:hidden;text-overflow:ellipsis}.setup-guide ol{margin:14px 0 0;padding-left:20px;color:#647086;font-size:12px;line-height:1.9}@media(max-width:900px){.channel-layout{grid-template-columns:1fr}.field-grid,.policy-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}}
</style>
