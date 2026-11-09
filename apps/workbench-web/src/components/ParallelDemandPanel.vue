<template>
  <article class="parallel-demand-panel" :data-demand-id="demand.id" :aria-label="`${demand.name}面板`">
    <header class="parallel-panel-head">
      <div class="parallel-panel-title"><span class="parallel-demand-mark"><WorkbenchIcon name="branch" /></span><strong :title="demand.name">{{ demand.name }}</strong><div class="parallel-panel-actions"><button class="icon-button" type="button" :aria-label="`${expanded ? '退出放大' : '放大'}${demand.name}`" @click="emit('expand')"><WorkbenchIcon :name="expanded ? 'columns' : 'expand'" /></button><ChatToolbarPopover label="需求面板操作"><template #trigger><WorkbenchIcon name="more" /></template><template #default="{ close }"><button class="toolbar-menu-action" type="button" @click="close(); emit('open', selected?.id ?? null)">打开完整需求</button><button class="toolbar-menu-action" type="button" @click="close(); emit('remove')">从视图移除</button><p class="parallel-menu-note">只移除面板，会话继续执行。</p></template></ChatToolbarPopover></div></div>
      <div class="parallel-panel-session-row">
        <select :aria-label="`切换${demand.name}的会话`" :value="selected?.id ?? ''" @focus="refresh" @change="selectConversation(($event.target as HTMLSelectElement).value)"><option v-if="!selected" value="">{{ refreshing ? '读取会话中…' : '请选择会话' }}</option><option v-for="item in conversations" :key="item.id" :value="item.id">{{ item.title }} · {{ conversationStatusLabel(statuses[item.id] ?? item.status) }}</option></select>
        <button class="parallel-new-session" type="button" :aria-label="`在${demand.name}新建会话`" title="新建会话" @click="openCreate"><WorkbenchIcon name="plus" /></button>
        <span v-if="selected" :class="['parallel-session-status', currentStatus]">{{ conversationStatusLabel(currentStatus) }}</span>
      </div>
    </header>
    <p v-if="loadError" class="parallel-panel-error" role="alert">{{ loadError }}<button type="button" @click="refresh">重试</button></p>
    <div v-if="!selected && !refreshing" class="parallel-panel-empty"><p>这个需求还没有可用会话。</p><button class="btn" @click="openCreate">新建会话</button></div>
    <DemandConversationSession v-for="item in visitedConversations" v-show="selected?.id === item.id" :key="item.id" :workspace-id="workspaceId" :demand-id="demand.id" :conversation="item" :active="active && selected?.id === item.id" @status="statuses[item.id] = $event" @open-file="emit('open-file', item.id, $event)" />
    <dialog ref="createDialog" class="parallel-dialog" :aria-labelledby="createTitleId" @close="createError = ''" @cancel="creating && $event.preventDefault()">
      <form @submit.prevent="createConversation"><div class="parallel-dialog-head"><h2 :id="createTitleId">新建需求会话</h2><button class="icon-button" type="button" aria-label="关闭新建会话" :disabled="creating" @click="createDialog?.close()">×</button></div><p>{{ demand.name }} · 新会话仍属于这个需求。</p><label>会话名称<input v-model="createTitle" maxlength="120" placeholder="例如：接口联调" :disabled="creating" autofocus /></label><label>Runtime<select v-model="createRuntime" :disabled="creating"><option v-for="runtime in availableRuntimes" :key="runtime.id" :value="runtime.id">{{ runtime.label }}</option></select></label><p v-if="createError" class="form-error" role="alert">{{ createError }}</p><div class="parallel-dialog-actions"><button class="btn" type="button" :disabled="creating" @click="createDialog?.close()">取消</button><button class="btn primary" :disabled="creating || !createRuntime">{{ creating ? '创建中…' : '创建会话' }}</button></div></form>
    </dialog>
  </article>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { api, type Conversation, type Demand, type RuntimeDescriptor } from '../api'
import { conversationStatusLabel } from '../workbenchUi'
import DemandConversationSession from './DemandConversationSession.vue'
import WorkbenchIcon from './WorkbenchIcon.vue'
import ChatToolbarPopover from './ChatToolbarPopover.vue'

const props = defineProps<{ workspaceId: string; demand: Demand; conversationId: string | null; active: boolean; expanded: boolean; runtimes: RuntimeDescriptor[] }>()
const emit = defineEmits<{ select: [id: string]; expand: []; remove: []; open: [id: string | null]; 'open-file': [conversationId: string, input: { path: string; line: number }]; summary: [value: { running: number; waiting: number }] }>()
const conversations = ref<Conversation[]>([]), statuses = ref<Record<string, Conversation['status']>>({}), visited = ref<string[]>([])
const refreshing = ref(false), loadError = ref('')
const selected = computed(() => conversations.value.find(item => item.id === props.conversationId) ?? conversations.value[0])
const visitedConversations = computed(() => conversations.value.filter(item => visited.value.includes(item.id)))
const currentStatus = computed(() => selected.value ? statuses.value[selected.value.id] ?? selected.value.status : 'idle')
const summary = computed(() => conversations.value.reduce((result, item) => { const status = statuses.value[item.id] ?? item.status; if (status === 'running') result.running++; if (status === 'awaiting_approval') result.waiting++; return result }, { running: 0, waiting: 0 }))
watch(summary, value => emit('summary', value), { immediate: true })
watch(() => selected.value?.id, id => { if (id) { if (!visited.value.includes(id)) visited.value.push(id); if (props.conversationId !== id) emit('select', id) } }, { immediate: true })
let alive = true, listGeneration = 0, timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void refresh(); timer = setInterval(() => { if (!document.hidden) void refresh() }, 15_000); window.addEventListener('focus', onFocus) })
onBeforeUnmount(() => { alive = false; clearInterval(timer); window.removeEventListener('focus', onFocus) })
function onFocus() { void refresh() }
async function refresh() {
  if (refreshing.value || !alive) return
  refreshing.value = true
  const generation = listGeneration
  try {
    const next = await api.listConversations(props.workspaceId, props.demand.id)
    if (!alive || generation !== listGeneration) return
    conversations.value = next.filter(item => item.scope === 'demand' && item.demandId === props.demand.id)
    loadError.value = ''
  } catch (cause) { if (alive && generation === listGeneration) loadError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (alive) refreshing.value = false }
}
function selectConversation(id: string) { if (conversations.value.some(item => item.id === id)) emit('select', id) }
const createDialog = ref<HTMLDialogElement | null>(null), createTitleId = `parallel-create-${useId()}`
const createTitle = ref(''), createRuntime = ref(''), creating = ref(false), createError = ref('')
const availableRuntimes = computed(() => props.runtimes.length ? props.runtimes : selected.value ? [{ id: selected.value.runtimeType, label: selected.value.runtimeType }] : [])
function openCreate() { createTitle.value = ''; createError.value = ''; createRuntime.value = selected.value?.runtimeType ?? availableRuntimes.value[0]?.id ?? ''; createDialog.value?.showModal() }
async function createConversation() {
  if (creating.value || !createRuntime.value) return
  creating.value = true; createError.value = ''
  try {
    const created = await api.createConversation(props.workspaceId, props.demand.id, createTitle.value.trim() || undefined, createRuntime.value)
    if (!alive) return
    listGeneration += 1
    conversations.value = [created, ...conversations.value.filter(item => item.id !== created.id)]
    emit('select', created.id); createDialog.value?.close()
  } catch (cause) { if (alive) createError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (alive) creating.value = false }
}
</script>
