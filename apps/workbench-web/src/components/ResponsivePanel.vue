<template>
  <dialog
    v-if="mobile"
    ref="dialog"
    class="responsive-panel"
    :aria-labelledby="titleId"
    @cancel.prevent="requestClose"
    @close="onNativeClose"
    @click="onBackdropClick"
  >
    <header class="responsive-panel-heading">
      <h2 :id="titleId">{{ title }}</h2>
      <button type="button" :aria-label="`关闭${title}`" autofocus @click="requestClose">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div class="responsive-panel-content"><slot /></div>
  </dialog>
  <slot v-else />
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const titleId = `responsive-panel-${useId()}`
const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(max-width: 900px)') : null
const mobile = ref(media?.matches ?? false)
const dialog = ref<HTMLDialogElement | null>(null)
let returnFocus: HTMLElement | null = null
let disposed = false

function closeDialog() {
  if (dialog.value?.open) dialog.value.close()
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
}
function requestClose() {
  closeDialog()
  emit('update:open', false)
}
function onNativeClose() {
  if (props.open && mobile.value) emit('update:open', false)
}
function onBackdropClick(event: MouseEvent) {
  const element = dialog.value
  if (!element || event.target !== element) return
  const bounds = element.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose()
}
async function syncDialog() {
  await nextTick()
  if (disposed) return
  if (mobile.value && props.open && dialog.value && !dialog.value.open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value.showModal()
  } else if (!props.open || !mobile.value) closeDialog()
}
function onMediaChange(event: MediaQueryListEvent) {
  // Release the top layer before Vue removes the dialog at the desktop breakpoint.
  if (!event.matches) {
    closeDialog()
    if (props.open) emit('update:open', false)
  }
  mobile.value = event.matches
}
onMounted(() => { media?.addEventListener('change', onMediaChange); void syncDialog() })
watch([() => props.open, mobile], syncDialog, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; media?.removeEventListener('change', onMediaChange); closeDialog() })
</script>

<style scoped>
.responsive-panel {
  position: fixed;
  inset: 0 auto 0 0;
  width: 320px;
  max-width: calc(100vw - 24px);
  height: 100vh;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
  color: #d7dbe5;
  background: #101217;
  border: 0;
  border-radius: 0 20px 20px 0;
  box-shadow: 16px 0 64px #08101f44;
}
.responsive-panel[open] { display: flex; flex-direction: column; }
.responsive-panel::backdrop { background: #07102080; backdrop-filter: blur(3px); }
.responsive-panel-heading {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: max(12px, env(safe-area-inset-top)) 16px 12px max(20px, env(safe-area-inset-left));
  border-bottom: 1px solid #ffffff14;
}
.responsive-panel-heading h2 { margin: 0; color: #f5f6fb; font-size: 14px; font-weight: 600; }
.responsive-panel-heading button { display: grid; place-items: center; width: 44px; height: 44px; padding: 11px; color: #cbd5e1; background: #ffffff0a; border: 1px solid #ffffff1a; border-radius: 12px; }
.responsive-panel-heading svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
.responsive-panel-content { min-height: 0; flex: 1; display: flex; overflow: hidden; padding-bottom: env(safe-area-inset-bottom); }
.responsive-panel-content :deep(> aside) { position: static; display: flex; width: 100%; height: 100%; max-height: none; min-width: 0; flex: 1 1 auto; }
</style>
