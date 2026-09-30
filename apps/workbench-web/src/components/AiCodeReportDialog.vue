<template>
  <Teleport to="body">
    <div v-if="visible" class="ai-report-backdrop" @click.self="emit('close')">
      <section class="ai-report-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-report-title">
        <header class="ai-report-head">
          <div>
            <div class="ai-report-kicker">AI CODE REPORT</div>
            <h2 id="ai-report-title">AI 代码上报</h2>
            <p>展示 TEA 接收回执、可归因的 patch 行数和当前 Worktree 变更；不会将代码正文复制到 CodyWork。</p>
          </div>
          <button class="ai-report-close" type="button" aria-label="关闭代码上报详情" :disabled="action !== ''" @click="emit('close')">×</button>
        </header>

        <div v-if="loading && !summary" class="ai-report-loading" role="status" aria-live="polite"><span class="ai-report-loading-spinner" aria-hidden="true" />正在读取本机上报回执…</div>
        <template v-else-if="summary">
          <div :class="['ai-report-capability', summary.capability.state]">
            <span :class="['ai-report-state-dot', summary.state]" />
            <div><strong>{{ stateLabel(summary.state) }}</strong><p>{{ summary.capability.message }}</p></div>
            <button type="button" :disabled="loading || action !== ''" @click="emit('refresh')">{{ loading ? '刷新中…' : '刷新' }}</button>
          </div>

          <div class="ai-report-metrics" aria-label="AI 代码上报统计">
            <article><small>TEA 已接收</small><strong>{{ formatNumber(summary.acceptedEvents) }}</strong><span>{{ summary.acceptedCodeEvents }} 条代码事件</span></article>
            <article><small>AI 行级归因</small><strong>{{ summary.lineStatsAvailable ? `+${formatNumber(summary.additions)}` : '—' }}</strong><span>{{ summary.lineStatsAvailable ? `删除 ${formatNumber(summary.deletions)} 行` : 'TraeX 生产回执未保留 patch 行级信息' }}</span></article>
            <article class="effective"><small>当前有效 AI 代码</small><strong>{{ summary.effectiveLines === null ? '—' : formatNumber(summary.effectiveLines) }}</strong><span>{{ summary.effectiveLinesNote }}</span></article>
            <article class="worktree"><small>当前 Worktree 变更</small><strong>{{ summary.worktreeChanges.available ? `+${formatNumber(summary.worktreeChanges.additions)} / −${formatNumber(summary.worktreeChanges.deletions)}` : '—' }}</strong><span>{{ summary.worktreeChanges.note }}</span></article>
            <article><small>投递队列</small><strong>{{ formatNumber(summary.pending + summary.retrying) }}</strong><span>{{ summary.pending }} 等待 · {{ summary.retrying }} 重试</span></article>
          </div>

          <div v-if="codexHookWarning" class="ai-report-warning" role="status">
            <strong>Codex 上报配置不完整</strong>
            <span>缺少 Hook：{{ summary.capability.missingHooks.join('、') }}。这仅影响当前需求中的 {{ codexConversationCount }} 个 Codex 会话；TraeX 已确认接收的代码事件不受影响。</span>
          </div>
          <div class="ai-report-sources" aria-label="上报来源状态">
            <span v-for="source in summary.capability.sources" :key="source.id" :class="['ai-report-source', source.state]" :title="source.message">
              {{ source.label }} · {{ sourceLabel(source.state) }}
            </span>
          </div>
          <div v-if="summary.warning" class="ai-report-warning" role="status">读取部分回执失败：{{ summary.warning }}</div>
          <div v-if="error" class="ai-report-error" role="alert">{{ error }}</div>
          <div v-if="message" class="ai-report-message" role="status">{{ message }}</div>

          <section class="ai-report-section">
            <div class="ai-report-section-head"><div><strong>按会话</strong><span>通过原生会话 ID 精确关联到当前需求</span></div><span>{{ summary.conversations.length }} 个会话</span></div>
            <div class="ai-report-conversations">
              <article v-for="conversation in summary.conversations" :key="conversation.conversationId">
                <div><strong>{{ conversation.title }}</strong><code>{{ conversation.runtimeType === 'trae' ? 'Trae ACP' : 'Codex' }} · {{ shortId(conversation.nativeSessionId) }}</code></div>
                <div class="ai-report-conversation-stats"><span>{{ conversation.acceptedEvents }} 条已接收</span><span v-if="conversation.runtimeType === 'trae'">{{ conversation.acceptedCodeEvents }} 条代码事件</span><template v-else><span class="added">+{{ conversation.additions }}</span><span class="deleted">−{{ conversation.deletions }}</span></template><time>{{ formatTime(conversation.lastSuccessAt) }}</time></div>
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
                <div class="ai-report-receipt-lines"><span v-if="receipt.eventType === 'ai_contribution_delivery'">{{ receipt.eventCount }} 条代码事件</span><template v-else><span v-if="receipt.additions" class="added">+{{ receipt.additions }}</span><span v-if="receipt.deletions" class="deleted">−{{ receipt.deletions }}</span></template><time>{{ formatTime(receipt.receivedAt) }}</time></div>
              </article>
              <p v-if="summary.recent.length === 0" class="ai-report-empty">还没有匹配当前需求的 TEA 接收回执。</p>
            </div>
          </section>

          <footer v-if="hasCodexConversations" class="ai-report-actions">
            <div><strong>Codex 手动操作</strong><span>补扫只处理当前需求的 Codex 会话；TraeX 由其插件自动投递，不使用这些操作。</span></div>
            <button type="button" :disabled="action !== '' || !summary.capability.retryAvailable" @click="emit('retry')">{{ action === 'retry' ? '重试中…' : '重试 Codex 待发送' }}</button>
            <button class="primary" type="button" :disabled="action !== '' || !summary.capability.exportAvailable" @click="emit('backfill')">{{ action === 'backfill' ? '补扫中…' : '补扫 Codex 会话' }}</button>
          </footer>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AiReportCapabilityState, AiReportDemandSummary, AiReportState } from '../api'

const props = defineProps<{
  visible: boolean
  summary: AiReportDemandSummary | null
  loading: boolean
  action: '' | 'backfill' | 'retry'
  error: string
  message: string
}>()

const codexConversationCount = computed(() => props.summary?.conversations.filter(conversation => conversation.runtimeType === 'codex').length ?? 0)
const hasCodexConversations = computed(() => codexConversationCount.value > 0)
const codexHookWarning = computed(() => hasCodexConversations.value && (props.summary?.capability.missingHooks.length ?? 0) > 0)

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

function sourceLabel(state: AiReportCapabilityState): string {
  if (state === 'ready') return '可读取'
  if (state === 'partial') return '配置不完整'
  if (state === 'unavailable') return '不可用'
  return '未安装'
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
.ai-report-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:72px;text-align:center;color:#7b879b}.ai-report-loading-spinner{width:18px;height:18px;border:2px solid #dbe3f4;border-top-color:#5b5cf0;border-radius:50%;animation:ai-report-spin .75s linear infinite}@keyframes ai-report-spin{to{transform:rotate(360deg)}}.ai-report-capability{display:flex;align-items:center;gap:12px;margin:24px 34px 0;padding:14px 16px;border:1px solid #dfe7f1;border-radius:14px;background:#f8fafc}.ai-report-capability>div{flex:1}.ai-report-capability strong{display:block;font-size:15px}.ai-report-capability p{margin:3px 0 0;color:#718096;font-size:13px}.ai-report-capability button{padding:6px 8px;border:0;border-radius:7px;background:transparent;color:#5865d8;font-weight:700;cursor:pointer;transition:color .16s,background .16s}.ai-report-capability button:hover:not(:disabled){background:#edf0ff;color:#4548b9}.ai-report-capability button:focus-visible{outline:3px solid rgba(91,92,240,.2);outline-offset:2px}.ai-report-state-dot{width:10px;height:10px;border-radius:50%;background:#94a3b8}.ai-report-state-dot.healthy{background:#22b573}.ai-report-state-dot.pending{background:#eab308}.ai-report-state-dot.retrying,.ai-report-state-dot.degraded{background:#f97316}.ai-report-state-dot.not_installed{background:#94a3b8}
.ai-report-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;padding:16px 34px}.ai-report-metrics article{display:flex;min-height:112px;flex-direction:column;padding:17px;border:1px solid #e4e9f2;border-radius:15px;background:#fbfcfe}.ai-report-metrics article.effective{border-color:#d9dcff;background:#f7f7ff}.ai-report-metrics article.worktree{border-color:#cde8df;background:#f4fbf8}.ai-report-metrics small{color:#8290a6;font-weight:700}.ai-report-metrics strong{margin:7px 0 5px;font-size:28px}.ai-report-metrics span{color:#78859a;font-size:12px;line-height:1.45}
.ai-report-warning,.ai-report-error,.ai-report-message{margin:0 34px 12px;padding:11px 14px;border-radius:11px;font-size:13px;line-height:1.55}.ai-report-warning{display:grid;gap:3px;border:1px solid #f3d69d;background:#fff8e8;color:#8a5a0a}.ai-report-warning strong{font-size:13px}.ai-report-error{border:1px solid #f5c2c2;background:#fff2f2;color:#b42318}.ai-report-message{border:1px solid #bae5cd;background:#effbf4;color:#19764b}
.ai-report-sources{display:flex;flex-wrap:wrap;gap:8px;margin:0 34px 12px}.ai-report-source{padding:5px 8px;border:1px solid #dfe7f1;border-radius:999px;background:#f8fafc;color:#64748b;font-size:12px}.ai-report-source.ready{border-color:#b8e4cc;background:#effbf4;color:#19764b}.ai-report-source.partial,.ai-report-source.unavailable{border-color:#f3d69d;background:#fff8e8;color:#8a5a0a}
.ai-report-section{min-height:0;margin:4px 34px 14px;border:1px solid #e2e8f0;border-radius:15px;overflow:hidden}.ai-report-section-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8fafc}.ai-report-section-head>div{display:flex;align-items:baseline;gap:10px}.ai-report-section-head span{color:#8490a4;font-size:12px}.ai-report-conversations,.ai-report-receipts{max-height:190px;overflow:auto}.ai-report-conversations article,.ai-report-receipts article{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #edf1f6}.ai-report-conversations article:first-child,.ai-report-receipts article:first-child{border-top:0}.ai-report-conversations article>div:first-child,.ai-report-receipts article>div:nth-child(2){display:flex;min-width:0;flex:1;flex-direction:column}.ai-report-conversations code,.ai-report-receipts small{margin-top:3px;overflow:hidden;color:#8793a8;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.ai-report-conversation-stats,.ai-report-receipt-lines{display:flex;align-items:center;gap:12px;color:#68758a;font-size:12px}.ai-report-conversation-stats time,.ai-report-receipt-lines time{min-width:122px;text-align:right}.added{color:#168557}.deleted{color:#c24c4c}.ai-report-receipt-icon{display:grid;width:28px;height:28px;place-items:center;border-radius:8px;background:#eef0ff;color:#5b5ce2;font-weight:800}.ai-report-empty{margin:0;padding:28px;text-align:center;color:#8a96a9}
.ai-report-actions{display:flex;align-items:center;gap:10px;padding:18px 34px 24px;border-top:1px solid #e7ebf2}.ai-report-actions>div{display:flex;min-width:0;flex:1;flex-direction:column}.ai-report-actions>div span{margin-top:3px;color:#8793a8;font-size:12px}.ai-report-actions button{padding:10px 16px;border:1px solid #d7deea;border-radius:10px;background:#fff;color:#3e4b61;font-weight:700;cursor:pointer;transition:color .16s,background .16s,border-color .16s,box-shadow .16s}.ai-report-actions button:hover:not(:disabled){border-color:#bdc8df;background:#f8fafc;box-shadow:0 3px 9px rgba(15,23,42,.06)}.ai-report-actions button.primary{border-color:#5b5cf0;background:#5b5cf0;color:#fff}.ai-report-actions button.primary:hover:not(:disabled){background:#494ad2;border-color:#494ad2}.ai-report-actions button:focus-visible,.ai-report-close:focus-visible{outline:3px solid rgba(91,92,240,.22);outline-offset:2px}.ai-report-actions button:disabled{cursor:not-allowed;opacity:.5}@media (prefers-reduced-motion:reduce){.ai-report-loading-spinner{animation-duration:2s}}@media (max-width:1080px){.ai-report-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}}@media (max-width:840px){.ai-report-backdrop{padding:12px}.ai-report-dialog{width:100%;max-height:calc(100vh - 24px)}.ai-report-head{padding:22px}.ai-report-metrics{grid-template-columns:repeat(2,minmax(0,1fr));padding:14px 22px}.ai-report-capability,.ai-report-section,.ai-report-warning,.ai-report-error,.ai-report-message,.ai-report-sources{margin-left:22px;margin-right:22px}.ai-report-actions{align-items:stretch;flex-wrap:wrap;padding:16px 22px}.ai-report-actions>div{flex-basis:100%}.ai-report-conversation-stats{display:grid;grid-template-columns:auto auto}.ai-report-conversation-stats time{grid-column:1/-1}}@media (max-width:560px){.ai-report-head{gap:14px;padding:18px}.ai-report-head h2{font-size:24px}.ai-report-head p{font-size:12px}.ai-report-metrics{grid-template-columns:1fr;padding:12px 18px}.ai-report-metrics article{min-height:0}.ai-report-capability,.ai-report-section,.ai-report-warning,.ai-report-error,.ai-report-message,.ai-report-sources{margin-left:18px;margin-right:18px}.ai-report-capability{align-items:flex-start}.ai-report-conversations article,.ai-report-receipts article{align-items:flex-start;flex-wrap:wrap}.ai-report-conversation-stats,.ai-report-receipt-lines{width:100%;padding-left:0}.ai-report-actions{padding:14px 18px}.ai-report-actions button{width:100%}}
</style>
