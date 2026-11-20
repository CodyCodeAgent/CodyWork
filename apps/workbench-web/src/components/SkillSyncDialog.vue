<template>
  <div class="modal-backdrop">
    <section class="modal-card skill-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-sync-title" v-modal-focus="close">
      <header class="modal-head">
        <div>
          <h2 id="skill-sync-title">同步 Skills</h2>
          <p>让其他 Runtime 在当前工作空间发现选中的 Skill。</p>
        </div>
        <button type="button" class="icon-button" aria-label="关闭同步 Skills" :disabled="syncing" @click="close">×</button>
      </header>

      <ol class="sync-steps" aria-label="同步步骤">
        <li v-for="(label, index) in steps" :key="label" :aria-current="step === index + 1 ? 'step' : undefined">
          <span>{{ index + 1 }}</span>{{ label }}
        </li>
      </ol>

      <section v-if="step === 1" class="sync-content" aria-label="选择 Skills">
        <label class="sr-only" for="sync-skill-search">搜索要同步的 Skills</label>
        <input id="sync-skill-search" v-model.trim="query" class="input" type="search" placeholder="搜索名称、描述或路径…" />
        <div class="sync-selection">
          <strong>已选 {{ selected.size }} / {{ selectableCount }} 项</strong>
          <div class="sync-toolbar">
            <button type="button" class="btn" :disabled="!canSelectMore" @click="selectMatches">{{ query ? '全选搜索结果' : '全选' }}</button>
            <button type="button" class="btn" :disabled="!selected.size" @click="selected = new Set()">清空</button>
          </div>
        </div>
        <div class="sync-scroll">
          <label v-for="skill in matches" :key="skill.id" class="sync-choice">
            <input type="checkbox" :checked="selected.has(skill.id)" :disabled="skill.status !== 'available'" @change="toggleSkill(skill.id)" />
            <span class="sync-choice-copy">
              <strong>{{ skill.displayName || skill.name }}</strong>
              <small>{{ skill.path }}</small>
            </span>
            <span v-if="skill.status !== 'available'" class="sync-muted">不可用</span>
          </label>
          <p v-if="!matches.length" class="sync-empty">没有匹配的 Skill。</p>
        </div>
      </section>

      <section v-else-if="step === 2" class="sync-content" aria-label="选择 Runtime">
        <div class="sync-selection">
          <strong>选择同步目标</strong>
          <button type="button" class="btn" :disabled="checking" @click="loadTargets">重新检查</button>
        </div>
        <p v-if="checking" class="sync-empty" role="status">正在检查可用的 Runtime…</p>
        <div v-else class="sync-scroll">
          <label v-for="target in targets" :key="target.id" class="sync-choice">
            <input type="checkbox" :checked="runtimeIds.has(target.id)" :disabled="!target.available" @change="toggleRuntime(target.id)" />
            <span class="sync-choice-copy">
              <strong>{{ target.label }}</strong>
              <small v-if="target.reason">{{ target.reason }}</small>
            </span>
            <span class="sync-muted">{{ target.available ? '可同步' : '不可同步' }}</span>
          </label>
        </div>
      </section>

      <section v-else class="sync-content" aria-label="同步结果">
        <template v-if="results">
          <div role="status"><h3>同步完成 · {{ availableCount }} 项可用，{{ results.length - availableCount }} 项需处理</h3></div>
          <p class="sync-muted">{{ addedCount }} 项新增，{{ availableCount - addedCount }} 项已可用。每个 Skill 与 Runtime 的组合计为一项。</p>
          <div v-if="issues.length" class="sync-scroll sync-results">
            <div v-for="result in issues" :key="`${result.skillId}:${result.runtimeId}`" class="sync-choice">
              <span class="sync-choice-copy">
                <strong>{{ result.name }} · {{ runtimeLabel(result.runtimeId) }}</strong>
                <small>{{ result.message || resultStatus(result.status) }}</small>
              </span>
              <span class="sync-muted">{{ resultStatus(result.status) }}</span>
            </div>
          </div>
        </template>
        <template v-else>
          <h3>同步 {{ selected.size }} 个 Skill</h3>
          <p>目标 Runtime：{{ selectedTargetLabels.join('、') }}</p>
          <p class="sync-muted">同步到当前工作空间，已有同名 Skill 会保留。同步后会检查哪些 Skill 能被目标发现。</p>
          <p v-if="syncing" role="status">正在同步并检查 Runtime，完成后会更新列表标签…</p>
        </template>
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>

      <footer class="modal-actions">
        <button v-if="!results" type="button" class="btn" :disabled="syncing" @click="step === 1 ? close() : back()">{{ step === 1 ? '取消' : '上一步' }}</button>
        <button v-if="step < 3" type="button" class="btn primary" :disabled="step === 1 ? !selected.size : checking || !runtimeIds.size" @click="next">下一步</button>
        <button v-else-if="!results" type="button" class="btn primary" :disabled="syncing" @click="start">{{ syncing ? '同步中…' : '开始同步' }}</button>
        <button v-else type="button" class="btn primary" @click="close">完成</button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, type SkillSyncResult, type SkillSyncTarget, type WorkspaceSkill } from '../api'
import { vModalFocus } from '../modalFocus'

const props = defineProps<{ workspaceId: string; skills: WorkspaceSkill[] }>()
const emit = defineEmits<{ close: []; synced: [workspaceId: string] }>()
const steps = ['选择 Skills', '选择 Runtime', '同步']
const step = ref(1)
const query = ref('')
const selected = ref(new Set<string>())
const targets = ref<SkillSyncTarget[]>([])
const runtimeIds = ref(new Set<string>())
const checking = ref(false)
const syncing = ref(false)
const error = ref('')
const results = ref<SkillSyncResult[] | null>(null)
const selectableCount = computed(() => props.skills.filter(skill => skill.status === 'available').length)
const matches = computed(() => {
  const keyword = query.value.toLowerCase()
  return keyword
    ? props.skills.filter(skill => [skill.name, skill.displayName, skill.description, skill.path].some(value => value.toLowerCase().includes(keyword)))
    : props.skills
})
const canSelectMore = computed(() => matches.value.some(skill => skill.status === 'available' && !selected.value.has(skill.id)))
const selectedTargetLabels = computed(() => targets.value.filter(runtime => runtimeIds.value.has(runtime.id)).map(runtime => runtime.label))
const issues = computed(() => results.value?.filter(item => item.status !== 'synced' && item.status !== 'already_available') ?? [])
const addedCount = computed(() => results.value?.filter(item => item.status === 'synced').length ?? 0)
const availableCount = computed(() => (results.value?.length ?? 0) - issues.value.length)

function close(): void { if (!syncing.value) emit('close') }
function back(): void { error.value = ''; step.value-- }
function toggleSkill(id: string): void { toggle(selected.value, id) }
function toggleRuntime(id: string): void { toggle(runtimeIds.value, id) }
function toggle(set: Set<string>, id: string): void { if (set.has(id)) set.delete(id); else set.add(id) }
function selectMatches(): void {
  for (const skill of matches.value) if (skill.status === 'available') selected.value.add(skill.id)
}
function runtimeLabel(id: string): string { return targets.value.find(target => target.id === id)?.label ?? id }
function resultStatus(status: SkillSyncResult['status']): string {
  return { synced: '已同步', already_available: '已可用', skipped: '已跳过', not_discovered: '未发现', failed: '失败' }[status]
}

async function loadTargets(): Promise<void> {
  if (checking.value) return
  checking.value = true
  error.value = ''
  try {
    targets.value = await api.skillSyncTargets(props.workspaceId)
    runtimeIds.value = new Set(targets.value.filter(target => target.available && runtimeIds.value.has(target.id)).map(target => target.id))
  } catch (cause) {
    targets.value = []
    runtimeIds.value = new Set()
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    checking.value = false
  }
}
function next(): void {
  error.value = ''
  if (step.value === 1 && selected.value.size) {
    step.value = 2
    void loadTargets()
  } else if (step.value === 2 && !checking.value && runtimeIds.value.size) step.value = 3
}
async function start(): Promise<void> {
  if (syncing.value || !selected.value.size || !runtimeIds.value.size) return
  syncing.value = true
  error.value = ''
  try {
    results.value = await api.syncSkills(props.workspaceId, [...selected.value], [...runtimeIds.value])
    emit('synced', props.workspaceId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    syncing.value = false
  }
}
</script>

<style scoped>
.skill-sync-dialog { width: min(680px, 100%); max-height: min(780px, 94dvh); overflow: auto; }
.modal-head p, .sync-content p { color: var(--ink-secondary); margin: 5px 0 0; }
.sync-steps { list-style: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 16px 0; padding: 0; }
.sync-steps li { display: flex; align-items: center; gap: 7px; border-bottom: 2px solid var(--border-default); color: var(--ink-secondary); padding: 0 2px 10px; font-size: 13px; }
.sync-steps li[aria-current="step"] { color: var(--ink-primary); font-weight: 700; border-color: var(--accent); }
.sync-steps span { display: grid; place-items: center; border: 1px solid var(--border-default); border-radius: 50%; width: 22px; height: 22px; flex: none; }
.sync-content h3 { margin: 0 0 4px; }
.sync-selection, .sync-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.sync-selection { justify-content: space-between; padding: 10px 0; }
.sync-scroll { max-height: min(330px, 43dvh); overflow: auto; border: 1px solid var(--border-default); border-radius: 12px; }
.sync-choice { display: flex; align-items: center; gap: 12px; padding: 10px 12px; font-size: 13px; min-height: 42px; margin: 0; color: var(--ink-primary); }
.sync-choice + .sync-choice { border-top: 1px solid var(--border-default); }
.sync-choice:focus-within { outline: 2px solid var(--accent); outline-offset: -2px; }
.sync-choice input { flex: none; }
.sync-choice-copy { display: grid; gap: 3px; flex: 1; min-width: 0; }
.sync-choice-copy strong, .sync-choice-copy small { overflow-wrap: anywhere; }
.sync-choice-copy small, .sync-muted { color: var(--ink-secondary); }
.sync-choice > .sync-muted { flex: none; }
.sync-results { margin-top: 12px; }
.sync-empty { padding: 12px; }
</style>
