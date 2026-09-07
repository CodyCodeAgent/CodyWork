<template>
  <div v-if="visible && conversation" class="modal-backdrop channel-binding-backdrop" @click.self="emit('close')">
    <section ref="dialog" class="modal-card channel-binding-dialog" role="dialog" aria-modal="true" aria-labelledby="channel-binding-title" tabindex="-1" @keydown.esc.prevent="emit('close')">
      <div class="modal-head channel-binding-head">
        <div class="channel-binding-heading">
          <span class="channel-binding-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3v3M7 9h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" /><path d="M8 20v1M16 20v1" /><circle cx="9" cy="14" r="1" /><circle cx="15" cy="14" r="1" /></svg>
          </span>
          <div><div class="eyebrow">CHANNEL CONNECTION</div><h2 id="channel-binding-title">飞书机器人</h2></div>
        </div>
        <button class="icon-button" type="button" aria-label="关闭飞书机器人详情" :disabled="Boolean(unbindingId)" @click="emit('close')">×</button>
      </div>

      <div class="channel-conversation-summary"><small>当前会话</small><strong>{{ conversation.title }}</strong></div>
      <p v-if="loading" class="channel-dialog-state" role="status">正在读取绑定详情…</p>
      <p v-else-if="error" class="channel-dialog-state error" role="alert">{{ error }}</p>
      <div v-else-if="bindings.length" class="channel-binding-list">
        <article v-for="binding in bindings" :key="binding.id" class="channel-binding-card">
          <div class="channel-binding-card-head">
            <div><strong>{{ binding.botName || binding.accountName || 'CodyWork Bot' }}</strong><small>{{ scopeLabel(binding.channelScope) }} · 已绑定</small></div>
            <span :class="['channel-health-pill', bindingHealth(binding)]"><i />{{ connectionLabel(binding) }}</span>
          </div>
          <dl>
            <div><dt>飞书会话</dt><dd :title="binding.channelConversationId">{{ binding.channelConversationId }}</dd></div>
            <div><dt>绑定用户</dt><dd>{{ maskedChannelIdentity(binding.ownerIdentity) }}</dd></div>
            <div><dt>原生 Thread</dt><dd :title="binding.threadId">{{ binding.threadId }}</dd></div>
            <div><dt>投递状态</dt><dd>{{ deliveryLabel(binding) }}</dd></div>
          </dl>
          <p v-if="binding.lastError" class="channel-binding-error">{{ binding.lastError }}</p>
          <div class="channel-binding-card-actions"><button class="btn subtle-danger" type="button" :disabled="Boolean(unbindingId)" @click="emit('unbind', binding)">{{ unbindingId === binding.id ? '解绑中…' : '解除此绑定' }}</button></div>
        </article>
      </div>
      <div v-else class="channel-dialog-empty"><strong>当前没有飞书绑定</strong><p>{{ conversation.createdVia === 'feishu' ? '这个会话由飞书机器人创建，但绑定已经解除。会话和历史仍然保留。' : '当前会话没有连接到飞书机器人。' }}</p></div>

      <p v-if="message" class="channel-dialog-message" role="status">{{ message }}</p>
      <div class="modal-actions channel-dialog-actions"><button class="btn" type="button" @click="emit('copy')">复制会话链接</button><button class="btn primary" type="button" @click="emit('close')">完成</button></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Conversation, FeishuChannelBinding } from '../api'
import { maskedChannelIdentity } from '../workbenchUi'

const props = defineProps<{
  visible: boolean
  conversation: Conversation | null
  bindings: FeishuChannelBinding[]
  loading: boolean
  error: string
  message: string
  unbindingId: string
}>()
const emit = defineEmits<{ close: []; copy: []; unbind: [binding: FeishuChannelBinding] }>()
const dialog = ref<HTMLElement | null>(null)

function scopeLabel(scope: string): string { return ({ private: '私聊', group: '群聊', topic: '话题' } as Record<string, string>)[scope] ?? scope }
function bindingHealth(binding: FeishuChannelBinding): 'ok' | 'warning' {
  return binding.connectionState === 'connected' && !binding.lastError && !(binding.pendingDeliveries ?? 0) && !(binding.deadLetters ?? 0) ? 'ok' : 'warning'
}
function connectionLabel(binding: FeishuChannelBinding): string {
  if ((binding.deadLetters ?? 0) > 0) return `${binding.deadLetters} 条死信`
  if ((binding.pendingDeliveries ?? 0) > 0) return `${binding.pendingDeliveries} 条待投递`
  return binding.connectionState === 'connected' ? '连接正常' : `连接${binding.connectionState || '未知'}`
}
function deliveryLabel(binding: FeishuChannelBinding): string {
  const pending = binding.pendingDeliveries ?? 0
  const dead = binding.deadLetters ?? 0
  return pending || dead ? `${pending} 条待投递 · ${dead} 条死信` : '无积压'
}

watch(() => props.visible, async visible => {
  if (!visible) return
  await nextTick()
  dialog.value?.focus({ preventScroll: true })
}, { immediate: true })
</script>

<style scoped>
.channel-binding-backdrop{padding:20px}.channel-binding-dialog{width:min(560px,100%);padding:0;overflow:hidden;outline:0}.channel-binding-head{align-items:center;margin:0;padding:22px 24px 18px;border-bottom:1px solid #e8ebf1}.channel-binding-heading{display:flex;align-items:center;gap:12px}.channel-binding-heading h2{margin:3px 0 0;font-size:21px}.channel-binding-mark{display:grid;width:38px;height:38px;place-items:center;color:#4f5fd1;background:#eef0ff;border:1px solid #d8ddff;border-radius:11px}.channel-binding-mark svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}.channel-conversation-summary{display:flex;align-items:center;gap:12px;padding:13px 24px;color:#475269;background:#f7f8fb;border-bottom:1px solid #e9ecf2}.channel-conversation-summary small{flex:0 0 auto;color:#8a94a5;font-size:10px}.channel-conversation-summary strong{min-width:0;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.channel-binding-list{display:grid;gap:10px;max-height:min(430px,55vh);overflow:auto;padding:18px 24px}.channel-binding-card{padding:15px;border:1px solid #e1e6ef;border-radius:12px;background:#fff}.channel-binding-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.channel-binding-card-head strong,.channel-binding-card-head small{display:block}.channel-binding-card-head strong{color:#283247;font-size:13px}.channel-binding-card-head small{margin-top:3px;color:#8993a4;font-size:10px}.channel-health-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;color:#237d5a;background:#eaf8f1;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap}.channel-health-pill i{width:6px;height:6px;background:currentColor;border-radius:50%}.channel-health-pill.warning{color:#9a621d;background:#fff2da}.channel-binding-card dl{display:grid;grid-template-columns:1fr 1fr;gap:11px 16px;margin:15px 0 0;padding-top:13px;border-top:1px solid #edf0f4}.channel-binding-card dl>div{min-width:0}.channel-binding-card dt{margin-bottom:4px;color:#929cac;font-size:9px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}.channel-binding-card dd{overflow:hidden;margin:0;color:#566277;font:10px/1.5 var(--mono);text-overflow:ellipsis;white-space:nowrap}.channel-binding-error{margin:12px 0 0;padding:9px 10px;color:#a5434d;background:#fff0f1;border-radius:8px;font-size:10px;line-height:1.5;overflow-wrap:anywhere}.channel-binding-card-actions{display:flex;justify-content:flex-end;margin-top:12px}.btn.subtle-danger{min-height:36px;padding:7px 10px;color:#a24753;background:#fff;border-color:#e6c9ce}.btn.subtle-danger:hover:not(:disabled){background:#fff3f4;border-color:#dbaeb5}.channel-dialog-state,.channel-dialog-empty{margin:18px 24px;padding:18px;color:#687488;background:#f7f8fa;border:1px solid #e7eaf0;border-radius:11px;font-size:12px}.channel-dialog-state.error{color:#a5434d;background:#fff0f1;border-color:#f0d0d4}.channel-dialog-empty strong{color:#3d475a}.channel-dialog-empty p{margin:5px 0 0;line-height:1.6}.channel-dialog-message{margin:0 24px 14px;padding:9px 11px;color:#297354;background:#edf8f3;border-radius:8px;font-size:11px}.channel-dialog-actions{padding:14px 24px;margin:0;background:#fff;border-top:1px solid #e8ebf1}.channel-dialog-actions .btn{min-height:44px}@media(max-width:600px){.channel-binding-backdrop{padding:10px}.channel-binding-card dl{grid-template-columns:1fr}.channel-binding-list{padding:14px}.channel-binding-head,.channel-conversation-summary,.channel-dialog-actions{padding-right:16px;padding-left:16px}.channel-dialog-state,.channel-dialog-empty,.channel-dialog-message{margin-right:16px;margin-left:16px}}
</style>
