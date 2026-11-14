<template>
  <div v-if="visible" class="modal-backdrop">
    <section class="modal-card demand-repository-modal" role="dialog" aria-modal="true" aria-labelledby="add-demand-repository-title" v-modal-focus="() => { if (!adding) emit('close') }" aria-describedby="add-demand-repository-help">
      <div class="modal-head">
        <div><div class="eyebrow">DEMAND REPOSITORIES</div><h2 id="add-demand-repository-title">添加 Repo 到需求</h2></div>
        <button class="icon-button" :disabled="adding" aria-label="关闭添加 Repo 弹窗" @click="emit('close')">×</button>
      </div>
      <p id="add-demand-repository-help" class="demand-repository-intro">选择已登记在 Workspace 的项目。CodyWork 会先丢弃该 <code>services/</code> 基线的本地状态并更新到远端默认分支，再为 <code>{{ demand.branchName }}</code> 创建隔离 Worktree；已有 Demand Worktree 不受影响。</p>
      <fieldset class="repo-picker demand-repository-picker">
        <legend>可加入项目</legend>
        <template v-if="repositories.length">
          <label class="sr-only" for="add-demand-repository-search">搜索可加入的 Repo</label>
          <div class="demand-repository-search">
            <input ref="searchInput" id="add-demand-repository-search" v-model.trim="query" class="input" type="search" autocomplete="off" placeholder="按名称、路径或分支搜索…" aria-describedby="add-demand-repository-search-summary" />
            <button v-if="query" class="repo-search-clear" type="button" aria-label="清除 Repo 搜索" @click="clearSearch">清除</button>
          </div>
          <p id="add-demand-repository-search-summary" class="demand-repository-summary" role="status">{{ searchSummary }}</p>
        </template>
        <label v-for="repository in filteredRepositories" :key="repository.id" class="repo-option" :class="{ selected: selectedRepositoryId === repository.id }">
          <input type="radio" name="demand-repository" :checked="selectedRepositoryId === repository.id" @change="emit('update:selectedRepositoryId', repository.id)" />
          <span><strong>{{ repository.name }}</strong><small>{{ repository.path }}</small></span>
          <span class="demand-repository-meta"><code v-if="repository.defaultRef">{{ repository.defaultRef }}</code><small v-if="repository.dirty">基线有未提交改动</small></span>
        </label>
        <p v-if="repositories.length === 0" class="repo-picker-empty">当前 Workspace 的所有已登记 Repo 都已加入此需求。</p>
        <p v-else-if="filteredRepositories.length === 0" class="repo-picker-empty">没有匹配的 Repo。可尝试项目名、路径或分支名。</p>
      </fieldset>
      <p class="field-help">创建位置：<code>{{ demand.path }}/services/&lt;项目名&gt;</code></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions"><button class="btn" :disabled="adding" @click="emit('close')">取消</button><button class="btn primary" :disabled="adding || !selectedRepositoryId" @click="emit('add')">{{ adding ? '创建 Worktree 中…' : '添加并创建 Worktree' }}</button></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { vModalFocus } from '../modalFocus'
import { computed, nextTick, ref, watch } from 'vue'
import type { Demand, Repository } from '../api'
import { filterDemandRepositories } from '../demandRepositories'

const props = defineProps<{ visible: boolean; demand: Demand; repositories: Repository[]; selectedRepositoryId: string; adding: boolean; error: string }>()
const emit = defineEmits<{ close: []; add: []; 'update:selectedRepositoryId': [value: string] }>()
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
async function clearSearch() {
  query.value = ''
  await nextTick()
  searchInput.value?.focus()
}
const filteredRepositories = computed(() => filterDemandRepositories(props.repositories, query.value))
const searchSummary = computed(() => query.value
  ? `${filteredRepositories.value.length} / ${props.repositories.length} 个匹配`
  : `${props.repositories.length} 个可选 Repo`)

watch(() => props.visible, (visible) => {
  if (!visible) query.value = ''
})

watch(filteredRepositories, (repositories) => {
  if (props.selectedRepositoryId && !repositories.some(repository => repository.id === props.selectedRepositoryId)) {
    emit('update:selectedRepositoryId', '')
  }
})
</script>

<style scoped>
.demand-repository-modal { width: min(620px, 100%); }
.demand-repository-intro { margin: 0 0 18px; color: var(--muted); line-height: 1.6; }
.demand-repository-picker { border: 0; margin: 0; min-inline-size: 0; padding: 0; }
.demand-repository-picker legend { margin-bottom: 10px; color: var(--ink); font-weight: 700; }
.demand-repository-search { margin-bottom: 0; }
.demand-repository-summary { margin-bottom: 10px; }
.repo-option { display:grid !important; grid-template-columns:16px minmax(0,1fr); align-items:center; gap:5px 10px; }
.repo-option input { grid-row:1 / 3; margin:0; }
.repo-option>span { grid-column:2; }
.repo-option strong { white-space:normal; overflow-wrap:anywhere; }
.repo-option.selected { border-color: var(--accent-border); background: var(--blue-soft); }
.demand-repository-meta { align-items:center; color:var(--muted); display:flex; flex-wrap:wrap; font-size:11px; gap:4px 8px; }
.demand-repository-meta small { font:inherit; white-space:normal; }
.demand-repository-meta code { white-space: nowrap; }
.repo-picker-empty { color: var(--muted); margin: 8px 0; }
</style>
