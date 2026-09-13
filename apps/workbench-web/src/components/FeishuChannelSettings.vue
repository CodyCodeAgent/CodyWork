<template>
  <div class="channel-settings">
    <div class="channel-intro">
      <div><div class="kicker">CHANNEL HOST</div><h2>飞书机器人</h2><p>机器人消息与浏览器共享同一个 CodyWork 会话和原生 Codex Thread。凭证加密保存在本机 SQLite；CodyWeb 不受本配置影响。</p></div>
      <button class="primary" type="button" :disabled="busy || isCreating" @click="newAccount">＋ 新建机器人</button>
    </div>

    <div class="channel-layout">
      <aside class="account-list">
        <header class="account-list-head"><span>机器人</span><strong>{{ accounts.length }}</strong></header>
        <button v-if="isCreating" class="account-row account-draft active" type="button" aria-current="true">
          <span class="state-dot" /><span><strong>{{ form.name || '未命名机器人' }}</strong><small>新配置 · 尚未保存</small></span><em>编辑中</em>
        </button>
        <button v-for="account in accounts" :key="account.id" :class="['account-row', { active: !isCreating && account.id === selectedId }]" type="button" :disabled="busy" @click="select(account.id)">
          <span :class="['state-dot', account.connectionState]" /><span><strong>{{ account.name }}</strong><small>{{ account.botName || account.appId }}</small></span><em>{{ account.enabled ? stateLabel(account.connectionState) : '未启用' }}</em>
        </button>
        <p v-if="!accounts.length && !isCreating" class="empty">还没有机器人。新配置默认停用，保存后可再显式开启长连接。</p>
      </aside>

      <main class="editor">
        <form @submit.prevent="save">
          <div class="editor-head"><div><h3>{{ form.id ? '机器人配置' : '新建飞书机器人' }}</h3><p>{{ form.id ? '修改只影响当前机器人。' : '填写已有飞书应用凭证；新机器人默认停用。' }} 默认拒绝访问，群聊默认必须 @机器人。</p></div><span v-if="form.id" :class="['connection-pill', selected?.connectionState]">{{ stateLabel(selected?.connectionState || 'idle') }}</span></div>
          <div class="field-grid">
            <label><span>名称</span><input v-model.trim="form.name" required placeholder="例如：CodyWork Bot" /></label>
            <label><span>区域</span><select v-model="form.domain"><option value="feishu">飞书</option><option value="lark">Lark</option></select></label>
            <label><span>App ID</span><input v-model.trim="form.appId" required autocomplete="off" placeholder="cli_…" /></label>
            <label><span>App Secret</span><input v-model="form.appSecret" :required="!form.id" type="password" autocomplete="new-password" :placeholder="form.id ? '留空保持原 Secret' : '仅写入加密存储'" /></label>
          </div>
          <section class="permission-template">
            <div class="permission-template-head">
              <div><strong>固定完整权限</strong><small>所有 CodyWork 机器人统一使用完整权限模板，不提供删减选项。</small></div>
              <span :class="['permission-state', permissionStatus?.state || 'unchecked']">{{ permissionStateLabel }}</span>
            </div>
            <p v-if="permissionStatus?.state === 'incomplete'" class="permission-warning">还缺少 {{ missingPermissionLabels.join('、') || '待管理员授权的权限' }}。权限加入应用后仍需发布版本并完成租户授权。</p>
            <p v-else-if="permissionStatus?.state === 'unavailable'" class="permission-warning">{{ permissionStatus.error || '暂时无法读取租户授权状态。' }}</p>
            <details v-if="permissionTemplate.requiredScopes.length"><summary>查看固定权限清单（{{ permissionTemplate.requiredScopes.length }}）</summary><div class="permission-scopes"><span v-for="scope in permissionTemplate.requiredScopes" :key="scope.name" :title="scope.name">{{ scope.label }}</span></div></details>
            <div class="permission-actions"><span>保存后自动检查租户授权状态。</span><a v-if="permissionAuthorizationUrl" :href="permissionAuthorizationUrl" target="_blank" rel="noopener noreferrer">一次性申请全部权限 ↗</a><em v-else>填写有效 App ID 后可申请</em></div>
          </section>
          <div class="policy-grid">
            <label><span>私聊隔离</span><select v-model="form.privateConversationMode"><option value="topic">每条根消息独立绑定</option><option value="chat">整个私聊共享绑定</option></select></label>
            <label><span>群聊触发</span><select v-model="form.groupMentionMode"><option value="always">每次必须 @机器人</option><option value="bound">已绑定群可直接发</option></select></label>
          </div>
          <label class="check"><input v-model="form.allowAllUsers" type="checkbox" /><span><strong>允许所有用户</strong><small>仅建议在受控测试环境临时开启；关闭时必须填写允许用户 ID。</small></span></label>
          <label><span>允许用户 open_id</span><textarea v-model="form.allowedUserIds" :disabled="form.allowAllUsers" rows="3" placeholder="每行一个 open_id；不支持 union_id；仅作为使用白名单，不决定审批管理员" /></label>
          <label class="check"><input v-model="form.allowAllConversations" type="checkbox" /><span><strong>允许所有群聊</strong><small>机器人被加入任意群后均可使用；用户授权和 @ 触发规则仍然生效。</small></span></label>
          <label><span>允许群聊 ID</span><textarea v-model="form.allowedConversationIds" :disabled="form.allowAllConversations" rows="3" placeholder="每行一个 chat_id；关闭“允许所有群聊”时生效" /></label>
          <label class="enable"><input v-model="form.enabled" type="checkbox" /><span><strong>启用长连接</strong><small>保存后立即验证身份并连接飞书事件流；不会重启 Codex App Server。</small></span></label>
          <div v-if="message" :class="['message', messageType]" role="status">{{ message }}</div>
          <div class="actions"><button v-if="form.id" class="danger" type="button" :disabled="busy" @click="remove">删除</button><button v-else-if="accounts.length" type="button" :disabled="busy" @click="cancelCreate">取消</button><span /><button v-if="form.id" type="button" :disabled="busy || !selected?.enabled" :title="selected?.enabled ? '重新建立飞书长连接' : '请先启用并保存机器人'" @click="reconnect">重新连接</button><button class="primary" type="submit" :disabled="busy">{{ busy ? '处理中…' : form.id ? '保存配置' : '创建机器人' }}</button></div>
        </form>

        <section v-if="diagnostics" class="diagnostics">
          <div class="section-head"><div><div class="kicker">DIAGNOSTICS</div><h3>运行诊断</h3></div><button type="button" :disabled="detailsBusy" @click="refreshDetails(true)">{{ detailsBusy ? '刷新中…' : '刷新' }}</button></div>
          <div class="metrics"><article><small>绑定</small><strong>{{ diagnostics.bindings }}</strong></article><article><small>执行队列</small><strong>{{ diagnostics.inbox.queued }}</strong></article><article><small>待绑定</small><strong>{{ diagnostics.inbox.waiting }}</strong></article><article><small>入站失败</small><strong>{{ diagnostics.inbox.failed }}</strong></article><article><small>待投递</small><strong>{{ diagnostics.outbox.pending }}</strong></article><article><small>死信</small><strong>{{ diagnostics.outbox.deadLetter }}</strong></article></div>
          <div class="runtime-facts"><span><small>最近连接</small>{{ formatTime(selected?.connectedAt) }}</span><span><small>最近事件</small>{{ formatTime(selected?.lastEventAt) }}</span><span><small>最近投递</small>{{ formatTime(selected?.lastDeliveryAt) }}</span><span><small>观察会话</small>{{ diagnostics.runtime.observedConversations }} / {{ diagnostics.bindings }}</span><span><small>重连次数</small>{{ selected?.reconnectAttempts ?? 0 }}</span><span><small>下次重连</small>{{ formatTime(selected?.nextReconnectAt) }}</span></div>
          <div v-if="selected?.lastDisconnectedAt" class="disconnect-fact"><strong>最近断开</strong><span>{{ formatTime(selected.lastDisconnectedAt) }} · 关闭码 {{ selected.lastCloseCode ?? 'SDK 未提供' }}</span><p>{{ selected.lastCloseReason || '未提供关闭原因' }}</p></div>
          <p v-if="selected?.lastError" class="last-error">{{ selected.lastError }}</p>
          <details v-if="diagnostics.outbox.failures.length" open><summary>失败投递（{{ diagnostics.outbox.failures.length }}）</summary><div class="failed-deliveries"><article v-for="delivery in diagnostics.outbox.failures" :key="delivery.id"><div><strong>{{ delivery.kind }} · {{ delivery.status === 'dead_letter' ? '死信' : '等待重试' }}</strong><small>{{ formatTime(delivery.updatedAt) }} · 已尝试 {{ delivery.attempts }} 次</small><p>{{ delivery.lastError || '未记录错误详情' }}</p></div><button type="button" :disabled="busy" @click="retryDelivery(delivery.id)">立即重试</button></article></div></details>
          <details><summary>已绑定对话（{{ bindings.length }}）</summary><div class="bindings"><div v-for="binding in bindings" :key="binding.id"><span><strong>{{ binding.conversationTitle }}</strong><small>{{ binding.targetType === 'codywork-workspace' ? 'Workspace 会话' : 'Demand Worktree' }} · {{ binding.channelScope }} · {{ binding.channelConversationId }}</small></span><code :title="`原生 Thread：${binding.threadId}`">{{ binding.threadId }}</code></div><p v-if="!bindings.length">尚无绑定。首次给机器人发消息后会出现选择卡片。</p></div></details>
        </section>

        <section class="setup-guide"><div class="kicker">FEISHU SETUP</div><h3>开放平台准备</h3><ol><li>点击“一次性申请全部权限”，将固定完整权限加入应用。</li><li>为应用启用机器人能力；事件订阅选择“使用长连接接收事件”，订阅 <code>im.message.receive_v1</code>。</li><li>卡片回调启用长连接，供绑定、审批和问题回答使用。</li><li>发布应用版本并完成租户管理员授权；未发布的权限不会生效。</li><li>回到本页刷新诊断，确认显示“权限完整”，再启用长连接。</li></ol></section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { api, type FeishuChannelAccount, type FeishuChannelBinding, type FeishuChannelDiagnostics, type FeishuPermissionStatus, type FeishuPermissionTemplate } from '../api'

const accounts = ref<FeishuChannelAccount[]>([])
const selectedId = ref('')
const diagnostics = ref<FeishuChannelDiagnostics | null>(null)
const permissionTemplate = ref<FeishuPermissionTemplate>({ requiredScopes: [] })
const permissionStatus = ref<FeishuPermissionStatus | null>(null)
const bindings = ref<FeishuChannelBinding[]>([])
const busy = ref(false)
const detailsBusy = ref(false)
const message = ref('')
const messageType = ref<'ok' | 'error'>('ok')
let detailsRequestVersion = 0
let connectionTimer: ReturnType<typeof setTimeout> | null = null
let connectionPolls = 0
const form = reactive({ id: '', name: '', appId: '', appSecret: '', domain: 'feishu' as 'feishu' | 'lark', enabled: false, allowAllUsers: false, allowAllConversations: false, allowedUserIds: '', allowedConversationIds: '', groupMentionMode: 'always' as 'always' | 'bound', privateConversationMode: 'chat' as 'topic' | 'chat' })
const selected = computed(() => accounts.value.find(account => account.id === selectedId.value))
const isCreating = computed(() => !form.id)
const permissionStateLabel = computed(() => ({ complete: '权限完整', incomplete: '权限未完整', unavailable: '检查失败' } as Record<string, string>)[permissionStatus.value?.state || ''] || (form.id ? '待检查' : '创建时统一申请'))
const missingPermissionLabels = computed(() => {
  const missing = new Set([...(permissionStatus.value?.missingScopes ?? []), ...(permissionStatus.value?.pendingScopes ?? [])])
  return permissionTemplate.value.requiredScopes.filter(scope => missing.has(scope.name)).map(scope => scope.label)
})
const permissionAuthorizationUrl = computed(() => {
  if (permissionStatus.value?.authorizationUrl) return permissionStatus.value.authorizationUrl
  if (!/^cli_[A-Za-z0-9_-]+$/u.test(form.appId)) return ''
  const host = form.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  const scopes = permissionTemplate.value.requiredScopes.map(scope => scope.name).join(',')
  return scopes ? `${host}/page/scope-apply?clientID=${encodeURIComponent(form.appId)}&scopes=${encodeURIComponent(scopes)}` : ''
})

function lines(value: string): string[] { return [...new Set(value.split(/[\n,]/u).map(item => item.trim()).filter(Boolean))] }
function stateLabel(value: string): string { return ({ connected: '已连接', connecting: '连接中', reconnecting: '重连中', failed: '连接失败', idle: '未连接' } as Record<string, string>)[value] ?? value }
function formatTime(value?: string | null): string { if (!value) return '尚无'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString() }
function showError(error: unknown): void { messageType.value = 'error'; message.value = error instanceof Error ? error.message : String(error) }
function fill(account?: FeishuChannelAccount): void {
  Object.assign(form, account ? { id: account.id, name: account.name, appId: account.appId, appSecret: '', domain: account.domain, enabled: account.enabled, allowAllUsers: account.allowAllUsers, allowAllConversations: account.allowAllConversations, allowedUserIds: account.allowedUserIds.join('\n'), allowedConversationIds: account.allowedConversationIds.join('\n'), groupMentionMode: account.groupMentionMode, privateConversationMode: account.privateConversationMode } : { id: '', name: '', appId: '', appSecret: '', domain: 'feishu', enabled: false, allowAllUsers: false, allowAllConversations: false, allowedUserIds: '', allowedConversationIds: '', groupMentionMode: 'always', privateConversationMode: 'chat' })
}
async function load(preferredId = selectedId.value): Promise<void> {
  accounts.value = await api.listFeishuAccounts()
  selectedId.value = accounts.value.some(account => account.id === preferredId) ? preferredId : accounts.value[0]?.id ?? ''
  fill(selected.value)
  await refreshDetails(true)
  scheduleConnectionRefresh(selectedId.value, true)
}
async function select(id: string): Promise<void> {
  selectedId.value = id
  diagnostics.value = null
  permissionStatus.value = null
  bindings.value = []
  fill(selected.value)
  message.value = ''
  await refreshDetails(true)
  scheduleConnectionRefresh(id, true)
}
function newAccount(): void {
  detailsRequestVersion += 1
  detailsBusy.value = false
  selectedId.value = ''
  diagnostics.value = null
  permissionStatus.value = null
  bindings.value = []
  message.value = ''
  fill()
}
function cancelCreate(): void {
  const fallback = accounts.value.find(account => account.id === selectedId.value) ?? accounts.value[0]
  if (!fallback) return
  void select(fallback.id)
}
async function refreshDetails(includePermissions = false): Promise<void> {
  const accountId = selectedId.value
  const requestVersion = ++detailsRequestVersion
  if (!accountId) { diagnostics.value = null; permissionStatus.value = null; bindings.value = []; detailsBusy.value = false; return }
  detailsBusy.value = true
  try {
    const [nextDiagnostics, nextBindings, nextPermissions] = await Promise.all([
      api.feishuDiagnostics(accountId),
      api.listFeishuBindings(accountId),
      includePermissions ? api.feishuPermissions(accountId) : Promise.resolve(permissionStatus.value),
    ])
    if (requestVersion !== detailsRequestVersion || selectedId.value !== accountId) return
    diagnostics.value = nextDiagnostics
    bindings.value = nextBindings
    if (includePermissions) permissionStatus.value = nextPermissions
  } catch (error) {
    if (requestVersion !== detailsRequestVersion || selectedId.value !== accountId) return
    diagnostics.value = null
    bindings.value = []
    showError(error)
  } finally {
    if (requestVersion === detailsRequestVersion) detailsBusy.value = false
  }
}
function payload() { return { name: form.name, appId: form.appId, ...(form.appSecret ? { appSecret: form.appSecret } : {}), domain: form.domain, enabled: form.enabled, allowAllUsers: form.allowAllUsers, allowAllConversations: form.allowAllConversations, allowedUserIds: lines(form.allowedUserIds), allowedConversationIds: lines(form.allowedConversationIds), groupMentionMode: form.groupMentionMode, privateConversationMode: form.privateConversationMode } }
async function save(): Promise<void> { busy.value = true; message.value = ''; try { const saved = form.id ? await api.updateFeishuAccount(form.id, payload()) : await api.createFeishuAccount(payload()); await load(saved.id); messageType.value = 'ok'; message.value = saved.enabled ? '配置已保存。长连接状态请以运行诊断为准。' : '配置已保存，机器人尚未启用。' } catch (error) { showError(error) } finally { busy.value = false } }
async function reconnect(): Promise<void> {
  const accountId = form.id
  if (!accountId) return
  if (!selected.value?.enabled) { showError(new Error('请先启用并保存机器人，再重新连接。')); return }
  busy.value = true
  message.value = ''
  try { await api.reconnectFeishuAccount(accountId); await load(accountId); messageType.value = 'ok'; message.value = '已重新建立长连接。' } catch (error) { showError(error) } finally { busy.value = false }
}
async function retryDelivery(outboxId: string): Promise<void> {
  const accountId = form.id
  if (!accountId) return
  busy.value = true
  message.value = ''
  try {
    await api.retryFeishuOutbox(accountId, outboxId)
    await refreshDetails()
    messageType.value = 'ok'
    message.value = '投递已重新进入队列；稳定幂等键会避免重复远端消息。'
  } catch (error) { showError(error) } finally { busy.value = false }
}
async function remove(): Promise<void> {
  const accountId = form.id
  if (!accountId || !confirm(`删除机器人“${form.name}”及其绑定和投递记录？`)) return
  busy.value = true
  message.value = ''
  try { await api.deleteFeishuAccount(accountId); await load(); messageType.value = 'ok'; message.value = '机器人已删除。' } catch (error) { showError(error) } finally { busy.value = false }
}
function scheduleConnectionRefresh(accountId: string, reset = false): void {
  if (connectionTimer) clearTimeout(connectionTimer)
  connectionTimer = null
  if (reset) connectionPolls = 0
  const account = accounts.value.find(item => item.id === accountId)
  if (!account?.enabled || !['connecting', 'reconnecting'].includes(account.connectionState) || connectionPolls >= 20) return
  const delay = Math.min(600 * (1.35 ** connectionPolls), 3_000)
  connectionPolls += 1
  connectionTimer = setTimeout(() => {
    void (async () => {
      try {
        const nextAccounts = await api.listFeishuAccounts()
        if (selectedId.value !== accountId) return
        accounts.value = nextAccounts
        const next = nextAccounts.find(item => item.id === accountId)
        if (next?.connectionState === 'failed' && next.lastError) showError(new Error(next.lastError))
        await refreshDetails()
        scheduleConnectionRefresh(accountId)
      } catch (error) {
        showError(error)
      }
    })()
  }, delay)
}
onMounted(() => { void (async () => { permissionTemplate.value = await api.feishuPermissionTemplate(); await load() })().catch(showError) })
onUnmounted(() => { if (connectionTimer) clearTimeout(connectionTimer) })
</script>

<style scoped>
.channel-settings{max-width:1180px;margin:0 auto;padding:30px 34px 70px;color:#202535}.channel-intro,.editor-head,.section-head,.actions{display:flex;align-items:center;justify-content:space-between;gap:20px}.channel-intro{margin-bottom:18px;padding:22px 24px;border:1px solid #dde4ee;border-radius:16px;background:#fff}.channel-intro h2,.editor h3{margin:4px 0 6px}.channel-intro p,.editor-head p{margin:0;color:#788397;font-size:12px;line-height:1.6}.kicker{color:#8995aa;font-size:10px;font-weight:800;letter-spacing:.18em}.channel-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px}.account-list,.editor>form,.diagnostics,.setup-guide{border:1px solid #dfe5ee;border-radius:16px;background:#fff}.account-list{align-self:start;padding:8px}.account-list-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;color:#818ca0;font-size:11px;font-weight:700;letter-spacing:.08em}.account-list-head strong{display:grid;min-width:22px;height:22px;place-items:center;border-radius:999px;background:#f0f2f7;color:#616c80;font-size:10px}.account-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;padding:13px 12px;border:0;border-radius:11px;background:transparent;text-align:left}.account-row.active{background:#eef1ff}.account-draft{margin-bottom:4px;outline:1px dashed #7777ec;outline-offset:-1px}.account-row strong,.account-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-row small{margin-top:4px;color:#8a94a5}.account-row em{font-size:10px;font-style:normal;color:#657086}.state-dot{width:8px;height:8px;border-radius:50%;background:#aab2bf}.state-dot.connected{background:#32b77b}.state-dot.failed{background:#df5c68}.state-dot.connecting,.state-dot.reconnecting{background:#e6a238}.empty{padding:18px;color:#8a94a5;font-size:12px;line-height:1.6}.editor{display:grid;gap:16px}.editor>form,.diagnostics,.setup-guide{padding:24px}.connection-pill{padding:6px 10px;border-radius:999px;background:#f0f3f7;color:#657086;font-size:11px}.connection-pill.connected{background:#e8f8f0;color:#23845b}.connection-pill.failed{background:#fff0f1;color:#b13b47}.field-grid,.policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}.policy-grid{margin-top:14px}label{display:grid;gap:7px;margin-top:14px;color:#586276;font-size:12px}input,select,textarea,button{font:inherit}input:not([type=checkbox]),select,textarea{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #ccd5e2;border-radius:9px;background:#fff;color:#202535}textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.permission-template{margin-top:18px;padding:14px;border:1px solid #dfe3ff;border-radius:11px;background:#f8f8ff}.permission-template-head,.permission-actions{display:flex;align-items:center;justify-content:space-between;gap:14px}.permission-template-head strong,.permission-template-head small{display:block}.permission-template-head small{margin-top:4px;color:#7e879b;font-size:11px}.permission-state{flex:none;padding:5px 9px;border-radius:999px;background:#eef0f5;color:#626d80;font-size:10px;font-weight:700}.permission-state.complete{background:#e6f7ef;color:#21805a}.permission-state.incomplete{background:#fff1db;color:#9a6413}.permission-state.unavailable{background:#fff0f1;color:#a93441}.permission-warning{margin:12px 0 0;padding:9px 10px;border-radius:8px;background:#fff4e5;color:#8e5b14;font-size:11px;line-height:1.6}.permission-template details{margin-top:11px;color:#657086;font-size:11px}.permission-scopes{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.permission-scopes span{padding:5px 7px;border:1px solid #e0e4ef;border-radius:7px;background:#fff;color:#596478}.permission-actions{margin-top:12px;color:#7d8798;font-size:11px}.permission-actions a{padding:7px 10px;border-radius:8px;background:#5b5bf0;color:#fff;text-decoration:none;font-weight:700}.permission-actions em{font-style:normal}.check,.enable{grid-template-columns:18px minmax(0,1fr);align-items:start;padding:13px;border:1px solid #e4e8ef;border-radius:10px}.check strong,.check small,.enable strong,.enable small{display:block}.check small,.enable small{margin-top:3px;color:#8993a4}.enable{background:#f7f8ff}.actions{margin-top:20px}.actions span{flex:1}button{padding:9px 13px;border:1px solid #ced6e2;border-radius:9px;background:#fff;color:#3c4659;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.58}.primary{border-color:#5959eb;background:#5b5bf0;color:#fff}.danger{color:#b53c48}.message{margin-top:14px;padding:10px 12px;border-radius:9px;font-size:12px}.message.ok{background:#eaf8f1;color:#217b56}.message.error,.last-error{background:#fff0f1;color:#a93441}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:9px;margin:16px 0}.metrics article{padding:12px;border-radius:10px;background:#f5f7fa}.metrics small,.metrics strong{display:block}.metrics strong{margin-top:5px;font-size:20px}.runtime-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:14px}.runtime-facts span{padding:10px 12px;border:1px solid #e5e9f0;border-radius:9px;color:#3f495b;font-size:11px}.runtime-facts small{display:block;margin-bottom:4px;color:#8993a4}.disconnect-fact{margin:-4px 0 14px;padding:10px 12px;border:1px solid #f0d6aa;border-radius:9px;background:#fff9ed;color:#74501b;font-size:11px}.disconnect-fact strong,.disconnect-fact span{display:block}.disconnect-fact span{margin-top:4px}.disconnect-fact p{margin:5px 0 0;overflow-wrap:anywhere}.last-error{padding:10px;border-radius:9px;font-size:12px}details{margin-top:14px}.bindings,.failed-deliveries{display:grid;gap:7px;margin-top:10px}.bindings>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px;background:#f7f8fa;border-radius:8px}.bindings>div>span{min-width:0}.bindings strong,.bindings small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bindings small{margin-top:3px;color:#8a94a5;font-size:10px}.bindings code{flex:0 1 42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#657086}.failed-deliveries article{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:11px;border:1px solid #f0d4d7;border-radius:9px;background:#fff8f8}.failed-deliveries strong,.failed-deliveries small{display:block}.failed-deliveries small{margin-top:3px;color:#8b6670}.failed-deliveries p{max-width:620px;margin:7px 0 0;color:#a93441;font-size:11px;word-break:break-word}.setup-guide ol{margin:14px 0 0;padding-left:20px;color:#647086;font-size:12px;line-height:1.9}@media(max-width:900px){.channel-layout{grid-template-columns:1fr}.field-grid,.policy-grid{grid-template-columns:1fr}.metrics,.runtime-facts{grid-template-columns:repeat(2,1fr)}.permission-template-head,.permission-actions{align-items:flex-start;flex-direction:column}}
</style>
