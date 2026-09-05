<template>
  <div v-if="visible" class="modal-backdrop">
    <section class="modal-card demand-repository-modal" role="dialog" aria-modal="true" aria-labelledby="add-demand-repository-title" aria-describedby="add-demand-repository-help">
      <div class="modal-head">
        <div><div class="eyebrow">DEMAND REPOSITORIES</div><h2 id="add-demand-repository-title">添加 Repo 到需求</h2></div>
        <button class="icon-button" :disabled="adding" aria-label="关闭添加 Repo 弹窗" @click="emit('close')">×</button>
      </div>
      <p id="add-demand-repository-help" class="demand-repository-intro">选择已登记在 Workspace 的项目。CodyWork 会在 <code>{{ demand.branchName }}</code> 分支下创建隔离 Worktree，不会修改 <code>services/</code> 基线。</p>
      <fieldset class="repo-picker demand-repository-picker">
        <legend>可加入项目</legend>
        <template v-if="repositories.length">
          <label class="sr-only" for="add-demand-repository-search">搜索可加入的 Repo</label>
          <div class="demand-repository-search">
            <input id="add-demand-repository-search" v-model.trim="query" class="input" type="search" autocomplete="off" placeholder="按名称、路径或分支搜索…" aria-describedby="add-demand-repository-search-summary" />
            <button v-if="query" class="repo-search-clear" type="button" aria-label="清除 Repo 搜索" @click="query = ''">清除</button>
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
import { computed, ref, watch } from 'vue'
import type { Demand, Repository } from '../api'
import { filterDemandRepositories } from '../demandRepositories'

const props = defineProps<{ visible: boolean; demand: Demand; repositories: Repository[]; selectedRepositoryId: string; adding: boolean; error: string }>()
const emit = defineEmits<{ close: []; add: []; 'update:selectedRepositoryId': [value: string] }>()
const query = ref('')
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
.repo-option { align-items: center; }
.repo-option.selected { border-color: #8eabf2; background: var(--blue-soft); }
.demand-repository-meta { align-items: flex-end; color: var(--muted); display: flex; flex-direction: column; font-size: 12px; gap: 4px; margin-left: auto; }
.demand-repository-meta code { white-space: nowrap; }
.repo-picker-empty { color: var(--muted); margin: 8px 0; }
</style>
