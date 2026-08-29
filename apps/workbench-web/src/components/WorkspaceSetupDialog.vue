<template>
  <div v-if="visible" class="modal-backdrop">
    <section class="modal-card workspace-setup-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-setup-title">
      <div class="modal-head">
        <div><div class="eyebrow">NEW WORKSPACE</div><h2 id="workspace-setup-title">创建 Workspace</h2></div>
        <button class="icon-button" :disabled="creating" aria-label="关闭创建 Workspace 弹窗" @click="close">×</button>
      </div>

      <template v-if="!job || job.status === 'failed'">
        <div class="mode-tabs">
          <button :class="{ active: mode === 'folder' }" @click="mode = 'folder'">本地目录</button>
          <button :class="{ active: mode === 'git' }" @click="mode = 'git'">Git clone</button>
        </div>
        <label>显示名称</label>
        <input v-model="name" class="input" placeholder="可选" />
        <template v-if="mode === 'folder'">
          <label>目录路径</label>
          <div class="path-field"><input v-model="path" class="input" placeholder="/data00/home/you/projects/app" /><button class="btn compact" @click="openDirectoryPicker">选择目录</button></div>
        </template>
        <template v-else>
          <label>Git URL</label>
          <input v-model="gitUrl" class="input" placeholder="git@github.com:org/repo.git" />
          <label>目标目录</label>
          <div class="path-field"><input v-model="path" class="input" placeholder="/data00/home/you/projects/repo" /><button class="btn compact" @click="openDirectoryPicker">选择目录</button></div>
        </template>
        <p class="field-help">浏览 CodyWork 服务所在机器的允许目录。</p>
        <label class="setup-choice">
          <input v-model="useAi" type="checkbox" />
          <span><strong>交给 AI 检查并准备</strong><small>审阅目录/Git，补齐 CSR 目录，并以最小改动优化已有 `AGENTS.md` 与 `CONSTITUTION.md`；不会覆盖已有规则、修改业务代码或创建 Demand 分支。</small></span>
        </label>
      </template>

      <section v-if="job" class="workspace-setup-progress" aria-live="polite">
        <div class="setup-progress-head"><div><span class="card-kicker">AI SETUP</span><strong>{{ job.title }}</strong></div><b>{{ job.progress }}%</b></div>
        <div class="setup-progress-track"><i :style="{ width: `${job.progress}%` }" /></div>
        <ol class="setup-steps"><li :class="{ done: job.progress >= 5 }">检查目录与 Git</li><li :class="{ done: job.progress >= 25 }">AI 审阅与策略优化</li><li :class="{ done: job.progress >= 82 }">复检 Workspace 结构</li><li :class="{ done: job.status === 'completed' }">登记并打开</li></ol>
        <details open><summary>发送给 AI 的 Prompt</summary><pre>{{ job.prompt }}</pre></details>
        <details :open="Boolean(job.response)"><summary>AI Response</summary><pre>{{ job.response || '正在等待 AI 输出…' }}</pre></details>
        <details v-if="job.events.length"><summary>执行事件（{{ job.events.length }}）</summary><ul><li v-for="(event, index) in job.events" :key="`${event.timestamp}-${index}`"><code>{{ event.type }}</code><span>{{ event.text }}</span></li></ul></details>
      </section>

      <p v-if="formError || job?.error" class="form-error">{{ job?.error || formError }}</p>
      <div class="modal-actions">
        <button class="btn" :disabled="creating" @click="close">{{ job?.status === 'completed' ? '完成' : '取消' }}</button>
        <button v-if="job?.status === 'failed'" class="btn" @click="job = null">重新填写</button>
        <button v-else-if="!job" class="btn primary" :disabled="!canSubmit" @click="submit">{{ submitLabel }}</button>
      </div>
    </section>
  </div>

  <div v-if="directoryPickerVisible" class="modal-backdrop directory-picker-backdrop">
    <section class="modal-card directory-picker" role="dialog" aria-modal="true" aria-labelledby="directory-picker-title">
      <div class="modal-head"><div><div class="eyebrow">SERVER DIRECTORY</div><h2 id="directory-picker-title">选择目录</h2></div><button class="icon-button" aria-label="关闭目录选择器" @click="directoryPickerVisible = false">×</button></div>
      <p class="directory-help">仅显示 CodyWork 服务所在机器允许访问的目录。选中目录后仍会检查它是否是可用 Workspace。</p>
      <div v-if="directoryListing" class="directory-browser">
        <div class="directory-roots"><button v-for="root in directoryListing.roots" :key="root.path" class="directory-root" :class="{ active: root.path === directoryListing?.current }" @click="browseDirectories(root.path)">{{ root.name }}</button></div>
        <div class="directory-current"><code>{{ directoryListing.current }}</code><button class="btn compact" :disabled="!directoryListing.parent || directoryLoading" @click="browseDirectories(directoryListing.parent!)">上级</button></div>
        <p v-if="directoryError" class="form-error">{{ directoryError }}</p>
        <div v-else-if="directoryLoading" class="directory-loading">正在读取目录…</div>
        <div v-else class="directory-list"><button v-for="entry in directoryListing.directories" :key="entry.path" @click="browseDirectories(entry.path)"><span>▸</span><strong>{{ entry.name }}</strong><code>{{ entry.path }}</code></button><p v-if="directoryListing.directories.length === 0" class="muted">当前目录没有可继续浏览的子目录。</p></div>
      </div>
      <div class="modal-actions"><button class="btn" @click="directoryPickerVisible = false">取消</button><button class="btn primary" :disabled="!directoryListing || directoryLoading" @click="useSelectedDirectory">使用此目录</button></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api, type DirectoryListing, type Workspace, type WorkspaceSetupJob, type WorkspaceSource } from '../api'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: []; completed: [workspace: Workspace] }>()

const mode = ref<'folder' | 'git'>('folder')
const name = ref('')
const path = ref('')
const gitUrl = ref('')
const useAi = ref(true)
const creating = ref(false)
const formError = ref('')
const job = ref<WorkspaceSetupJob | null>(null)
const directoryPickerVisible = ref(false)
const directoryListing = ref<DirectoryListing | null>(null)
const directoryLoading = ref(false)
const directoryError = ref('')
let generation = 0

const canSubmit = computed(() => !creating.value && Boolean(path.value.trim()) && (mode.value === 'folder' || Boolean(gitUrl.value.trim())))
const submitLabel = computed(() => creating.value ? (useAi.value ? 'AI 准备中…' : '正在创建…') : (useAi.value ? '开始 AI 准备' : '创建并进入'))

function reset(): void {
  generation += 1
  mode.value = 'folder'
  name.value = ''
  path.value = ''
  gitUrl.value = ''
  useAi.value = true
  creating.value = false
  formError.value = ''
  job.value = null
  directoryPickerVisible.value = false
  directoryListing.value = null
  directoryError.value = ''
}

function close(): void {
  if (creating.value) return
  emit('close')
}

async function browseDirectories(nextPath?: string): Promise<void> {
  directoryLoading.value = true
  directoryError.value = ''
  try { directoryListing.value = await api.listDirectories(nextPath) }
  catch (cause) { directoryError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { directoryLoading.value = false }
}

async function openDirectoryPicker(): Promise<void> {
  directoryPickerVisible.value = true
  await browseDirectories(path.value.trim() || undefined)
}

function useSelectedDirectory(): void {
  if (!directoryListing.value) return
  path.value = directoryListing.value.current
  directoryPickerVisible.value = false
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const currentGeneration = ++generation
  creating.value = true
  formError.value = ''
  const source: WorkspaceSource = mode.value === 'folder'
    ? { type: 'folder', path: path.value.trim() }
    : { type: 'git', url: gitUrl.value.trim(), destination: path.value.trim() }
  try {
    if (useAi.value) {
      let current = await api.startWorkspaceSetup(source, name.value.trim() || undefined)
      job.value = current
      while (current.status === 'running' && currentGeneration === generation) {
        await new Promise(resolve => window.setTimeout(resolve, 450))
        current = await api.workspaceSetupStatus(current.id)
        if (currentGeneration === generation) job.value = current
      }
      if (currentGeneration !== generation) return
      if (current.status === 'failed' || !current.workspace) throw new Error(current.error || 'AI Workspace 初始化未完成')
      emit('completed', current.workspace)
      return
    }
    const created = await api.createWorkspace(source, name.value.trim() || undefined)
    emit('completed', created.workspace)
    emit('close')
  } catch (cause) {
    if (currentGeneration === generation) formError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (currentGeneration === generation) creating.value = false
  }
}

watch(() => props.visible, visible => { if (!visible) reset() })
onBeforeUnmount(() => { generation += 1 })
</script>
