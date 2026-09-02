<template>
  <aside
    v-if="presentation"
    class="context-usage-float"
    :data-tone="presentation.tone"
    @keydown.esc.prevent="expanded = false"
  >
    <button
      class="context-usage-trigger"
      type="button"
      :aria-expanded="expanded"
      aria-controls="thread-context-usage-detail"
      :title="expanded ? '收起上下文用量' : '查看当前会话上下文用量'"
      @click="expanded = !expanded"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 18.5a8 8 0 1 1 15 0" /><path d="m12 12 3.5-3.5" /><path d="M12 5v1.5M5.8 8.2l1.1 1.1M18.2 8.2l-1.1 1.1" /></svg>
      <span class="context-usage-trigger-copy"><span>上下文</span><strong>{{ summary }}</strong></span>
      <span v-if="presentation.usedPercent !== null" class="context-usage-trigger-percent">{{ presentation.usedPercent }}%</span>
      <svg class="context-usage-chevron" viewBox="0 0 24 24" aria-hidden="true"><path :d="expanded ? 'm7 14 5-5 5 5' : 'm7 10 5 5 5-5'" /></svg>
    </button>

    <section v-if="expanded" id="thread-context-usage-detail" class="context-usage-popover" aria-label="当前会话上下文用量">
      <div class="context-usage-popover-head"><div><span>当前会话</span><strong>上下文用量</strong></div><span class="context-usage-state" :data-tone="presentation.tone">{{ presentation.statusLabel ?? '状态正常' }}</span></div>
      <div class="context-usage-numbers"><div><span>已用</span><strong>{{ presentation.usedLabel }}</strong></div><div v-if="presentation.contextWindowLabel"><span>上限</span><strong>{{ presentation.contextWindowLabel }}</strong></div><div v-if="presentation.remainingLabel"><span>剩余</span><strong>{{ presentation.remainingLabel }}</strong></div></div>
      <div v-if="presentation.usedPercent !== null" class="context-usage-meter" aria-label="上下文用量进度"><span class="context-usage-meter-fill" :style="{ width: `${presentation.usedPercent}%` }" /><span v-if="presentation.autoCompactPercent !== null" class="context-usage-meter-threshold" :style="{ left: `${presentation.autoCompactPercent}%` }" title="自动压缩阈值" /></div>
      <p class="context-usage-note">{{ detailNote }}</p>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ConversationContextUsageState } from '@codycodeagent/cody-web-core/conversation'
import { buildThreadContextUsagePresentation } from '../threadContextUsage'

const props = defineProps<{ usage: ConversationContextUsageState | null }>()
const expanded = ref(false)
const presentation = computed(() => buildThreadContextUsagePresentation(props.usage))
const summary = computed(() => {
  if (!presentation.value) return ''
  return presentation.value.remainingLabel ? `剩余 ${presentation.value.remainingLabel}` : `已用 ${presentation.value.usedLabel}`
})
const detailNote = computed(() => {
  if (!presentation.value) return ''
  if (presentation.value.autoCompactLabel) return `自动压缩阈值：${presentation.value.autoCompactLabel}`
  if (presentation.value.contextWindowLabel) return 'Codex 暂未提供自动压缩阈值。'
  return 'Codex 暂未提供本线程的上下文窗口上限。'
})
</script>

<style scoped>
.context-usage-float { position: absolute; top: 14px; right: 18px; z-index: 5; width: max-content; max-width: min(320px, calc(100% - 36px)); color: #344054; font-size: 11px; }
.context-usage-trigger { display: inline-flex; align-items: center; min-height: 38px; gap: 8px; padding: 7px 9px; color: #4a5972; background: rgba(255, 255, 255, .94); border: 1px solid #dce3ef; border-radius: 10px; box-shadow: 0 8px 24px rgba(28, 41, 72, .1); cursor: pointer; backdrop-filter: blur(8px); transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease; }
.context-usage-trigger:hover { border-color: #aebdfa; box-shadow: 0 10px 28px rgba(58, 79, 142, .14); transform: translateY(-1px); }
.context-usage-trigger:focus-visible { outline: 3px solid rgba(91, 92, 240, .22); outline-offset: 2px; }
.context-usage-trigger > svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
.context-usage-trigger-copy { display: grid; text-align: left; line-height: 1.1; }
.context-usage-trigger-copy span { color: #8793a7; font-size: 9px; font-weight: 700; letter-spacing: .06em; }
.context-usage-trigger-copy strong { margin-top: 2px; color: #405270; font: 700 11px/1.15 var(--mono, ui-monospace, monospace); }
.context-usage-trigger-percent { display: grid; min-width: 29px; height: 22px; place-items: center; padding: 0 5px; color: #356bda; background: #edf3ff; border-radius: 6px; font: 700 10px/1 var(--mono, ui-monospace, monospace); }
.context-usage-chevron { width: 14px !important; height: 14px !important; color: #8490a4; }
.context-usage-float[data-tone='warning'] .context-usage-trigger { color: #b16d14; border-color: #f1c675; }
.context-usage-float[data-tone='warning'] .context-usage-trigger-percent { color: #a8620d; background: #fff4df; }
.context-usage-float[data-tone='critical'] .context-usage-trigger { color: #b54854; border-color: #efa6ad; }
.context-usage-float[data-tone='critical'] .context-usage-trigger-percent { color: #ae4250; background: #fff0f1; }
.context-usage-float[data-tone='compacting'] .context-usage-trigger { color: #5b5cf0; border-color: #bfc1fb; }
.context-usage-float[data-tone='compacted'] .context-usage-trigger { color: #268363; border-color: #a6d9c3; }
.context-usage-popover { width: min(300px, calc(100vw - 36px)); padding: 14px; margin-top: 8px; color: #4d5a6e; background: rgba(255, 255, 255, .98); border: 1px solid #dce3ef; border-radius: 12px; box-shadow: 0 16px 36px rgba(28, 41, 72, .16); backdrop-filter: blur(10px); }
.context-usage-popover-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.context-usage-popover-head > div { display: grid; gap: 3px; }
.context-usage-popover-head span { color: #8995a8; font-size: 9px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
.context-usage-popover-head strong { color: #2f3a4c; font-size: 13px; }
.context-usage-state { max-width: 118px; padding: 4px 6px; color: #2e7c60 !important; background: #eaf8f1; border-radius: 999px; font-size: 9px !important; letter-spacing: 0 !important; text-align: right; text-transform: none !important; }
.context-usage-state[data-tone='warning'] { color: #a86711 !important; background: #fff4df; }
.context-usage-state[data-tone='critical'] { color: #ad4450 !important; background: #fff0f1; }
.context-usage-state[data-tone='compacting'] { color: #5557c9 !important; background: #eff0ff; }
.context-usage-numbers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 13px 0 10px; }
.context-usage-numbers div { min-width: 0; padding: 7px 8px; background: #f6f8fb; border-radius: 8px; }
.context-usage-numbers span, .context-usage-numbers strong { display: block; }
.context-usage-numbers span { color: #8b96a8; font-size: 9px; }
.context-usage-numbers strong { overflow: hidden; margin-top: 3px; color: #3f4d65; font: 700 11px/1.25 var(--mono, ui-monospace, monospace); text-overflow: ellipsis; white-space: nowrap; }
.context-usage-meter { position: relative; height: 7px; overflow: visible; background: #e7ebf2; border-radius: 999px; }
.context-usage-meter-fill { display: block; height: 100%; min-width: 3px; background: #526fe4; border-radius: inherit; transition: width 220ms ease; }
.context-usage-meter-threshold { position: absolute; top: -3px; width: 2px; height: 13px; background: #d79524; border: 2px solid #fff; border-radius: 999px; transform: translateX(-50%); box-shadow: 0 1px 3px rgba(95, 65, 13, .22); }
.context-usage-float[data-tone='warning'] .context-usage-meter-fill { background: #d8911c; }
.context-usage-float[data-tone='critical'] .context-usage-meter-fill { background: #d45b67; }
.context-usage-float[data-tone='compacting'] .context-usage-meter-fill { background: #6b6ce9; }
.context-usage-float[data-tone='compacted'] .context-usage-meter-fill { background: #34a47a; }
.context-usage-note { margin: 10px 0 0; color: #8190a6; font-size: 10px; line-height: 1.5; }
@media (max-width: 760px) { .context-usage-float { top: 8px; right: 10px; } .context-usage-trigger { min-height: 34px; } .context-usage-trigger-copy span { display: none; } .context-usage-popover { position: fixed; top: 52px; right: 10px; } }
@media (prefers-reduced-motion: reduce) { .context-usage-trigger, .context-usage-meter-fill { transition: none; } }
</style>
