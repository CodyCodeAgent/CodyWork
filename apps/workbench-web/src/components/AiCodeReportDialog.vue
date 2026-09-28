<template>
  <Teleport to="body">
    <div v-if="visible" class="ai-report-backdrop" @click.self="emit('close')">
      <section class="ai-report-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-report-title">
        <header class="ai-report-head">
          <div>
            <div class="ai-report-kicker">AI CODE REPORT</div>
            <h2 id="ai-report-title">AI 代码上报</h2>
            <p>展示 TEA 接收回执和基于同一批代码 patch 计算的行数；不会将代码正文复制到 CodyWork。</p>
          </div>
          <button class="ai-report-close" type="button" aria-label="关闭代码上报详情" :disabled="action !== ''" @click="emit('close')">×</button>
        </header>

        <div v-if="loading && !summary" class="ai-report-loading">正在读取本机上报回执…</div>
        <template v-else-if="summary">
          <div :class="['ai-report-capability', summary.capability.state]">
            <span :class="['ai-report-state-dot', summary.state]" />
            <div><strong>{{ stateLabel(summary.state) }}</strong><p>{{ summary.capability.message }}</p></div>
            <button type="button" :disabled="loading || action !== ''" @click="emit('refresh')">{{ loading ? '刷新中…' : '刷新' }}</button>
          </div>

          <div class="ai-report-metrics" aria-label="AI 代码上报统计">
            <article><small>TEA 已接收</small><strong>{{ formatNumber(summary.acceptedEvents) }}</strong><span>{{ summary.acceptedCodeEvents }} 条代码事件</span></article>
            <article><small>累计新增</small><strong>+{{ formatNumber(summary.additions) }}</strong><span>删除 {{ formatNumber(summary.deletions) }} 行</span></article>
            <article class="effective"><small>当前有效 AI 代码</small><strong>{{ summary.effectiveLines === null ? '—' : formatNumber(summary.effectiveLines) }}</strong><span>{{ summary.effectiveLinesNote }}</span></article>
            <article><small>投递队列</small><strong>{{ formatNumber(summary.pending + summary.retrying) }}</strong><span>{{ summary.pending }} 等待 · {{ summary.retrying }} 重试</span></article>
          </div>

          <div v-if="summary.capability.missingHooks.length" class="ai-report-warning" role="status">
            缺少 Hook：{{ summary.capability.missingHooks.join('、') }}。当前统计可能遗漏脚本或格式化器产生的文件变更。
          </div>
          <div v-if="summary.warning" class="ai-report-warning" role="status">读取部分回执失败：{{ summary.warning }}</div>
          <div v-if="error" class="ai-report-error" role="alert">{{ error }}</div>
          <div v-if="message" class="ai-report-message" role="status">{{ message }}</div>

          <section class="ai-report-section">
            <div class="ai-report-section-head"><div><strong>按会话</strong><span>通过原生 Codex Session ID 精确关联到当前需求</span></div><span>{{ summary.conversations.length }} 个会话</span></div>
            <div class="ai-report-conversations">
              <article v-for="conversation in summary.conversations" :key="conversation.conversationId">
                <div><strong>{{ conversation.title }}</strong><code>{{ shortId(conversation.nativeSessionId) }}</code></div>
                <div class="ai-report-conversation-stats"><span>{{ conversation.acceptedEvents }} 条已接收</span><span class="added">+{{ conversation.additions }}</span><span class="deleted">−{{ conversation.deletions }}</span><time>{{ formatTime(conversation.lastSuccessAt) }}</time></div>
              </article>
              <p v-if="summary.conversations.length === 0" class="ai-report-empty">当前需求还没有会话。</p>
            </div>
          </section>

          <section class="ai-report-section">
            <div class="ai-report-section-head"><div><strong>最近接收</strong><span>仅展示元数据和行数，不展示 patch 或命令正文</span></div><span>{{ summary.recent.length }} 条</span></div>
            <div class="ai-report-receipts">
              <article v-for="receipt in summary.recent" :key="receipt.deliveryId">
                <span class="ai-report-receipt-icon">{{ receipt.additions + receipt.deletions > 0 ? '±' : '✓' }}</span>
                <div><strong>{{ receipt.filePath || receipt.toolName || eventLabel(receipt.eventType) }}</strong><small>{{ receipt.conversationTitle }} · {{ receipt.model || 'Codex' }}</small></div>
                <div class="ai-report-receipt-lines"><span v-if="receipt.additions" class="added">+{{ receipt.additions }}</span><span v-if="receipt.deletions" class="deleted">−{{ receipt.deletions }}</span><time>{{ formatTime(receipt.receivedAt) }}</time></div>
              </article>
              <p v-if="summary.recent.length === 0" class="ai-report-empty">还没有匹配当前需求的 TEA 接收回执。</p>
            </div>
          </section>

          <footer class="ai-report-actions">
            <div><strong>手动操作</strong><span>补扫只处理当前需求会话；重试会处理本机共享的 pending/outbox 队列。</span></div>
            <button type="button" :disabled="action !== '' || !summary.capability.retryAvailable" @click="emit('retry')">{{ action === 'retry' ? '重试中…' : '重试待发送' }}</button>
            <button class="primary" type="button" :disabled="action !== '' || !summary.capability.exportAvailable" @click="emit('backfill')">{{ action === 'backfill' ? '补扫中…' : '补扫当前需求' }}</button>
          </footer>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { AiReportDemandSummary, AiReportState } from '../api'

defineProps<{
  visible: boolean
  summary: AiReportDemandSummary | null
  loading: boolean
  action: '' | 'backfill' | 'retry'
  error: string
  message: string
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  backfill: []
  retry: []
}>()

function stateLabel(state: AiReportState): string {
  if (state === 'healthy') return 'TEA 上报正常'
  if (state === 'pending') return '存在等待上报记录'
  if (state === 'retrying') return '存在失败重试记录'
  if (state === 'degraded') return '上报能力不完整'
  if (state === 'not_installed') return '当前机器未安装'
  return '等待首次代码上报'
}

function eventLabel(event: string): string {
  if (event === 'dev_agent_tokens_collect') return 'Token 用量'
  if (event === 'dev_agent_trace_collect') return '会话汇总'
  if (event === 'dev_agent_trace') return 'Hook 链路'
  return event || '上报事件'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatTime(value: string | null): string {
  if (!value) return '尚无记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function shortId(value: string): string {
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}
</script>

<style scoped>
.ai-report-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:32px;background:rgba(15,23,42,.56);backdrop-filter:blur(5px)}
.ai-report-dialog{display:flex;flex-direction:column;width:min(1040px,calc(100vw - 48px));max-height:min(900px,calc(100vh - 48px));overflow:hidden;border:1px solid #dce3ef;border-radius:24px;background:#fff;box-shadow:0 30px 90px rgba(15,23,42,.28);color:#202636}
.ai-report-head{display:flex;justify-content:space-between;gap:28px;padding:30px 34px 24px;border-bottom:1px solid #e8edf5}.ai-report-head h2{margin:5px 0 8px;font-size:30px}.ai-report-head p{margin:0;color:#778399;line-height:1.6}.ai-report-kicker{color:#8793a8;font-size:12px;font-weight:800;letter-spacing:.22em}.ai-report-close{width:44px;height:44px;border:0;border-radius:12px;background:#f1f4f8;color:#64748b;font-size:30px;cursor:pointer}.ai-report-close:disabled{opacity:.55}
.ai-report-loading{padding:72px;text-align:center;color:#7b879b}.ai-report-capability{display:flex;align-items:center;gap:12px;margin:24px 34px 0;padding:14px 16px;border:1px solid #dfe7f1;border-radius:14px;background:#f8fafc}.ai-report-capability>div{flex:1}.ai-report-capability strong{display:block;font-size:15px}.ai-report-capability p{margin:3px 0 0;color:#718096;font-size:13px}.ai-report-capability button{border:0;background:transparent;color:#5865d8;font-weight:700;cursor:pointer}.ai-report-state-dot{width:10px;height:10px;border-radius:50%;background:#94a3b8}.ai-report-state-dot.healthy{background:#22b573}.ai-report-state-dot.pending{background:#eab308}.ai-report-state-dot.retrying,.ai-report-state-dot.degraded{background:#f97316}.ai-report-state-dot.not_installed{background:#94a3b8}
.ai-report-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:16px 34px}.ai-report-metrics article{display:flex;min-height:112px;flex-direction:column;padding:17px;border:1px solid #e4e9f2;border-radius:15px;background:#fbfcfe}.ai-report-metrics article.effective{border-color:#d9dcff;background:#f7f7ff}.ai-report-metrics small{color:#8290a6;font-weight:700}.ai-report-metrics strong{margin:7px 0 5px;font-size:28px}.ai-report-metrics span{color:#78859a;font-size:12px;line-height:1.45}
.ai-report-warning,.ai-report-error,.ai-report-message{margin:0 34px 12px;padding:11px 14px;border-radius:11px;font-size:13px;line-height:1.55}.ai-report-warning{border:1px solid #f3d69d;background:#fff8e8;color:#8a5a0a}.ai-report-error{border:1px solid #f5c2c2;background:#fff2f2;color:#b42318}.ai-report-message{border:1px solid #bae5cd;background:#effbf4;color:#19764b}
.ai-report-section{min-height:0;margin:4px 34px 14px;border:1px solid #e2e8f0;border-radius:15px;overflow:hidden}.ai-report-section-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8fafc}.ai-report-section-head>div{display:flex;align-items:baseline;gap:10px}.ai-report-section-head span{color:#8490a4;font-size:12px}.ai-report-conversations,.ai-report-receipts{max-height:190px;overflow:auto}.ai-report-conversations article,.ai-report-receipts article{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #edf1f6}.ai-report-conversations article:first-child,.ai-report-receipts article:first-child{border-top:0}.ai-report-conversations article>div:first-child,.ai-report-receipts article>div:nth-child(2){display:flex;min-width:0;flex:1;flex-direction:column}.ai-report-conversations code,.ai-report-receipts small{margin-top:3px;overflow:hidden;color:#8793a8;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.ai-report-conversation-stats,.ai-report-receipt-lines{display:flex;align-items:center;gap:12px;color:#68758a;font-size:12px}.ai-report-conversation-stats time,.ai-report-receipt-lines time{min-width:122px;text-align:right}.added{color:#168557}.deleted{color:#c24c4c}.ai-report-receipt-icon{display:grid;width:28px;height:28px;place-items:center;border-radius:8px;background:#eef0ff;color:#5b5ce2;font-weight:800}.ai-report-empty{margin:0;padding:28px;text-align:center;color:#8a96a9}
.ai-report-actions{display:flex;align-items:center;gap:10px;padding:18px 34px 24px;border-top:1px solid #e7ebf2}.ai-report-actions>div{display:flex;min-width:0;flex:1;flex-direction:column}.ai-report-actions>div span{margin-top:3px;color:#8793a8;font-size:12px}.ai-report-actions button{padding:10px 16px;border:1px solid #d7deea;border-radius:10px;background:#fff;color:#3e4b61;font-weight:700;cursor:pointer}.ai-report-actions button.primary{border-color:#5b5cf0;background:#5b5cf0;color:#fff}.ai-report-actions button:disabled{cursor:not-allowed;opacity:.5}
@media (max-width:840px){.ai-report-backdrop{padding:12px}.ai-report-dialog{width:100%;max-height:calc(100vh - 24px)}.ai-report-head{padding:22px}.ai-report-metrics{grid-template-columns:repeat(2,minmax(0,1fr));padding:14px 22px}.ai-report-capability,.ai-report-section,.ai-report-warning,.ai-report-error,.ai-report-message{margin-left:22px;margin-right:22px}.ai-report-actions{align-items:stretch;flex-wrap:wrap;padding:16px 22px}.ai-report-actions>div{flex-basis:100%}.ai-report-conversation-stats{display:grid;grid-template-columns:auto auto}.ai-report-conversation-stats time{grid-column:1/-1}}
</style>
