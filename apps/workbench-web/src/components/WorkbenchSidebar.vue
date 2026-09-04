<template>
  <aside :class="['sidebar', { collapsed }]">
    <div class="brand"><span class="brand-mark">CW</span><span><strong>CodyWork</strong><small>Codex workbench</small></span></div>
    <div class="sidebar-scroll">
      <template v-if="workspace">
        <div class="switcher-wrap">
          <button class="switcher" :aria-label="collapsed ? `切换 Workspace：${workspace.name}` : undefined" :title="collapsed ? workspace.name : undefined" @click="emit('update:workspacePickerOpen', !workspacePickerOpen)"><span class="folder-mark">{{ workspace.name.slice(0, 1).toUpperCase() }}</span><span class="switcher-copy"><strong>{{ workspace.name }}</strong><small>{{ workspace.path }}</small></span><span class="switcher-action">切换</span></button>
          <div v-if="workspacePickerOpen" class="switcher-menu">
            <div v-for="item in workspaces" :key="item.id" class="workspace-picker-row"><button class="workspace-picker-select" :class="{ selected: item.id === workspace.id }" @click="emit('selectWorkspace', item)"><span class="folder-mark small">{{ item.name.slice(0, 1).toUpperCase() }}</span><span><strong>{{ item.name }}</strong><small>{{ item.path }}</small></span></button><button class="workspace-picker-remove" type="button" :aria-label="`从 CodyWork 移除 ${item.name}`" @click.stop="emit('removeWorkspace', item)">移除</button></div>
            <button class="menu-create" @click="emit('createWorkspace')">＋ 创建 Workspace</button>
          </div>
        </div>
        <div class="sidebar-section-label"><span>WORKSPACE</span><small>上下文与资产</small></div>
        <button v-for="item in workspacePages" :key="item.page" class="sidebar-item" :class="{ active: activePage === item.page }" :aria-label="collapsed ? item.label : undefined" :title="collapsed ? item.label : undefined" @click="emit('navigate', item.page)"><span>{{ item.icon }}</span><span class="sidebar-label"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span></button>
        <section class="sidebar-demand-section" aria-label="需求列表">
          <button class="sidebar-section-label sidebar-accordion-trigger" :class="{ expanded: demandExpanded }" type="button" :aria-expanded="demandExpanded" aria-controls="sidebar-demand-list" @click="emit('update:demandExpanded', !demandExpanded)"><span>WORK MODE</span><small>Demand / Worktree</small><em>{{ demands.length }}</em><i class="sidebar-accordion-chevron" aria-hidden="true">⌄</i></button>
          <div v-show="demandExpanded" id="sidebar-demand-list" class="sidebar-subnav">
            <button class="sidebar-subnav-item all-demands" :class="{ active: activePage === 'demands' }" @click="emit('navigate', 'demands')"><span class="subnav-rail-icon" aria-hidden="true">▦</span><span><strong>全部需求</strong><small>查看和管理 Worktree</small></span></button>
            <button v-for="demand in demands" :key="demand.id" class="sidebar-subnav-item" :class="{ active: activePage === 'chat' && demand.id === selectedDemandId }" @click="emit('openDemand', demand)"><span :class="['subnav-status', demand.status]" /><span><strong>{{ demand.name }}</strong><small>{{ demand.branchName }}</small></span><em :class="['demand-status-tag', demand.status]">{{ demandStatusLabel(demand.status) }}</em></button>
            <button v-if="demands.length === 0" class="sidebar-subnav-empty" @click="emit('createDemand')">还没有需求，创建第一个 Worktree</button>
          </div>
          <button v-show="demandExpanded" class="sidebar-new-demand" @click="emit('createDemand')"><span aria-hidden="true">＋</span> 新建需求</button>
        </section>
        <button v-if="collapsed" class="sidebar-rail-demand" type="button" aria-label="打开需求列表" title="打开需求列表" @click="emit('navigate', 'demands')"><span aria-hidden="true">▦</span><em>{{ demands.length }}</em></button>
      </template>
      <template v-else><div class="sidebar-section-label"><span>WORKSPACES</span><small>开始开发</small></div><button class="sidebar-item active" @click="emit('createWorkspace')"><span>＋</span><span class="sidebar-label"><strong>创建 Workspace</strong><small>目录或 Git 仓库</small></span></button></template>
    </div>
    <div class="sidebar-spacer" />
    <button class="sidebar-item" :class="{ active: activePage === 'settings' }" :aria-label="collapsed ? '设置' : undefined" :title="collapsed ? '设置' : undefined" @click="emit('navigate', 'settings')"><span>⚙</span><span class="sidebar-label"><strong>设置</strong><small>运行环境与快捷指令</small></span></button>
    <div class="sidebar-note"><span class="status-dot" :class="socketState" /><span><strong>{{ realtimeLabel }}</strong><small>{{ realtimeDetail }}</small></span></div>
    <div class="sidebar-collapse-footer">
      <button class="sidebar-panel-toggle" type="button" :aria-label="collapsed ? '展开工作台导航' : '收起工作台导航'" :aria-expanded="!collapsed" :title="collapsed ? '展开工作台导航' : '收起工作台导航'" @click="emit('update:collapsed', !collapsed)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="collapsed ? 'm10 6 6 6-6 6' : 'm14 6-6 6 6 6'" /></svg>
        <span class="sidebar-collapse-label">{{ collapsed ? '展开导航' : '收起导航' }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Demand, Workspace } from '../api'
import { demandStatusLabel } from '../workbenchUi'

type Page = 'dashboard' | 'demands' | 'knowledge' | 'skills' | 'settings' | 'chat'

const props = defineProps<{
  workspace: Workspace | null
  workspaces: Workspace[]
  demands: Demand[]
  selectedDemandId: string
  activePage: Page
  socketState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  workspacePickerOpen: boolean
  demandExpanded: boolean
  collapsed: boolean
}>()

const realtimeLabel = computed(() => {
  if (props.socketState === 'connected') return 'Realtime connected'
  if (props.socketState === 'connecting' || props.socketState === 'reconnecting') return 'Realtime connecting…'
  return 'Realtime disconnected'
})

const realtimeDetail = computed(() => {
  if (!props.workspace) return '选择一个 Workspace 开始'
  if (props.socketState === 'connected') return 'Browser WebSocket connected'
  if (props.socketState === 'connecting' || props.socketState === 'reconnecting') return 'Browser WebSocket reconnecting'
  return 'Browser WebSocket disconnected'
})

const emit = defineEmits<{
  'update:workspacePickerOpen': [value: boolean]
  'update:demandExpanded': [value: boolean]
  'update:collapsed': [value: boolean]
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
