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
        <label v-for="repository in repositories" :key="repository.id" class="repo-option" :class="{ selected: selectedRepositoryId === repository.id }">
          <input type="radio" name="demand-repository" :checked="selectedRepositoryId === repository.id" @change="emit('update:selectedRepositoryId', repository.id)" />
          <span><strong>{{ repository.name }}</strong><small>{{ repository.path }}</small></span>
          <span class="demand-repository-meta"><code v-if="repository.defaultRef">{{ repository.defaultRef }}</code><small v-if="repository.dirty">基线有未提交改动</small></span>
        </label>
        <p v-if="repositories.length === 0" class="repo-picker-empty">当前 Workspace 的所有已登记 Repo 都已加入此需求。</p>
      </fieldset>
      <p class="field-help">创建位置：<code>{{ demand.path }}/services/&lt;项目名&gt;</code></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions"><button class="btn" :disabled="adding" @click="emit('close')">取消</button><button class="btn primary" :disabled="adding || !selectedRepositoryId" @click="emit('add')">{{ adding ? '创建 Worktree 中…' : '添加并创建 Worktree' }}</button></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { Demand, Repository } from '../api'

defineProps<{ visible: boolean; demand: Demand; repositories: Repository[]; selectedRepositoryId: string; adding: boolean; error: string }>()
const emit = defineEmits<{ close: []; add: []; 'update:selectedRepositoryId': [value: string] }>()
</script>

<style scoped>
.demand-repository-modal { width: min(620px, 100%); }
.demand-repository-intro { margin: 0 0 18px; color: var(--muted); line-height: 1.6; }
.demand-repository-picker { border: 0; margin: 0; min-inline-size: 0; padding: 0; }
.demand-repository-picker legend { margin-bottom: 10px; color: var(--ink); font-weight: 700; }
.repo-option { align-items: center; }
.repo-option.selected { border-color: #8eabf2; background: var(--blue-soft); }
.demand-repository-meta { align-items: flex-end; color: var(--muted); display: flex; flex-direction: column; font-size: 12px; gap: 4px; margin-left: auto; }
.demand-repository-meta code { white-space: nowrap; }
.repo-picker-empty { color: var(--muted); margin: 8px 0; }
</style>
