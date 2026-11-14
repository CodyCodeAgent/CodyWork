<template>
  <div v-if="visible && job" class="modal-backdrop skill-run-backdrop">
    <section class="modal-card skill-run-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-run-title" v-modal-focus tabindex="-1" @keydown.esc.prevent="emit('close')">
      <header class="skill-run-head">
        <div class="skill-run-heading">
          <span :class="['skill-run-state-dot', job.status]" aria-hidden="true" />
          <div><div class="eyebrow">AGENT EXECUTION</div><h2 id="skill-run-title">安装 Workspace Skill</h2></div>
        </div>
        <button class="icon-button" type="button" aria-label="收起 Agent 执行窗口" @click="emit('close')">×</button>
      </header>

      <div class="skill-run-meta" aria-live="polite">
        <span :class="['skill-run-status', job.status]">{{ statusLabel }}</span>
        <span>{{ elapsed }}</span>
        <span>{{ job.events.length }} 个事件</span>
        <code :title="job.source">{{ job.source }}</code>
      </div>

      <div ref="log" class="skill-run-log" role="log" aria-live="polite" aria-relevant="additions text">
        <div v-if="!entries.length && active" class="skill-run-waiting">
          <span class="skill-run-spinner" aria-hidden="true" />
          <div><strong>正在连接 Agent</strong><p>首个执行事件到达后会显示在这里。</p></div>
        </div>
        <article v-for="entry in entries" :key="entry.id" :class="['skill-run-entry', entry.tone]">
          <div class="skill-run-entry-head"><strong>{{ entry.label }}</strong><time v-if="entry.timestamp">{{ formatTime(entry.timestamp) }}</time></div>
          <pre>{{ entry.text }}</pre>
        </article>
        <details v-if="diagnostics.length" class="skill-run-diagnostics">
          <summary>运行诊断 · {{ diagnostics.length }} 条</summary>
          <article v-for="entry in diagnostics" :key="entry.id" class="skill-run-entry">
            <div class="skill-run-entry-head"><strong>{{ entry.label }}</strong><time v-if="entry.timestamp">{{ formatTime(entry.timestamp) }}</time></div>
            <pre>{{ entry.text }}</pre>
          </article>
        </details>
      </div>

      <p v-if="job.message" :class="['skill-run-message', job.status]" role="status">{{ job.message }}</p>
      <footer class="skill-run-actions">
        <p>{{ active ? '任务不设自动超时；收起窗口不会停止执行。' : '执行记录会保留到 CodyWork 服务下次重启。' }}</p>
        <div>
          <button ref="closeButton" class="btn" type="button" @click="emit('close')">{{ active ? '收起' : '关闭' }}</button>
          <button v-if="job.status === 'running'" class="btn skill-pause-button" type="button" :disabled="pausing" @click="emit('pause')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
            {{ pausing ? '暂停中…' : '暂停执行' }}
          </button>
          <button v-else-if="job.status === 'pausing'" class="btn skill-pause-button" type="button" disabled>暂停中…</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { vModalFocus } from '../modalFocus'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { SkillInstallStatus } from '../api'
import { formatSkillInstallDuration, presentSkillInstallEvents, skillInstallIsActive, skillInstallStatusLabel } from '../skillInstallPresentation'

const props = defineProps<{ visible: boolean; job: SkillInstallStatus | null; pausing: boolean }>()
const emit = defineEmits<{ close: []; pause: [] }>()
const log = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const now = ref(Date.now())
const timer = window.setInterval(() => { now.value = Date.now() }, 1_000)
// Keep transport bookkeeping available without interrupting the execution narrative.
const diagnosticTypes = new Set(['provider.extension', 'command.bound', 'thread.context.updated'])
const allEntries = computed(() => presentSkillInstallEvents(props.job?.events ?? []))
const entries = computed(() => allEntries.value.filter(entry => !diagnosticTypes.has(entry.type)))
const diagnostics = computed(() => allEntries.value.filter(entry => diagnosticTypes.has(entry.type)))
const active = computed(() => props.job ? skillInstallIsActive(props.job.status) : false)
const statusLabel = computed(() => props.job ? skillInstallStatusLabel(props.job.status) : '')
const elapsed = computed(() => props.job ? formatSkillInstallDuration(props.job.startedAt, props.job.finishedAt, now.value) : '')

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour12: false })
}

watch([() => props.visible, () => props.job?.events.length], async ([visible], [wasVisible]) => {
  if (!visible) return
  const followLatest = !wasVisible || !log.value || log.value.scrollHeight - log.value.scrollTop - log.value.clientHeight < 48
  await nextTick()
  if (log.value && followLatest) log.value.scrollTop = log.value.scrollHeight
}, { immediate: true })

watch([() => props.job?.status, () => props.pausing], async ([status, pausing]) => {
  if ((status === 'running' && !pausing) || !props.visible || !(document.activeElement instanceof HTMLElement)) return
  const losingFocus = document.activeElement.matches('.skill-pause-button')
    && document.activeElement.closest('.skill-run-dialog')?.contains(closeButton.value ?? null)
  if (!losingFocus) return
  await nextTick()
  closeButton.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => window.clearInterval(timer))
</script>

<style scoped>
.skill-run-meta>span{flex-shrink:0;white-space:nowrap}
.skill-run-meta code{flex:1}
@media(max-width:700px){.skill-run-meta code{flex-basis:100%}}
.skill-run-diagnostics{margin-top:18px;border-top:1px solid var(--border-default);padding-top:12px;color:var(--ink-secondary)}
.skill-run-diagnostics summary{min-height:44px;display:list-item;align-content:center;cursor:pointer;font-size:13px;font-weight:600}
.skill-run-diagnostics summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:var(--radius-sm)}
.skill-run-diagnostics article{margin-left:8px}
.skill-run-backdrop{padding:24px}.skill-run-dialog{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto;width:min(920px,100%);height:min(760px,calc(100dvh - 48px));padding:0;overflow:hidden;border: 1px solid var(--border-default);outline:0}.skill-run-head{display:flex;align-items:center;justify-content:space-between;padding:22px 24px 16px;border-bottom: 1px solid var(--border-default);}.skill-run-heading{display:flex;align-items:center;gap:12px;min-width:0}.skill-run-head>.icon-button,.skill-run-state-dot{flex-shrink:0}.skill-run-heading h2{margin:4px 0 0;color: var(--ink-primary);font-size:20px}.skill-run-state-dot{width:12px;height:12px;background: var(--surface-subtle);border-radius:50%;box-shadow: var(--shadow-panel);}.skill-run-state-dot.running{background: var(--accent);box-shadow: var(--shadow-panel);animation:pulse 1.8s ease-in-out infinite}.skill-run-state-dot.pausing{background: var(--warning);box-shadow: var(--shadow-panel);}.skill-run-state-dot.paused{background: var(--surface-subtle);}.skill-run-state-dot.completed{background: var(--success);box-shadow: var(--shadow-panel);}.skill-run-state-dot.failed{background: var(--danger);box-shadow: var(--shadow-panel);}.skill-run-meta{display:flex;align-items:center;gap:9px;min-width:0;padding:12px 24px;color: var(--ink-tertiary);background: var(--surface-panel);border-bottom: 1px solid var(--border-default);font-size:13px}.skill-run-meta code{min-width:0;margin-left:auto;overflow:hidden;color: var(--ink-secondary);font:12px var(--mono);text-overflow:ellipsis;white-space:nowrap}.skill-run-status{padding:4px 8px;color: var(--accent);background: var(--surface-panel);border-radius:999px;font-weight:750}.skill-run-status.completed{color: var(--success);background: var(--success-bg);}.skill-run-status.failed{color: var(--danger);background: var(--danger-bg);}.skill-run-status.paused,.skill-run-status.pausing{color: var(--warning);background: var(--warning-bg);}.skill-run-log{overflow:auto;padding:18px 24px;background: var(--surface-panel);scrollbar-color: var(--border-default) transparent;}.skill-run-entry{position:relative;padding:0 0 18px 20px;color: var(--ink-tertiary);border-left: 1px solid var(--border-default);}.skill-run-entry::before{content:"";position:absolute;top:5px;left:-4px;width:7px;height:7px;background: var(--surface-subtle);border: 2px solid var(--border-default);border-radius:50%}.skill-run-entry.active::before{background: var(--accent);}.skill-run-entry.success::before{background: var(--success);}.skill-run-entry.danger::before{background: var(--danger);}.skill-run-entry:last-child{padding-bottom:2px}.skill-run-entry-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:6px}.skill-run-entry-head strong{color: var(--ink-primary);font-size:13px}.skill-run-entry-head time{color: var(--ink-secondary);font:11px var(--mono)}.skill-run-entry pre{max-width:75ch;max-height:280px;overflow:auto;margin:0;color: var(--code-text);font:12px/1.7 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}.skill-run-waiting{display:flex;align-items:center;justify-content:center;gap:13px;height:100%;min-height:240px;color: var(--ink-tertiary);}.skill-run-waiting strong{color: var(--ink-primary);font-size:12px}.skill-run-waiting p{margin:4px 0 0;font-size:12px}.skill-run-spinner{width:20px;height:20px;border: 2px solid var(--border-default);border-top-color: var(--accent-border);border-radius:50%;animation:spin .8s linear infinite}.skill-run-message{padding:11px 24px;margin:0;color: var(--ink-secondary);background: var(--surface-panel);border-top: 1px solid var(--border-default);font-size:13px}.skill-run-message.completed{color: var(--success);background: var(--surface-subtle);}.skill-run-message.failed{color: var(--danger);background: var(--surface-panel);}.skill-run-message.paused,.skill-run-message.pausing{color: var(--warning);background: var(--warning-bg);}.skill-run-actions{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 24px;background: var(--surface-panel);border-top: 1px solid var(--border-default);}.skill-run-actions p{margin:0;color: var(--ink-tertiary);font-size:12px}.skill-run-actions>div{display:flex;gap:8px}.skill-run-actions .btn{min-height:44px}.skill-pause-button{display:inline-flex;align-items:center;gap:7px;color: var(--warning)!important;background: var(--warning-bg)!important;border-color: var(--warning-border)!important;}.skill-pause-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}@keyframes pulse{50%{box-shadow: var(--shadow-panel);}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:700px){.skill-run-backdrop{padding:10px}.skill-run-dialog{height:calc(100dvh - 20px)}.skill-run-meta{align-items:flex-start;flex-wrap:wrap}.skill-run-meta code{width:100%;margin-left:0}.skill-run-actions{align-items:stretch;flex-direction:column}.skill-run-actions>div{justify-content:flex-end}}@media(prefers-reduced-motion:reduce){.skill-run-state-dot.running,.skill-run-spinner{animation:none}}
</style>
