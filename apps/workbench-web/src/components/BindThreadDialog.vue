<template>
  <div v-if="visible" class="modal-backdrop">
    <section class="modal-card bind-thread-modal" role="dialog" aria-modal="true" aria-labelledby="bind-thread-title">
      <div class="modal-head"><div><div class="eyebrow">EXISTING CONTEXT</div><h2 id="bind-thread-title">绑定已有 Thread</h2></div><button class="icon-button" aria-label="关闭绑定 Thread 弹窗" @click="emit('close')">×</button></div>
      <p class="bind-thread-intro">可先选 Codex 项目，再从其 Thread 中选择；不选项目时会展示全部项目。后续执行仍按当前 Demand 的 Worktree 权限运行。</p>
      <template v-if="!manualEntry">
        <label for="thread-project">Codex 项目 <span class="optional">可选</span></label>
        <div class="thread-project-select"><select id="thread-project" :value="selectedProject" aria-label="筛选 Codex 项目" @change="emit('update:selectedProject', ($event.target as HTMLSelectElement).value)"><option value="">全部项目 · {{ allThreadCount }}</option><option v-for="project in projects" :key="project.cwd" :value="project.cwd">{{ project.name }} · {{ project.count }}</option></select><small v-if="selectedProject">{{ selectedProject }}</small></div>
        <label for="thread-search">搜索 Thread</label>
        <div class="thread-search"><input id="thread-search" :value="query" class="input" autocomplete="off" placeholder="按内容、目录或 Thread ID 搜索…" @input="emit('update:query', ($event.target as HTMLInputElement).value)" /><span>{{ threads.length }}</span></div>
        <div class="thread-picker" role="listbox" aria-label="可绑定的 Codex Thread" :aria-busy="loading"><div v-if="loading" class="thread-picker-loading"><span class="loading-dot" />正在读取最近 Thread…</div><template v-else><button v-for="thread in threads" :key="thread.nativeId" class="thread-option" :class="{ selected: nativeId === thread.nativeId, bound: thread.bound }" :disabled="thread.bound" role="option" :aria-selected="nativeId === thread.nativeId" @click="emit('select', thread)"><span class="thread-option-indicator" aria-hidden="true" /><span class="thread-option-copy"><strong>{{ threadTitle(thread) }}</strong><small v-if="thread.cwd">{{ thread.cwd }}</small><code>{{ thread.nativeId }}</code></span><span class="thread-option-meta"><span v-if="thread.bound" class="thread-status bound">已绑定</span><span v-else-if="thread.source" class="thread-status">{{ thread.source }}</span><small v-if="thread.updatedAt">{{ formatThreadTime(thread.updatedAt) }}</small></span></button><p v-if="threads.length === 0" class="thread-picker-empty">该项目下没有匹配的 Thread。可切换到全部项目、修改搜索词，或手动输入。</p></template></div>
        <button class="text-button" @click="emit('update:manualEntry', true)">列表里没有？手动输入 Thread ID</button>
      </template>
      <template v-else><button class="text-button" @click="emit('update:manualEntry', false)">‹ 返回 Thread 列表</button><label for="bind-native-id">Thread / Session ID</label><input id="bind-native-id" :value="nativeId" class="input" autocomplete="off" placeholder="例如：019f92ff-c3f3-7ec0-a67e-4bac046a9f37" @input="emit('update:nativeId', ($event.target as HTMLInputElement).value)" @keyup.enter="emit('bind')" /></template>
      <label for="bind-title">显示名称 <span class="optional">可选</span></label><input id="bind-title" :value="title" class="input" autocomplete="off" placeholder="例如：钱效 V2 继续开发" @input="emit('update:title', ($event.target as HTMLInputElement).value)" @keyup.enter="emit('bind')" />
      <p class="field-help">不会复制历史消息到 CodyWork；已绑定到任何 Demand 的 Thread 不能再次选择。</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions"><button class="btn" :disabled="binding" @click="emit('close')">取消</button><button class="btn primary" :disabled="binding || !canBind" @click="emit('bind')">{{ binding ? '正在绑定…' : '绑定并继续' }}</button></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { AvailableNativeThread } from '../api'
import { formatThreadTime, threadTitle, type ThreadProject } from '../workbenchUi'

defineProps<{ visible: boolean; binding: boolean; loading: boolean; manualEntry: boolean; selectedProject: string; query: string; nativeId: string; title: string; error: string; canBind: boolean; allThreadCount: number; projects: ThreadProject[]; threads: AvailableNativeThread[] }>()
const emit = defineEmits<{ close: []; bind: []; select: [thread: AvailableNativeThread]; 'update:manualEntry': [value: boolean]; 'update:selectedProject': [value: string]; 'update:query': [value: string]; 'update:nativeId': [value: string]; 'update:title': [value: string] }>()
</script>
