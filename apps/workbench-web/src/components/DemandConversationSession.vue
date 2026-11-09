<template>
  <section class="parallel-session" :data-conversation-id="conversation.id" :aria-label="`${conversation.title}的对话`">
    <p v-if="error" class="parallel-session-error" role="alert">{{ error }}<button type="button" @click="error = ''" aria-label="关闭当前会话错误">×</button></p>
    <div ref="scroll" class="parallel-transcript" @scroll="trackScroll">
      <p v-if="loading" class="parallel-session-state" role="status">正在读取原生会话…</p>
      <button v-if="allEntries.length > visibleCount" class="btn parallel-history" @click="showEarlier">显示更早的消息</button>
      <CodyConversation variant="embedded" :entries="entries" @copy="copy" @retry-message="retry" @resolve-approval="approve" @resolve-question="answer" @open-file="emit('open-file', $event)">
        <template #empty><div v-if="!loading" class="parallel-empty-conversation"><WorkbenchIcon name="chat" /><strong>从这个会话继续</strong><p>消息会发给当前需求下的 {{ conversation.title }}。</p></div></template>
      </CodyConversation>
    </div>
    <button v-if="!atBottom" class="parallel-scroll-latest" aria-label="回到当前会话最新消息" @click="toBottom(true)">↓</button>
    <div class="parallel-session-composer" :class="{ 'settings-open': settingsOpen }">
      <div class="parallel-composer-note"><span :class="['parallel-connection', socket.status]">{{ socket.status === 'connected' ? '已连接' : socket.status === 'reconnecting' ? '重连中' : socket.status === 'disconnected' ? '连接已断开' : '连接中' }}</span><span>{{ conversation.runtimeType }} · {{ conversation.title }}</span><button v-if="!ready && !loading" type="button" @click="reloadOptions">重试加载</button></div>
      <CodyComposer variant="embedded" :draft="draft" :disabled="sending || !ready || permissionSaving" :is-running="running" :models="models" :selected-model="model" :reasoning-options="reasoningOptions" :selected-reasoning="reasoning" :permission-options="permissions" :selected-permission="permission" :submit-modes="submitModes" :selected-submit-mode="submitMode" :collaboration-modes="collaborationModes" :selected-collaboration-mode="collaboration" :skills="skills" :selected-skills="selectedSkills" :images="images" :image-upload-enabled="options?.capabilities.imageInput ?? false" :is-uploading-images="uploading" :image-error="imageError" placeholder="给当前需求的这个会话发送消息…（Control + Enter 发送）" @update:draft="updateDraft" @update:model="selectModel" @update:reasoning="reasoning = $event" @update:permission="selectPermission" @update:submit-mode="submitMode = $event as ComposerSubmitMode" @update:collaboration-mode="collaboration = $event" @update:selected-skills="selectedSkills = $event" @attach-images="uploadImages" @remove-image="removeImage" @send="send" @stop="interrupt">
        <template #controls><button class="parallel-settings-toggle" type="button" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">{{ settingsOpen ? '收起设置' : `设置 · ${permissions.find(item => item.value === permission)?.label}` }}</button></template>
      </CodyComposer>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CodyComposer, CodyConversation, conversationEntriesFromState, useConversationController, type CodyMessage } from '@codycodeagent/cody-web-core/vue'
import { composerHasContent, resolveComposerSubmitMode, type ComposerImage, type ComposerSubmitMode } from '@codycodeagent/cody-web-core/composer'
import { api, type ComposerOptions, type Conversation, type ConversationPermissionMode } from '../api'
import { initialModelId, modelDescription, reasoningOptionsForModel, reconcileReasoningEffort } from '../composerModels'
import { conversationStatusFromState, conversationStatusLabel } from '../workbenchUi'
import { initialConversationSocketSnapshot } from '../conversationSocket'
import { workbenchConversationTransport } from '../workbenchConversationTransport'
import { conversationImageDrafts, conversationTextDrafts } from '../conversationDrafts'
import WorkbenchIcon from './WorkbenchIcon.vue'

const props = defineProps<{ workspaceId: string; demandId: string; conversation: Conversation; active: boolean }>()
const emit = defineEmits<{ status: [status: Conversation['status']]; 'open-file': [input: { path: string; line: number }] }>()
const controller = useConversationController()
const { state } = controller
const options = ref<ComposerOptions | null>(null)
const loading = ref(true), ready = ref(false), error = ref(''), sending = ref(false), uploading = ref(false), imageError = ref('')
const draft = ref(conversationTextDrafts.get(props.conversation.id) ?? '')
const images = ref<ComposerImage[]>(conversationImageDrafts.get(props.conversation.id) ?? [])
const model = ref(''), reasoning = ref('medium'), permission = ref<ConversationPermissionMode>(props.conversation.permissionMode), permissionSaving = ref(false)
const submitMode = ref<ComposerSubmitMode>('queue'), collaboration = ref('default'), selectedSkills = ref<string[]>([]), settingsOpen = ref(false)
const socket = ref(initialConversationSocketSnapshot())
const scroll = ref<HTMLElement | null>(null), atBottom = ref(true), visibleCount = ref(80)
let alive = true
const allEntries = computed(() => conversationEntriesFromState(state.value))
const entries = computed(() => allEntries.value.slice(-visibleCount.value))
const status = computed(() => conversationStatusFromState(props.conversation.status, state.value.threadId === props.conversation.nativeId ? state.value : null))
const running = computed(() => status.value === 'running' || status.value === 'awaiting_approval')
const models = computed(() => options.value?.capabilities.modelSelection ? options.value.models.map(item => ({ value: item.id, label: item.label, description: modelDescription(item) })) : [])
const reasoningOptions = computed(() => options.value?.capabilities.reasoning ? reasoningOptionsForModel(options.value.models, model.value) : [])
const permissions = [{ value: 'read-only', label: '只读' }, { value: 'workspace-write', label: 'Normal' }, { value: 'yolo', label: 'YOLO' }]
const submitModes = computed(() => [{ value: 'queue', label: '排队' }, ...(options.value?.capabilities.steer ? [{ value: 'steer', label: '引导' }] : []), ...(options.value?.capabilities.append ? [{ value: 'append', label: '追加' }] : [])])
const collaborationModes = computed(() => options.value?.capabilities.planMode ? [{ value: 'default', label: 'Default' }, { value: 'plan', label: 'Plan' }] : [])
const skills = computed(() => options.value?.capabilities.structuredSkills ? options.value.skills.filter(item => item.enabled).map(item => ({ value: item.id, label: item.label, description: `${item.description} · ${item.path}` })) : [])

watch(status, value => emit('status', value), { immediate: true })
watch(() => props.active, async value => { if (value) { await nextTick(); if (atBottom.value) await toBottom(true) } })
watch(() => state.value, () => { if (props.active && atBottom.value) void toBottom() })
watch(() => props.conversation.permissionMode, value => { permission.value = value })
watch(images, value => {
  if (value.length) conversationImageDrafts.set(props.conversation.id, [...value])
  else conversationImageDrafts.delete(props.conversation.id)
}, { deep: true })
onBeforeUnmount(() => { alive = false }) // Core's scope disposal closes the subscription, never interrupts a Turn.
onMounted(async () => {
  try {
    await Promise.all([
      controller.connect(props.conversation.nativeId, workbenchConversationTransport(props.workspaceId, props.conversation, { onState: value => { if (alive) socket.value = value } })),
      reloadOptions(),
    ])
    if (alive) await toBottom(true)
  } catch (cause) { fail(cause) } finally { if (alive) loading.value = false }
})
function fail(cause: unknown) { if (alive) error.value = cause instanceof Error ? cause.message : String(cause) }
async function reloadOptions() {
  try {
    const next = await api.composerOptions(props.workspaceId, props.demandId, props.conversation.id)
    if (!alive) return
    options.value = next
    model.value = next.capabilities.modelSelection ? initialModelId(next.models) : ''
    reasoning.value = next.capabilities.reasoning ? reconcileReasoningEffort(next.models, model.value, reasoning.value) : ''
    submitMode.value = next.capabilities.append && !next.capabilities.steer ? 'append' : 'queue'
    ready.value = true
  } catch (cause) { ready.value = false; fail(cause) }
}
function updateDraft(value: string) {
  draft.value = value
  if (value) conversationTextDrafts.set(props.conversation.id, value)
  else conversationTextDrafts.delete(props.conversation.id)
}
function selectModel(value: string) {
  model.value = value
  reasoning.value = reconcileReasoningEffort(options.value?.models ?? [], value, reasoning.value)
}
async function selectPermission(value: string) {
  if (permissionSaving.value || !permissions.some(item => item.value === value)) return
  permissionSaving.value = true
  try { const updated = await api.setConversationPermission(props.workspaceId, props.conversation.id, value as ConversationPermissionMode); if (alive) permission.value = updated.permissionMode } catch (cause) { fail(cause) } finally { if (alive) permissionSaving.value = false }
}
function settings(skillIds: string[]) {
  return {
    ...(options.value?.capabilities.modelSelection && model.value ? { model: model.value } : {}),
    ...(options.value?.capabilities.reasoning && reasoning.value ? { reasoningEffort: reasoning.value } : {}),
    collaborationMode: options.value?.capabilities.planMode && collaboration.value === 'plan' ? 'plan' as const : 'default' as const,
    ...(skillIds.length ? { skills: skillIds } : {}),
  }
}
async function send() {
  if (!ready.value || sending.value || uploading.value || permissionSaving.value) return
  const text = draft.value.trim(), attachments = [...images.value], skillIds = [...selectedSkills.value]
  if (!composerHasContent({ text, images: attachments, skills: skillIds })) return
  const refs = skillIds.flatMap(id => { const skill = options.value?.skills.find(item => item.id === id && item.enabled); return skill ? [{ name: skill.name, path: skill.id, displayName: skill.label }] : [] })
  sending.value = true; error.value = ''; updateDraft(''); atBottom.value = true
  try {
    const mode = resolveComposerSubmitMode(running.value, submitMode.value)
    await controller.submitUserMessage({ text: text || refs.map(item => `$${item.displayName}`).join(' '), images: attachments.map(item => item.url), skills: refs }, {
      mode,
      input: { content: text, imageIds: attachments.map(item => item.id), ...(mode === 'append' ? {} : { settings: settings(skillIds) }) },
    })
    if (alive) { images.value = []; selectedSkills.value = [] }
  } catch (cause) { fail(cause) } finally { if (alive) sending.value = false }
}
async function retry(message: CodyMessage) {
  if (!ready.value || sending.value || permissionSaving.value || message.outbox?.status !== 'failed') return
  sending.value = true; error.value = ''
  try {
    const skillIds = (message.skills ?? []).map(item => item.path).filter(id => options.value?.skills.some(item => item.id === id && item.enabled))
    const imageIds = (message.images ?? []).flatMap(url => { try { const id = new URL(url, location.origin).pathname.split('/').at(-1); return id?.startsWith('image_') ? [id] : [] } catch { return [] } })
    await controller.retryFailedUserMessage(message.id, { mode: resolveComposerSubmitMode(running.value, submitMode.value), input: { content: message.text, imageIds, settings: settings(skillIds) } })
  } catch (cause) { fail(cause) } finally { if (alive) sending.value = false }
}
async function interrupt() { try { await controller.interrupt() } catch (cause) { fail(cause) } }
async function approve(id: string, decision: 'accept' | 'decline') { try { await api.resolveApproval(props.workspaceId, props.conversation.id, id, decision === 'accept' ? 'allowed-once' : 'rejected') } catch (cause) { fail(cause) } }
async function answer(id: string, value: Record<string, { answers: string[] }>) { try { await api.answerQuestion(props.workspaceId, props.conversation.id, id, value) } catch (cause) { fail(cause) } }
async function copy(text: string) { try { await navigator.clipboard.writeText(text) } catch (cause) { fail(cause) } }
function readImage(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取图片')); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(file) }) }
async function uploadImages(files: File[]) {
  if (uploading.value || !options.value?.capabilities.imageInput) return
  const remaining = 8 - images.value.length
  if (remaining <= 0) { imageError.value = '每条消息最多附加 8 张图片'; return }
  uploading.value = true; imageError.value = files.length > remaining ? '仅添加前 8 张图片' : ''
  try {
    const next = await Promise.all(files.slice(0, remaining).map(async file => {
      const uploaded = await api.uploadConversationImage(props.workspaceId, props.conversation.id, { name: file.name, dataUrl: await readImage(file) })
      return { ...uploaded, path: '' }
    }))
    if (alive) images.value = [...images.value, ...next]
  } catch (cause) { if (alive) imageError.value = cause instanceof Error ? cause.message : String(cause) } finally { if (alive) uploading.value = false }
}
function removeImage(id: string) { images.value = images.value.filter(item => item.id !== id); imageError.value = '' }
function trackScroll() { const el = scroll.value; if (el) atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 32 }
async function toBottom(force = false) { if (!force && !atBottom.value) return; await nextTick(); const el = scroll.value; if (el) { el.scrollTop = el.scrollHeight; atBottom.value = true } }
async function showEarlier() { const el = scroll.value, height = el?.scrollHeight ?? 0, top = el?.scrollTop ?? 0; visibleCount.value += 80; await nextTick(); if (el) el.scrollTop = top + el.scrollHeight - height }
</script>
