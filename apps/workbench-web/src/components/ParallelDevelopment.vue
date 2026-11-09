<template>
  <section class="parallel-development">
    <header class="topbar parallel-topbar"><div><div class="eyebrow">WORKSPACE / PARALLEL DEVELOPMENT</div><h1>并行开发</h1><p>一个工作空间，同时推进多个需求。</p></div><div class="parallel-topbar-actions"><div class="parallel-layout-toggle" aria-label="并行布局"><button type="button" :class="{ active: view.layout === 'columns' }" :aria-pressed="view.layout === 'columns'" @click="setLayout('columns')"><WorkbenchIcon name="columns" />双列</button><button type="button" :class="{ active: view.layout === 'grid' }" :aria-pressed="view.layout === 'grid'" @click="setLayout('grid')"><WorkbenchIcon name="grid" />四宫格</button></div><button class="btn primary" :disabled="loading || view.panels.length >= 4" @click="openAdd"><WorkbenchIcon name="plus" />添加需求</button></div></header>
    <div v-if="error" class="parallel-save-error" role="alert"><span>{{ dirty ? '布局尚未保存：' : '' }}{{ error }}</span><button v-if="dirty" class="btn" :disabled="saving" @click="save">重试保存</button><button class="btn" :disabled="saving" @click="load">重新加载布局</button></div>
    <div class="parallel-view-bar"><strong>我的开发视图<span>{{ loading ? '正在读取…' : error ? '配置需要处理' : saving ? '正在保存…' : dirty ? '尚未保存' : '布局已保存到工作空间' }}</span></strong><div><span>{{ totals.running }} 个执行中</span><span :class="{ 'has-waiting': totals.waiting }">{{ totals.waiting }} 个待确认</span><button v-if="expanded" class="parallel-exit-focus" @click="expanded = ''">返回并行视图</button></div></div>
    <p v-if="loading" class="parallel-page-state" role="status">正在读取并行视图…</p>
    <div v-else-if="!view.panels.length" class="parallel-page-empty"><WorkbenchIcon name="columns" /><h2>把正在推进的需求放在一起</h2><p>添加最多 4 个需求，在各自的面板内选择真实会话。原有历史和执行状态保持同步。</p><button class="btn primary" @click="openAdd">添加第一个需求</button></div>
    <template v-else>
      <nav class="parallel-mobile-tabs" aria-label="选择需求面板"><button v-for="panel in view.panels" :key="panel.demandId" type="button" :class="{ active: mobileActive === panel.demandId }" @click="mobileActive = panel.demandId; expanded = ''">{{ demandFor(panel.demandId)?.name ?? '需求已移除' }}<span v-if="summaries[panel.demandId]?.waiting" class="parallel-attention-dot" aria-label="有待确认会话" /></button></nav>
      <div :class="['parallel-board', view.layout, { 'has-expanded': expanded }]">
        <template v-for="panel in view.panels" :key="panel.demandId">
          <ParallelDemandPanel v-if="demandFor(panel.demandId)" v-show="!expanded || expanded === panel.demandId" :class="{ 'mobile-active': mobileActive === panel.demandId, expanded: expanded === panel.demandId }" :workspace-id="workspace.id" :demand="demandFor(panel.demandId)!" :conversation-id="panel.conversationId" :active="(!expanded || expanded === panel.demandId) && (!compact || mobileActive === panel.demandId)" :expanded="expanded === panel.demandId" :runtimes="runtimes" @select="selectConversation(panel.demandId, $event)" @expand="expanded = expanded === panel.demandId ? '' : panel.demandId; mobileActive = panel.demandId" @remove="remove(panel.demandId)" @open="emit('open', panel.demandId, $event)" @open-file="(id, file) => emit('open-file', panel.demandId, id, file)" @summary="summaries[panel.demandId] = $event" />
          <div v-else class="parallel-missing-demand"><p>这个需求已被移除或暂不可用。</p><button class="btn" @click="remove(panel.demandId)">移除面板</button></div>
        </template>
        <button v-if="view.layout === 'grid' && view.panels.length < 4 && !expanded" class="parallel-add-panel" @click="openAdd"><WorkbenchIcon name="plus" />添加另一个需求</button>
      </div>
    </template>
    <footer class="parallel-footer">每个面板独立操作 · 切换会话不停止后台任务 · 最多添加 4 个需求</footer>
    <dialog ref="addDialog" class="parallel-dialog" aria-labelledby="parallel-add-title"><div class="parallel-dialog-head"><h2 id="parallel-add-title">添加需求到当前视图</h2><button class="icon-button" aria-label="关闭添加需求" @click="addDialog?.close()">×</button></div><p>选择需求后，在面板顶部切换该需求下的会话。</p><p v-if="catalogError" role="alert" class="form-error">{{ catalogError }}<button class="btn" @click="refreshCatalog">重试读取需求</button></p><p v-if="catalogLoading" role="status">正在刷新需求…</p><input v-model="query" class="input" aria-label="搜索可添加需求" placeholder="搜索需求名称或分支…" /><div class="parallel-demand-choices"><button v-for="demand in matchingDemands" :key="demand.id" :disabled="view.panels.some(panel => panel.demandId === demand.id)" @click="add(demand)"><WorkbenchIcon name="branch" /><span><strong>{{ demand.name }}</strong><small>{{ demand.branchName }}</small></span><em>{{ view.panels.some(panel => panel.demandId === demand.id) ? '已添加' : '＋ 添加' }}</em></button><p v-if="!matchingDemands.length">没有匹配的需求。</p></div></dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, type Demand, type ParallelView, type RuntimeDescriptor, type Workspace } from '../api'
import { useParallelLayout } from '../useParallelLayout'
import ParallelDemandPanel from './ParallelDemandPanel.vue'
import WorkbenchIcon from './WorkbenchIcon.vue'

const props = defineProps<{ workspace: Workspace; demands: Demand[] }>()
const emit = defineEmits<{ open: [demandId: string, conversationId: string | null]; 'open-file': [demandId: string, conversationId: string, file: { path: string; line: number }] }>()
const { view, loading, saving, dirty, error, load, update, save } = useParallelLayout(props.workspace.id)
const catalog = ref([...props.demands]), catalogError = ref(''), catalogLoading = ref(false)
watch(() => props.demands, value => { catalog.value = [...value] })
const expanded = ref(''), mobileActive = ref(''), query = ref(''), addDialog = ref<HTMLDialogElement | null>(null)
const summaries = ref<Record<string, { running: number; waiting: number }>>({}), runtimes = ref<RuntimeDescriptor[]>([])
const media = window.matchMedia('(max-width: 900px)'), compact = ref(media.matches)
let alive = true
const totals = computed(() => view.value.panels.reduce((result, panel) => { const summary = summaries.value[panel.demandId]; result.running += summary?.running ?? 0; result.waiting += summary?.waiting ?? 0; return result }, { running: 0, waiting: 0 }))
const matchingDemands = computed(() => { const needle = query.value.trim().toLowerCase(); return catalog.value.filter(item => `${item.name} ${item.branchName}`.toLowerCase().includes(needle)) })
function demandFor(id: string) { return catalog.value.find(item => item.id === id) }
function onMedia(event: MediaQueryListEvent) { compact.value = event.matches }
onMounted(() => { void load(); media.addEventListener('change', onMedia); void api.runtimeSettings().then(value => { if (alive) runtimes.value = value.runtimes }).catch(() => {}) })
onBeforeUnmount(() => { alive = false; media.removeEventListener('change', onMedia) })
watch(() => view.value.panels.map(panel => panel.demandId), ids => { if (!ids.includes(mobileActive.value)) mobileActive.value = ids[0] ?? ''; if (!ids.includes(expanded.value)) expanded.value = '' }, { immediate: true })
function openAdd() { query.value = ''; addDialog.value?.showModal(); void refreshCatalog() }
async function refreshCatalog() {
  if (catalogLoading.value) return
  catalogLoading.value = true; catalogError.value = ''
  try { const next = await api.listDemands(props.workspace.id); if (alive) catalog.value = next }
  catch (cause) { if (alive) catalogError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (alive) catalogLoading.value = false }
}
function add(demand: Demand) { if (loading.value || view.value.panels.length >= 4 || view.value.panels.some(item => item.demandId === demand.id)) return; update({ ...view.value, panels: [...view.value.panels, { demandId: demand.id, conversationId: null }] }); mobileActive.value = demand.id; addDialog.value?.close() }
function remove(id: string) { update({ ...view.value, panels: view.value.panels.filter(item => item.demandId !== id) }); delete summaries.value[id] }
function setLayout(layout: ParallelView['layout']) { if (loading.value || layout === view.value.layout) return; expanded.value = ''; update({ ...view.value, layout }) }
function selectConversation(demandId: string, conversationId: string) { if (!view.value.panels.some(item => item.demandId === demandId && item.conversationId !== conversationId)) return; update({ ...view.value, panels: view.value.panels.map(item => item.demandId === demandId ? { ...item, conversationId } : item) }) }
</script>
