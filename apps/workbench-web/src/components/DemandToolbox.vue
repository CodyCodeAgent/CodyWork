<template>
  <div ref="root" class="demand-toolbox">
    <button ref="trigger" class="btn demand-toolbox-trigger" type="button" :aria-expanded="open" aria-controls="demand-toolbox-panel" @click="open ? closeToolbox() : openToolbox()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.1a4.8 4.8 0 0 0-5.8 6.2L3.7 17.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4.8 4.8 0 0 0 6.2-5.8l-3 3-2.4-2.4 3-3Z" /></svg>
      <span>{{ triggerLabel }}</span>
    </button>

    <section v-if="open" id="demand-toolbox-panel" ref="panel" class="demand-toolbox-panel" role="dialog" aria-labelledby="demand-toolbox-title" tabindex="-1" @keydown.esc.prevent="closeToolbox">
        <header class="demand-toolbox-head"><div><div class="eyebrow">DEMAND TOOLBOX</div><h2 id="demand-toolbox-title">{{ demand.name }}</h2></div><button class="icon-button" type="button" aria-label="关闭工具箱" @click="closeToolbox">×</button></header>

        <section class="toolbox-section" aria-labelledby="toolbox-context-title">
          <div class="toolbox-section-head"><div><span class="toolbox-kicker">CURRENT SESSION</span><h3 id="toolbox-context-title">上下文 Token</h3></div><span v-if="usagePresentation?.statusLabel" class="toolbox-state" :data-tone="usagePresentation.tone">{{ usagePresentation.statusLabel }}</span></div>
          <template v-if="usagePresentation">
            <div class="token-summary"><div><span>已用</span><strong>{{ usagePresentation.usedLabel }}</strong></div><div v-if="usagePresentation.contextWindowLabel"><span>上限</span><strong>{{ usagePresentation.contextWindowLabel }}</strong></div><div v-if="usagePresentation.remainingLabel"><span>剩余</span><strong>{{ usagePresentation.remainingLabel }}</strong></div></div>
            <div v-if="usagePresentation.usedPercent !== null" class="token-meter" aria-label="上下文 Token 使用进度"><span class="token-meter-fill" :style="{ width: `${usagePresentation.usedPercent}%` }" /><span v-if="usagePresentation.autoCompactPercent !== null" class="token-meter-threshold" :style="{ left: `${usagePresentation.autoCompactPercent}%` }" title="自动压缩阈值" /></div>
            <p class="toolbox-note">{{ usageDetail }}</p>
          </template>
          <p v-else class="toolbox-note">等待 Codex 返回本 Thread 的上下文 Token 用量。</p>
        </section>

        <section class="toolbox-section" aria-labelledby="toolbox-docs-title">
          <div class="toolbox-section-head"><div><span class="toolbox-kicker">DOCUMENTATION</span><h3 id="toolbox-docs-title">文档与交接</h3></div></div>
          <div class="toolbox-action"><div><strong>沉淀当前会话</strong><p>更新最合适的 Demand 文档；必要时新增 <code>docs/progress.md</code>。</p></div><button class="btn" type="button" :disabled="!canSettle" :title="settleTitle" @click="settle">沉淀</button></div>
          <p v-if="!canSettle" class="toolbox-note">{{ settleTitle }}</p>
        </section>

        <section v-if="quickActions.length" class="toolbox-section" aria-labelledby="toolbox-quick-actions-title">
          <div class="toolbox-section-head"><div><span class="toolbox-kicker">QUICK ACTIONS</span><h3 id="toolbox-quick-actions-title">快捷指令</h3></div><span class="toolbox-state">{{ quickActions.length }} 条</span></div>
          <p class="toolbox-note">点击会立即作为一条新消息发送，并自动引用已配置的 Skill。</p>
          <div class="toolbox-quick-actions" role="list" aria-label="需求开发快捷指令">
            <button v-for="action in quickActions" :key="action.id" class="toolbox-quick-action" type="button" :disabled="quickActionsDisabled || action.missingSkillIds.length > 0" :title="quickActionTitle(action)" role="listitem" @click="executeQuickAction(action)">
              <span><strong>{{ action.name }}</strong><small v-if="action.skills.length">{{ action.skills.length }} 个 Skill</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>
          <p v-if="quickActionFeedback" class="toolbox-result" role="status">{{ quickActionFeedback }}</p>
        </section>

        <section class="toolbox-section" aria-labelledby="toolbox-repositories-title">
          <div class="toolbox-section-head"><div><span class="toolbox-kicker">REPOSITORIES</span><h3 id="toolbox-repositories-title">Repo 与 Worktree</h3></div><button class="text-button" type="button" :disabled="!canAddRepository" @click="addRepository">添加已有 Repo</button></div>
          <p class="toolbox-note">同步只作用于 <code>services/</code> 的基线，不会修改当前 Demand 的 Worktree 或分支。</p>
          <div v-if="repositories.length" class="toolbox-repositories" role="list" aria-label="当前 Demand 的基线仓库">
            <article v-for="repository in repositories" :key="repository.id" class="toolbox-repository" role="listitem">
              <div class="toolbox-repository-head"><div><strong>{{ repository.name }}</strong><small>origin/{{ repository.defaultRef || '未知分支' }}</small></div><span class="repository-state" :data-state="repository.dirty ? 'blocked' : repository.syncStatus === 'pull_failed' ? 'failed' : 'ready'">{{ repository.dirty ? '基线有改动' : repository.syncStatus === 'pull_failed' ? '上次同步失败' : '可安全检查' }}</span></div>
              <div class="toolbox-repository-action"><p>{{ repository.dirty ? '基线有未提交改动；清理会丢弃这些改动，不影响 Demand Worktree。' : '仅 fetch 并在可快进时更新本地基线。' }}</p><div class="toolbox-repository-buttons"><button v-if="repository.dirty" class="btn danger" type="button" :disabled="!canClean(repository)" :title="cleanupTitle(repository)" @click="emit('cleanup', repository)">{{ clearingRepositoryId === repository.id ? '清理中…' : '清理基线变更' }}</button><button class="btn" type="button" :disabled="!canSync(repository)" :title="syncTitle(repository)" @click="emit('sync', repository.id)">{{ syncingRepositoryId === repository.id ? '同步中…' : '同步远端基线' }}</button></div></div>
              <p v-if="syncResults[repository.id]" class="repository-result" :data-state="syncResults[repository.id].state" role="status">{{ syncResults[repository.id].message }}</p>
            </article>
          </div>
          <p v-else class="toolbox-note">当前 Demand 尚未关联任何 Repo。</p>
        </section>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { ConversationContextUsageState } from '@codycodeagent/cody-web-core/conversation'
import type { Demand, QuickAction, Repository, RepositorySyncResult } from '../api'
import { buildThreadContextUsagePresentation } from '../threadContextUsage'

const props = defineProps<{
  demand: Demand
  repositories: Repository[]
  usage: ConversationContextUsageState | null
  canSettle: boolean
  settleTitle: string
  canAddRepository: boolean
  syncingRepositoryId: string
  clearingRepositoryId: string
  syncResults: Record<string, RepositorySyncResult>
  quickActions: QuickAction[]
  quickActionsDisabled: boolean
  quickActionFeedback: string
}>()
const emit = defineEmits<{ settle: []; 'add-repository': []; sync: [repositoryId: string]; cleanup: [repository: Repository]; 'execute-quick-action': [action: QuickAction] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const usagePresentation = computed(() => buildThreadContextUsagePresentation(props.usage))
const triggerLabel = computed(() => {
  const percent = usagePresentation.value?.usedPercent
  return percent !== null && percent !== undefined && percent >= 70 ? `工具箱 · 上下文 ${percent}%` : '工具箱'
})
const usageDetail = computed(() => {
  const usage = usagePresentation.value
  if (!usage) return ''
  if (usage.autoCompactLabel) return `自动压缩阈值：${usage.autoCompactLabel}`
  if (usage.contextWindowLabel) return 'Codex 暂未提供自动压缩阈值。'
  return 'Codex 暂未提供本 Thread 的上下文窗口上限。'
})

function openToolbox(): void {
  open.value = true
  document.addEventListener('pointerdown', closeWhenClickedOutside)
  void nextTick(() => panel.value?.focus())
}
function closeToolbox(): void {
  closeToolboxInternal(true)
}
function closeToolboxInternal(restoreFocus: boolean): void {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', closeWhenClickedOutside)
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}
function closeWhenClickedOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) closeToolboxInternal(false)
}
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeWhenClickedOutside))
function settle(): void {
  closeToolbox()
  emit('settle')
}
function addRepository(): void {
  closeToolbox()
  emit('add-repository')
}
function executeQuickAction(action: QuickAction): void {
  closeToolbox()
  emit('execute-quick-action', action)
}
function quickActionTitle(action: QuickAction): string {
  return action.missingSkillIds.length ? `Skill 已失效，请到设置中修复：${action.skills.filter(skill => skill.status !== 'available').map(skill => skill.name).join('、')}` : `立即发送“${action.name}”`
}
function canSync(repository: Repository): boolean {
  return props.syncingRepositoryId === '' && props.clearingRepositoryId === '' && !repository.dirty && Boolean(repository.originUrl && repository.defaultRef)
}
function syncTitle(repository: Repository): string {
  if (props.syncingRepositoryId === repository.id) return '正在同步远端基线'
  if (props.syncingRepositoryId) return '另一个 Repo 正在同步'
  if (props.clearingRepositoryId) return '正在清理另一个 Repo 的基线变更'
  if (repository.dirty) return '基线有未提交改动，不能安全同步'
  if (!repository.originUrl) return '该 Repo 未配置 origin'
  if (!repository.defaultRef) return '无法确定默认分支'
  return `同步 origin/${repository.defaultRef} 到本地基线`
}
function canClean(repository: Repository): boolean {
  return repository.dirty && props.syncingRepositoryId === '' && props.clearingRepositoryId === ''
}
function cleanupTitle(repository: Repository): string {
  if (props.clearingRepositoryId === repository.id) return '正在清理基线变更'
  if (props.clearingRepositoryId) return '正在清理另一个 Repo 的基线变更'
  if (props.syncingRepositoryId) return '另一个 Repo 正在同步'
  return `丢弃 ${repository.name} 基线仓库中的未提交改动`
}
</script>

<style scoped>
.demand-toolbox { position: relative; }
.demand-toolbox-trigger { display: inline-flex; align-items: center; gap: 7px; }
.demand-toolbox-trigger svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.demand-toolbox-panel { position: absolute; top: calc(100% + 8px); right: 0; z-index: 60; width: min(456px, calc(100vw - 28px)); max-height: min(760px, calc(100vh - 86px)); overflow: auto; padding: 18px; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 15px; box-shadow: 0 20px 56px rgba(22, 36, 66, .22); }
.demand-toolbox-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 2px 2px 15px; border-bottom: 1px solid var(--line); }
.demand-toolbox-head h2 { margin: 4px 0 0; font-size: 18px; letter-spacing: -.03em; }
.toolbox-section { padding: 16px 2px; border-bottom: 1px solid var(--line); }
.toolbox-section:last-child { padding-bottom: 2px; border-bottom: 0; }
.toolbox-section-head, .toolbox-action, .toolbox-repository-head, .toolbox-repository-action { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.toolbox-section-head h3 { margin: 3px 0 0; font-size: 14px; }.toolbox-kicker { color: var(--muted); font-size: 9px; font-weight: 800; letter-spacing: .1em; }.toolbox-state, .repository-state { flex: 0 0 auto; padding: 4px 7px; color: #287b5d; background: #eaf8f1; border-radius: 999px; font-size: 10px; font-weight: 700; }.toolbox-state[data-tone='warning'], .repository-state[data-state='blocked'] { color: #9d630f; background: #fff3dc; }.toolbox-state[data-tone='critical'], .repository-state[data-state='failed'] { color: #a63e4c; background: #fff0f1; }.toolbox-state[data-tone='compacting'] { color: #595ac9; background: #eff0ff; }
.token-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }.token-summary div { min-width: 0; padding: 8px; background: #f6f8fb; border-radius: 8px; }.token-summary span, .token-summary strong { display: block; }.token-summary span { color: var(--muted); font-size: 10px; }.token-summary strong { overflow: hidden; margin-top: 3px; color: #3f4d65; font: 700 12px/1.25 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.token-meter { position: relative; height: 7px; margin-top: 11px; background: #e7ebf2; border-radius: 999px; }.token-meter-fill { display: block; height: 100%; min-width: 3px; background: var(--blue); border-radius: inherit; transition: width 220ms ease; }.token-meter-threshold { position: absolute; top: -3px; width: 2px; height: 13px; background: #d79524; border: 2px solid #fff; border-radius: 999px; transform: translateX(-50%); }
.toolbox-note, .toolbox-action p, .toolbox-repository-action p { margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }.toolbox-action { margin-top: 10px; }.toolbox-action strong { color: #2e394b; font-size: 13px; }.toolbox-action p { max-width: 260px; }.toolbox-action .btn, .toolbox-repository-action .btn { flex: 0 0 auto; }
.toolbox-quick-actions { display: grid; gap: 7px; margin-top: 11px; }.toolbox-quick-action { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 9px 11px; color: #34415a; background: #f7f8ff; border: 1px solid #e0e5f5; border-radius: 9px; cursor: pointer; text-align: left; transition: color 160ms var(--ease), background 160ms var(--ease), border-color 160ms var(--ease); }.toolbox-quick-action:hover:not(:disabled) { color: #4055bb; background: #f0f2ff; border-color: #cbd4fa; }.toolbox-quick-action:focus-visible { outline: 3px solid rgba(91,92,240,.18); outline-offset: 2px; }.toolbox-quick-action:disabled { color: #9ca6b6; background: #f7f8fa; cursor: not-allowed; }.toolbox-quick-action span { min-width: 0; }.toolbox-quick-action strong, .toolbox-quick-action small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.toolbox-quick-action strong { font-size: 12px; }.toolbox-quick-action small { margin-top: 2px; color: var(--muted); font-size: 10px; }.toolbox-quick-action svg { flex: 0 0 auto; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }.toolbox-result { margin: 9px 0 0; padding: 8px; color: #2e785d; background: #edf9f2; border-radius: 7px; font-size: 11px; line-height: 1.45; }
.toolbox-repositories { display: grid; gap: 9px; margin-top: 12px; }.toolbox-repository { padding: 11px; background: #f8fafc; border: 1px solid #e1e7f0; border-radius: 10px; }.toolbox-repository-head strong, .toolbox-repository-head small { display: block; }.toolbox-repository-head strong { color: #2d394d; font-size: 13px; }.toolbox-repository-head small { margin-top: 3px; color: var(--muted); font: 10px var(--mono); }.toolbox-repository-action { align-items: center; margin-top: 8px; }.toolbox-repository-action p { max-width: 250px; margin: 0; }.toolbox-repository-buttons { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }.repository-result { margin: 9px 0 0; padding: 8px; color: #2e785d; background: #edf9f2; border-radius: 7px; font-size: 11px; line-height: 1.45; }.repository-result[data-state='blocked'] { color: #9d630f; background: #fff5e5; }.repository-result[data-state='failed'] { color: #a63e4c; background: #fff0f1; }
.text-button { padding: 0; color: #4268cf; background: transparent; border: 0; font-size: 12px; font-weight: 700; }.text-button:disabled { color: var(--muted); }
@media (max-width: 760px) { .demand-toolbox-panel { right: 0; max-height: calc(100vh - 20px); } }
@media (prefers-reduced-motion: reduce) { .token-meter-fill { transition: none; } }
</style>
