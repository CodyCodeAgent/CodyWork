<template>
  <div v-if="visible && job" class="modal-backdrop skill-run-backdrop">
    <section ref="dialog" class="modal-card skill-run-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-run-title" tabindex="-1" @keydown.esc.prevent="emit('close')">
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
        <div v-if="!entries.length" class="skill-run-waiting">
          <span class="skill-run-spinner" aria-hidden="true" />
          <div><strong>正在连接 Agent</strong><p>首个执行事件到达后会显示在这里。</p></div>
        </div>
        <article v-for="entry in entries" :key="entry.id" :class="['skill-run-entry', entry.tone]">
          <div class="skill-run-entry-head"><strong>{{ entry.label }}</strong><time v-if="entry.timestamp">{{ formatTime(entry.timestamp) }}</time></div>
          <pre>{{ entry.text }}</pre>
        </article>
      </div>

      <p v-if="job.message" :class="['skill-run-message', job.status]" role="status">{{ job.message }}</p>
      <footer class="skill-run-actions">
        <p>{{ active ? '任务不设自动超时；收起窗口不会停止执行。' : '执行记录会保留到 CodyWork 服务下次重启。' }}</p>
        <div>
          <button class="btn" type="button" @click="emit('close')">{{ active ? '收起' : '关闭' }}</button>
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { SkillInstallStatus } from '../api'
import { formatSkillInstallDuration, presentSkillInstallEvents, skillInstallIsActive, skillInstallStatusLabel } from '../skillInstallPresentation'

const props = defineProps<{ visible: boolean; job: SkillInstallStatus | null; pausing: boolean }>()
const emit = defineEmits<{ close: []; pause: [] }>()
const dialog = ref<HTMLElement | null>(null)
const log = ref<HTMLElement | null>(null)
const now = ref(Date.now())
const timer = window.setInterval(() => { now.value = Date.now() }, 1_000)
const entries = computed(() => presentSkillInstallEvents(props.job?.events ?? []))
const active = computed(() => props.job ? skillInstallIsActive(props.job.status) : false)
const statusLabel = computed(() => props.job ? skillInstallStatusLabel(props.job.status) : '')
const elapsed = computed(() => props.job ? formatSkillInstallDuration(props.job.startedAt, props.job.finishedAt, now.value) : '')

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour12: false })
}

watch(() => [props.visible, props.job?.events.length] as const, async ([visible]) => {
  if (!visible) return
  await nextTick()
  dialog.value?.focus({ preventScroll: true })
  if (log.value) log.value.scrollTop = log.value.scrollHeight
}, { immediate: true })

onBeforeUnmount(() => window.clearInterval(timer))
</script>

<style scoped>
.skill-run-backdrop{padding:24px}.skill-run-dialog{display:grid;grid-template-rows:auto auto minmax(240px,1fr) auto auto;width:min(920px,100%);height:min(760px,calc(100dvh - 48px));padding:0;overflow:hidden;border:1px solid rgba(255,255,255,.9);outline:0}.skill-run-head{display:flex;align-items:center;justify-content:space-between;padding:22px 24px 16px;border-bottom:1px solid #e8ebf1}.skill-run-heading{display:flex;align-items:center;gap:12px}.skill-run-heading h2{margin:4px 0 0;color:#252e40;font-size:20px}.skill-run-state-dot{width:12px;height:12px;background:#8a94a5;border-radius:50%;box-shadow:0 0 0 5px #f0f2f6}.skill-run-state-dot.running{background:#5b5cf0;box-shadow:0 0 0 5px #eeeeff;animation:pulse 1.8s ease-in-out infinite}.skill-run-state-dot.pausing{background:#c98522;box-shadow:0 0 0 5px #fff3de}.skill-run-state-dot.paused{background:#788397}.skill-run-state-dot.completed{background:#28a875;box-shadow:0 0 0 5px #e6f7ef}.skill-run-state-dot.failed{background:#c4535d;box-shadow:0 0 0 5px #ffebed}.skill-run-meta{display:flex;align-items:center;gap:9px;min-width:0;padding:12px 24px;color:#778398;background:#f8f9fc;border-bottom:1px solid #e9ecf2;font-size:11px}.skill-run-meta code{min-width:0;margin-left:auto;overflow:hidden;color:#566783;font:10px var(--mono);text-overflow:ellipsis;white-space:nowrap}.skill-run-status{padding:4px 8px;color:#505acc;background:#eceeff;border-radius:999px;font-weight:750}.skill-run-status.completed{color:#237d5a;background:#e7f7ef}.skill-run-status.failed{color:#a5434d;background:#fdebed}.skill-run-status.paused,.skill-run-status.pausing{color:#94601a;background:#fff1d7}.skill-run-log{overflow:auto;padding:18px 24px;background:#11151d;scrollbar-color:#3d4657 transparent}.skill-run-entry{position:relative;padding:0 0 18px 20px;color:#b9c2d0;border-left:1px solid #354052}.skill-run-entry::before{content:"";position:absolute;top:5px;left:-4px;width:7px;height:7px;background:#717d90;border:2px solid #11151d;border-radius:50%}.skill-run-entry.active::before{background:#8b8cff}.skill-run-entry.success::before{background:#4ac493}.skill-run-entry.danger::before{background:#ef737e}.skill-run-entry:last-child{padding-bottom:2px}.skill-run-entry-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:6px}.skill-run-entry-head strong{color:#e4e9f1;font-size:11px}.skill-run-entry-head time{color:#687386;font:9px var(--mono)}.skill-run-entry pre{max-width:75ch;max-height:280px;overflow:auto;margin:0;color:#aeb9ca;font:10.5px/1.65 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}.skill-run-waiting{display:flex;align-items:center;justify-content:center;gap:13px;height:100%;min-height:240px;color:#9ba7b8}.skill-run-waiting strong{color:#d9e0ea;font-size:12px}.skill-run-waiting p{margin:4px 0 0;font-size:10px}.skill-run-spinner{width:20px;height:20px;border:2px solid #3d4656;border-top-color:#8b8cff;border-radius:50%;animation:spin .8s linear infinite}.skill-run-message{padding:11px 24px;margin:0;color:#566783;background:#f7f9fc;border-top:1px solid #e6eaf0;font-size:11px}.skill-run-message.completed{color:#237d5a;background:#edf9f3}.skill-run-message.failed{color:#a5434d;background:#fff0f1}.skill-run-message.paused,.skill-run-message.pausing{color:#8b5a17;background:#fff6e5}.skill-run-actions{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 24px;background:#fff;border-top:1px solid #e7eaf0}.skill-run-actions p{margin:0;color:#838e9f;font-size:10px}.skill-run-actions>div{display:flex;gap:8px}.skill-run-actions .btn{min-height:44px}.skill-pause-button{display:inline-flex;align-items:center;gap:7px;color:#9a6018!important;background:#fff8ea!important;border-color:#eccb95!important}.skill-pause-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}@keyframes pulse{50%{box-shadow:0 0 0 8px rgba(91,92,240,.08)}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:700px){.skill-run-backdrop{padding:10px}.skill-run-dialog{height:calc(100dvh - 20px)}.skill-run-meta{align-items:flex-start;flex-wrap:wrap}.skill-run-meta code{width:100%;margin-left:0}.skill-run-actions{align-items:stretch;flex-direction:column}.skill-run-actions>div{justify-content:flex-end}}@media(prefers-reduced-motion:reduce){.skill-run-state-dot.running,.skill-run-spinner{animation:none}}
</style>
