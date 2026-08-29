<template>
  <aside class="sidebar">
    <div class="brand"><span class="brand-mark">CW</span><span><strong>CodyWork</strong><small>Codex workbench</small></span></div>
    <div class="sidebar-scroll">
      <template v-if="workspace">
        <div class="switcher-wrap">
          <button class="switcher" @click="emit('update:workspacePickerOpen', !workspacePickerOpen)"><span class="folder-mark">{{ workspace.name.slice(0, 1).toUpperCase() }}</span><span class="switcher-copy"><strong>{{ workspace.name }}</strong><small>{{ workspace.path }}</small></span><span class="switcher-action">切换</span></button>
          <div v-if="workspacePickerOpen" class="switcher-menu">
            <div v-for="item in workspaces" :key="item.id" class="workspace-picker-row"><button class="workspace-picker-select" :class="{ selected: item.id === workspace.id }" @click="emit('selectWorkspace', item)"><span class="folder-mark small">{{ item.name.slice(0, 1).toUpperCase() }}</span><span><strong>{{ item.name }}</strong><small>{{ item.path }}</small></span></button><button class="workspace-picker-remove" type="button" :aria-label="`从 CodyWork 移除 ${item.name}`" @click.stop="emit('removeWorkspace', item)">移除</button></div>
            <button class="menu-create" @click="emit('createWorkspace')">＋ 创建 Workspace</button>
          </div>
        </div>
        <div class="sidebar-section-label"><span>WORKSPACE</span><small>上下文与资产</small></div>
        <button v-for="item in workspacePages" :key="item.page" class="sidebar-item" :class="{ active: activePage === item.page }" @click="emit('navigate', item.page)"><span>{{ item.icon }}</span><span class="sidebar-label"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span></button>
        <section class="sidebar-demand-section" aria-label="需求列表">
          <button class="sidebar-section-label sidebar-accordion-trigger" :class="{ expanded: demandExpanded }" type="button" :aria-expanded="demandExpanded" aria-controls="sidebar-demand-list" @click="emit('update:demandExpanded', !demandExpanded)"><span>WORK MODE</span><small>Demand / Worktree</small><em>{{ demands.length }}</em><i class="sidebar-accordion-chevron" aria-hidden="true">⌄</i></button>
          <div v-show="demandExpanded" id="sidebar-demand-list" class="sidebar-subnav">
            <button class="sidebar-subnav-item all-demands" :class="{ active: activePage === 'demands' }" @click="emit('navigate', 'demands')"><span class="subnav-rail-icon" aria-hidden="true">▦</span><span><strong>全部需求</strong><small>查看和管理 Worktree</small></span></button>
            <button v-for="demand in demands" :key="demand.id" class="sidebar-subnav-item" :class="{ active: activePage === 'chat' && demand.id === selectedDemandId }" @click="emit('openDemand', demand)"><span :class="['subnav-status', demand.status]" /><span><strong>{{ demand.name }}</strong><small>{{ demand.branchName }}</small></span><em :class="['demand-status-tag', demand.status]">{{ demandStatusLabel(demand.status) }}</em></button>
            <button v-if="demands.length === 0" class="sidebar-subnav-empty" @click="emit('createDemand')">还没有需求，创建第一个 Worktree</button>
          </div>
          <button v-show="demandExpanded" class="sidebar-new-demand" @click="emit('createDemand')"><span aria-hidden="true">＋</span> 新建需求</button>
        </section>
      </template>
      <template v-else><div class="sidebar-section-label"><span>WORKSPACES</span><small>开始开发</small></div><button class="sidebar-item active" @click="emit('createWorkspace')"><span>＋</span><span class="sidebar-label"><strong>创建 Workspace</strong><small>目录或 Git 仓库</small></span></button></template>
    </div>
    <div class="sidebar-spacer" />
    <button class="sidebar-item" :class="{ active: activePage === 'settings' }" @click="emit('navigate', 'settings')"><span>⚙</span><span class="sidebar-label"><strong>Codex Runtime</strong><small>连接与诊断</small></span></button>
    <div class="sidebar-note"><span class="status-dot" :class="socketState" /><span><strong>{{ socketState === 'open' ? 'Realtime connected' : 'Codex ready' }}</strong><small>{{ workspace ? 'Worktree policy enforced' : '选择一个 Workspace 开始' }}</small></span></div>
  </aside>
</template>

<script setup lang="ts">
import type { Demand, Workspace } from '../api'
import { demandStatusLabel } from '../workbenchUi'

type Page = 'dashboard' | 'demands' | 'knowledge' | 'skills' | 'settings' | 'chat'

defineProps<{
  workspace: Workspace | null
  workspaces: Workspace[]
  demands: Demand[]
  selectedDemandId: string
  activePage: Page
  socketState: 'open' | 'connecting' | 'closed'
  workspacePickerOpen: boolean
  demandExpanded: boolean
}>()

const emit = defineEmits<{
  'update:workspacePickerOpen': [value: boolean]
  'update:demandExpanded': [value: boolean]
  selectWorkspace: [workspace: Workspace]
  removeWorkspace: [workspace: Workspace]
  createWorkspace: []
  createDemand: []
  navigate: [page: Exclude<Page, 'chat'>]
  openDemand: [demand: Demand]
}>()

const workspacePages = [
  { page: 'dashboard' as const, icon: '◫', label: '概览', description: '健康度与进展' },
  { page: 'knowledge' as const, icon: '▤', label: '知识库', description: '规范与文档' },
  { page: 'skills' as const, icon: '✦', label: 'Skills', description: 'Agent 可用能力' },
]
</script>
