<template>
  <button ref="trigger" class="bell" type="button" :aria-label="`通知中心，${unreadCount} 条未读`" :aria-expanded="open" @click="show">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg><span v-if="!collapsed">通知中心</span><strong v-if="unreadCount" class="badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</strong><span v-if="error && !open" class="dot" title="通知加载失败" />
  </button>
  <Teleport to="body"><div v-if="open" class="notification-overlay" @click.self="close">
    <section ref="panel" class="notification-panel" role="dialog" aria-modal="true" aria-labelledby="notification-title" tabindex="-1" @keydown="key">
      <header><div><small>WORKSPACE / INBOX</small><h2 id="notification-title">通知中心 <span>{{ unreadCount }} 未读</span></h2></div><button type="button" aria-label="关闭通知中心" @click="close">×</button></header>
      <nav aria-label="通知筛选"><button type="button" :aria-pressed="!unreadOnly" @click="filter(false)">全部</button><button type="button" :aria-pressed="unreadOnly" @click="filter(true)">未读</button><button type="button" :disabled="busy || !unreadCount" @click="readAll">全部已读</button><button type="button" :disabled="loading" @click="load()">刷新</button></nav>
      <p class="description">任务结果先保存在这里，飞书投递状态单独展示。不会请求浏览器通知权限。</p>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="loading && !items.length" role="status">正在加载通知…</p>
      <p v-else-if="!items.length" class="empty">{{ unreadOnly ? '没有未读通知' : '还没有通知。长任务和定时跟进有结果后会出现在这里。' }}</p>
      <article v-for="item in items" :key="item.id" :class="['notice', { unread: !item.readAt }]">
        <div class="notice-head"><strong>{{ item.title }}</strong><span>{{ outcomeLabel(item.outcome) }}</span></div><time>{{ new Date(item.createdAt).toLocaleString() }}</time><p class="summary">{{ item.summary }}</p>
        <p class="delivery">飞书：{{ deliveryLabel(item.deliveryStatus) }}<span v-if="item.recipientEmail"> · {{ item.recipientEmail }}</span></p><p v-if="item.deliveryError" class="delivery-error">{{ friendlyError(item.deliveryError) }}</p>
        <div class="actions"><a v-if="item.conversationId" :href="url(item)" @click.prevent="visit(item)">查看原会话</a><button type="button" :disabled="busy" @click="read(item)">{{ item.readAt ? '标为未读' : '标为已读' }}</button><button v-if="canSend(item)" type="button" :disabled="busy" @click="edit(item)">{{ item.deliveryStatus === 'local_only' ? '发送到飞书' : '修正接收人并补发' }}</button></div>
        <form v-if="editing === item.id" @submit.prevent="resend(item)"><NotificationRecipientFields :workspace-id="workspaceId" v-model:account-id="accountId" v-model:email="email" always-enabled :disabled="busy" /><button type="submit" :disabled="busy || !accountId || !email">{{ busy ? '处理中…' : '确认发送已有结果（不重新执行任务）' }}</button><p v-if="sendMessage" role="status">{{ sendMessage }}</p></form>
      </article>
      <button v-if="nextCursor" type="button" :disabled="loading" @click="load(true)">加载更多</button>
    </section>
  </div></Teleport>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, type WorkbenchNotification } from '../api'
import { workbenchUrl } from '../workbenchUi'
import NotificationRecipientFields from './NotificationRecipientFields.vue'
const props = defineProps<{ workspaceId: string; collapsed?: boolean }>()
const open = ref(false), unreadOnly = ref(false), unreadCount = ref(0), loading = ref(false), busy = ref(false), error = ref(''), items = ref<WorkbenchNotification[]>([]), nextCursor = ref<number | null>(null)
const editing = ref(''), accountId = ref(''), email = ref(''), sendMessage = ref(''), trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>()
let version = 0, mutation = 0, disposed = false, interval: ReturnType<typeof setInterval> | undefined
const outcomeLabel = (value: string) => ({ completed: '已完成', failed: '任务失败', expired: '已到期', needs_attention: '需要处理', pending: '有新进展' }[value] || value)
const deliveryLabel = (value: string) => ({ local_only: '未开启', preparing: '校验接收人中', enqueueing: '正在加入投递队列', pending: '等待投递', leased: '准备发送', sending: '发送中', sent: '已发送', failed: '发送失败', dead_letter: '发送失败', retry_wait: '等待重试', superseded: '已替代' }[value] || value)
const friendlyError = (value: string) => value.includes('open_id cross app') ? '旧 Open ID 不属于所选机器人。请填写企业邮箱后补发。' : value
const canSend = (item: WorkbenchNotification) => ['failed', 'dead_letter', 'local_only', 'superseded'].includes(item.deliveryStatus)
const url = (item: WorkbenchNotification) => workbenchUrl(window.location.href, props.workspaceId, item.demandId, { conversationId: item.conversationId }).toString()
async function load(more = false) {
  if (disposed || !props.workspaceId) return
  const token = ++version, workspaceId = props.workspaceId; loading.value = true
  try { const result = await api.listNotifications(workspaceId, unreadOnly.value, more ? nextCursor.value ?? undefined : undefined); if (token !== version) return; items.value = more ? [...items.value, ...result.items.filter(item => !items.value.some(existing => existing.id === item.id))] : result.items; unreadCount.value = result.unreadCount; nextCursor.value = result.nextCursor; error.value = ''; await nextTick(); if (token === version && open.value && !panel.value?.contains(document.activeElement)) panel.value?.focus() }
  catch (cause) { if (token === version) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (token === version) loading.value = false }
}
async function show() { open.value = true; void load(); await nextTick(); panel.value?.focus() }
function close() { open.value = false; editing.value = ''; trigger.value?.focus() }
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab') return
  const targets = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)') ?? [])]
  const first = targets[0], last = targets.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function filter(value: boolean) { unreadOnly.value = value; editing.value = ''; void load() }
async function perform(operation: () => Promise<unknown>) { const token = ++mutation; busy.value = true; error.value = ''; try { await operation(); if (token === mutation) await load() } catch (cause) { if (token === mutation) error.value = cause instanceof Error ? cause.message : String(cause) } finally { if (token === mutation) busy.value = false } }
function read(item: WorkbenchNotification) { return perform(() => api.readNotifications(props.workspaceId, item.id, !item.readAt)) }
function readAll() { return perform(() => api.readNotifications(props.workspaceId)) }
async function visit(item: WorkbenchNotification) { const href = url(item); try { if (!item.readAt) await api.readNotifications(props.workspaceId, item.id) } catch {} window.location.assign(href) }
function edit(item: WorkbenchNotification) { editing.value = item.id; accountId.value = item.accountId; email.value = item.recipientEmail; sendMessage.value = '' }
function resend(item: WorkbenchNotification) { const workspaceId = props.workspaceId; return perform(async () => { const result = await api.resendNotification(workspaceId, item.id, accountId.value, email.value); if (props.workspaceId === workspaceId && editing.value === item.id) sendMessage.value = result.deliveryStatus === 'failed' ? result.deliveryError : '已有结果已进入投递队列，请稍后刷新状态。' }) }
watch(() => props.workspaceId, () => { version++; mutation++; busy.value = false; items.value = []; unreadCount.value = 0; nextCursor.value = null; editing.value = ''; open.value = false; void load() }, { immediate: true })
onMounted(() => { interval = setInterval(() => { if (document.visibilityState === 'visible' && !loading.value && !busy.value && !editing.value) void load() }, 15_000) })
onBeforeUnmount(() => { disposed = true; version++; mutation++; clearInterval(interval) })
</script>
<style scoped>
.bell{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;border:0;border-radius:9px;padding:10px 14px;background:transparent;color:#cbd2e0;text-align:left;cursor:pointer;font:inherit}.bell svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;flex:none}.badge{margin-left:auto;padding:1px 7px;border-radius:12px;background:var(--blue);color:white;font-size:12px}.dot{width:7px;height:7px;background:var(--blue);border-radius:50%}.notification-overlay{position:fixed;inset:0;background:#11182766;z-index:1000;display:flex;justify-content:flex-end}.notification-panel{width:min(600px,100%);max-height:100dvh;overflow:auto;padding:24px;background:var(--card);color:var(--text);box-shadow:-12px 0 40px #11182722}.notification-panel header,.notice-head,nav,.actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}h2{margin:5px 0 16px;font-size:22px}h2 span,header small,time,.description,.delivery{font-size:12px;color:var(--muted)}nav{justify-content:flex-start}.notification-panel button,.actions a{font:inherit;min-height:44px;padding:9px 12px;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}button:disabled{opacity:.55;cursor:default}:is(button,a):focus-visible{outline:3px solid var(--blue);outline-offset:2px}[aria-pressed=true]{color:var(--blue)!important;border-color:var(--blue)!important}.notice{border:1px solid var(--line);border-radius:12px;padding:18px;margin:16px 0;overflow-wrap:anywhere}.notice.unread{border-left:4px solid var(--blue)}.notice-head strong{font-size:15px}.notice-head span{font-size:12px;background:var(--blue-soft);padding:3px 8px;border-radius:12px}.summary{white-space:pre-wrap;line-height:1.65}.actions{justify-content:flex-start}.empty{padding:48px 12px;text-align:center;color:var(--muted)}[role=alert],.delivery-error{padding:10px;background:var(--blue-soft);border-radius:8px;line-height:1.6}.notification-panel form{border-top:1px solid var(--line);margin-top:16px}.bell:hover{background:#ffffff0a}@media(max-width:600px){.notification-panel{padding:16px}}
</style>
