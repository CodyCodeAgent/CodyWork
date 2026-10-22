<template>
  <section class="recipient-fields">
    <label v-if="!alwaysEnabled" class="check"><input type="checkbox" :checked="enabled" :disabled="disabled" @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)" />同时发送飞书通知</label>
    <p class="hint">结果始终保存在站内通知中心。飞书为可选渠道，这里填写邮箱，不是发送邮件。</p>
    <template v-if="enabled || alwaysEnabled">
      <div class="fields"><label>发送机器人<select :value="accountId" :disabled="disabled || loading" required @change="emit('update:accountId', ($event.target as HTMLSelectElement).value)"><option value="">请选择机器人</option><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.botName || account.name }}</option></select></label>
        <label>接收人企业邮箱<input type="email" :value="email" :disabled="disabled" autocomplete="email" placeholder="name@company.com" required @input="emit('update:email', ($event.target as HTMLInputElement).value)" /></label></div>
      <button type="button" :disabled="disabled || checking || !accountId || !email" @click="validate">{{ checking ? '校验中…' : '校验接收人' }}</button>
      <p v-if="message" :role="failed ? 'alert' : 'status'">{{ message }}</p>
      <p class="hint">以所选应用身份查询；需要 contact:user.id:readonly 权限和接收人的通讯录可见范围。更换机器人后需重新校验。</p>
    </template>
    <p v-if="loadError" role="alert">{{ loadError }}</p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { api, type FeishuChannelAccount } from '../api'
const props = defineProps<{ workspaceId: string; accountId: string; email: string; enabled?: boolean; alwaysEnabled?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:accountId': [value: string]; 'update:email': [value: string]; 'update:enabled': [value: boolean] }>()
const accounts = ref<FeishuChannelAccount[]>([]), loading = ref(false), checking = ref(false), message = ref(''), loadError = ref(''), failed = ref(false)
let version = 0, loadVersion = 0
watch(() => [props.workspaceId, props.accountId, props.email], () => { version++; message.value = ''; checking.value = false })
watch(() => props.workspaceId, async () => {
  const token = ++loadVersion; loading.value = true; loadError.value = ''; accounts.value = []
  try { const result = await api.listFeishuAccounts(); if (token === loadVersion) accounts.value = result.filter(item => item.enabled) }
  catch { if (token === loadVersion) loadError.value = '机器人列表加载失败，请重新打开页面。' }
  finally { if (token === loadVersion) loading.value = false }
}, { immediate: true })
async function validate() {
  const token = ++version; checking.value = true; message.value = ''
  try { await api.validateNotificationRecipient(props.workspaceId, props.accountId, props.email); if (token === version) { failed.value = false; message.value = '接收人校验成功（未发送消息）。' } }
  catch (error) { if (token === version) { failed.value = true; message.value = error instanceof Error ? error.message : String(error) } }
  finally { if (token === version) checking.value = false }
}
onBeforeUnmount(() => { version++; loadVersion++ })
</script>
<style scoped>
.recipient-fields{margin:16px 0;color:var(--text)}.check{display:flex;align-items:center;gap:8px;min-height:44px}.check input{width:auto}.hint{font-size:12px;line-height:1.6;color:var(--muted)}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px}input,select,button{font:inherit;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--card);color:var(--text);min-width:0}button{margin-top:12px;cursor:pointer}button:disabled{opacity:.55;cursor:default}:is(input,select,button):focus-visible{outline:3px solid var(--blue);outline-offset:2px}[role=alert]{color:var(--text);border-left:3px solid var(--blue);padding:8px}@media(max-width:700px){.fields{grid-template-columns:1fr}}
</style>
