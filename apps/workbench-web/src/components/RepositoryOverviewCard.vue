<template>
  <article class="info-card repository-card">
    <div class="repository-card-head">
      <div>
        <div class="card-kicker">REPOSITORIES</div>
        <h3>开发根目录</h3>
      </div>
      <div class="repository-card-actions">
        <span class="repository-summary">{{ repositories.length }} 个项目</span>
        <button class="btn repository-sync-all" type="button" :disabled="!repositories.length || busy" @click="emit('sync-all')">
          {{ syncingAll ? bulkProgress || '同步中…' : '同步全部' }}
        </button>
      </div>
    </div>

    <div v-if="repositories.length" class="repository-list" role="list" aria-label="开发仓库">
      <div v-for="repository in repositories" :key="repository.id" class="repository-row" role="listitem">
        <div class="repository-copy">
          <div class="repository-name"><strong>{{ repository.name }}</strong><code v-if="repository.defaultRef">{{ repository.defaultRef }}</code></div>
          <small>{{ repository.path }}</small>
          <p v-if="syncResults[repository.id]" class="repository-inline-result" :data-state="syncResults[repository.id].state" role="status">
            {{ syncResults[repository.id].message }}
          </p>
        </div>
        <div class="repository-statuses">
          <span v-if="repository.dirty" class="repository-status dirty">dirty</span>
          <span v-else class="repository-status clean">clean</span>
          <span v-if="repository.syncStatus === 'pull_failed'" class="repository-status sync-failed">sync failed</span>
          <button v-if="repository.dirty" class="repository-clear-button" type="button" :disabled="busy" :title="`丢弃 ${repository.name} 基线中的未提交改动`" @click="emit('cleanup', repository)">清理</button>
          <button class="repository-sync-button" type="button" :disabled="busy || !canSync(repository)" :title="syncTitle(repository)" @click="emit('sync', repository.id)">
            {{ syncingRepositoryId === repository.id ? '同步中…' : '同步' }}
          </button>
        </div>
      </div>
    </div>
    <p v-else class="muted">先添加一个 Git 仓库或目录，再创建 Demand。</p>

    <div class="repository-card-foot">
      <span>{{ bulkMessage || '仅安全快进主分支，不覆盖本地改动或修改 Demand Worktree' }}</span>
      <button class="btn" type="button" :disabled="busy" @click="emit('manage')">管理仓库</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Repository, RepositorySyncResult } from '../api'

const props = defineProps<{
  repositories: Repository[]
  syncingRepositoryId: string
  syncingAll: boolean
  clearingRepositoryId: string
  syncResults: Record<string, RepositorySyncResult>
  bulkProgress: string
  bulkMessage: string
}>()

const emit = defineEmits<{
  sync: [repositoryId: string]
  'sync-all': []
  cleanup: [repository: Repository]
  manage: []
}>()

const busy = computed(() => props.syncingAll || Boolean(props.syncingRepositoryId) || Boolean(props.clearingRepositoryId))

function canSync(repository: Repository): boolean {
  return !repository.dirty && Boolean(repository.originUrl && repository.defaultRef && repository.defaultRef !== 'HEAD')
}

function syncTitle(repository: Repository): string {
  if (props.syncingRepositoryId === repository.id) return `正在同步 ${repository.name}`
  if (repository.dirty) return '基线有未提交改动，不能安全同步'
  if (!repository.originUrl) return '该仓库未配置 origin'
  if (!repository.defaultRef || repository.defaultRef === 'HEAD') return '无法确定默认主分支'
  return `安全同步 origin/${repository.defaultRef}`
}
</script>
