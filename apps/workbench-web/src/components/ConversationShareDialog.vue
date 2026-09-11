<template>
  <div v-if="visible" class="modal-backdrop" @click.self="close">
    <section class="modal-card conversation-share-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-share-title">
      <div class="modal-head">
        <div><div class="eyebrow">SHARE CONVERSATION</div><h2 id="conversation-share-title">导出为飞书文档</h2></div>
        <button class="icon-button" type="button" aria-label="关闭分享会话弹窗" :disabled="sharing" @click="close">×</button>
      </div>

      <template v-if="result">
        <div class="share-success" role="status">
          <span aria-hidden="true">✓</span>
          <div><strong>飞书文档已创建</strong><p>已导出 {{ result.messageCount }} 条用户与 AI 文字消息。</p></div>
        </div>
        <div class="share-document-result">
          <strong>{{ result.title }}</strong>
          <small>组织内持链接者可查看 · 静态快照</small>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="$emit('copy', result.url)">复制链接</button>
          <a class="btn primary" :href="result.url" target="_blank" rel="noopener noreferrer">打开飞书文档</a>
        </div>
      </template>

      <template v-else>
        <p class="share-description">从原生 Codex Thread 生成一次性快照，只保留用户文字输入和 AI 文字输出。</p>
        <div class="share-scope">
          <span>会保留</span><strong>文字、列表、代码块和链接</strong>
          <span>不会导出</span><strong>思考、工具调用、命令日志、图片和审批过程</strong>
        </div>

        <label for="conversation-share-document-title">文档名称</label>
        <input id="conversation-share-document-title" class="input" :value="title" maxlength="200" autocomplete="off" @input="$emit('update:title', ($event.target as HTMLInputElement).value)" />

        <label for="conversation-share-account">创建文档的机器人</label>
        <select id="conversation-share-account" class="input" :value="accountId" @change="$emit('update:accountId', ($event.target as HTMLSelectElement).value)">
          <option value="" disabled>请选择已启用的飞书机器人</option>
          <option v-for="account in enabledAccounts" :key="account.id" :value="account.id">{{ account.botName || account.name }}{{ account.connectionState === 'connected' ? ' · 已连接' : '' }}</option>
        </select>
        <p v-if="!enabledAccounts.length" class="form-error" role="alert">当前没有已启用的飞书机器人，请先到设置中完成配置。</p>
        <p class="share-permission-note">创建后会设置为“组织内持链接者可查看”。每次导出都会生成一份新的静态文档，不会与会话持续同步。</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" :disabled="sharing" @click="close">取消</button>
          <button class="btn primary" type="button" :disabled="sharing || !title.trim() || !accountId || !enabledAccounts.length" @click="$emit('share')">{{ sharing ? '正在创建飞书文档…' : '创建飞书文档' }}</button>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ConversationShareResult, FeishuChannelAccount } from '../api'

const props = defineProps<{
  visible: boolean
  title: string
  accountId: string
  accounts: FeishuChannelAccount[]
  sharing: boolean
  error: string
  result: ConversationShareResult | null
}>()

const emit = defineEmits<{
  close: []
  share: []
  copy: [url: string]
  'update:title': [value: string]
  'update:accountId': [value: string]
}>()

const enabledAccounts = computed(() => props.accounts.filter(account => account.enabled && account.appSecretConfigured))

function close(): void {
  if (!props.sharing) emit('close')
}
</script>

<style scoped>
.conversation-share-dialog { width: min(600px, 100%); }
.share-description { margin: 10px 0 16px; color: #66748c; font-size: 13px; line-height: 1.7; }
.share-scope { display: grid; grid-template-columns: 72px 1fr; gap: 7px 12px; padding: 14px; color: #536078; background: #f6f7fb; border: 1px solid #e6e9f1; border-radius: 11px; font-size: 12px; line-height: 1.55; }
.share-scope span { color: #8a94a7; }
.share-scope strong { color: #3f4b61; font-weight: 650; }
.share-permission-note { margin: 10px 0 0; color: #7b879d; font-size: 11px; line-height: 1.65; }
.share-success { display: flex; gap: 12px; align-items: center; margin: 18px 0; padding: 16px; color: #226b4a; background: #eefaf4; border: 1px solid #cfeedd; border-radius: 12px; }
.share-success > span { display: grid; width: 30px; height: 30px; place-items: center; color: #fff; background: #36a66f; border-radius: 50%; font-weight: 800; }
.share-success strong, .share-success p, .share-document-result strong, .share-document-result small { display: block; }
.share-success p { margin: 4px 0 0; color: #60836f; font-size: 12px; }
.share-document-result { padding: 15px; background: #f6f7fb; border: 1px solid #e3e7ef; border-radius: 11px; }
.share-document-result strong { color: #344056; }
.share-document-result small { margin-top: 5px; color: #8993a5; }
.modal-actions a { text-decoration: none; }
</style>
