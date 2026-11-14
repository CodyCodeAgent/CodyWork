<template>
  <div ref="root" :class="['chat-toolbar-popover', { 'is-inline': inline }]" @focusout="onFocusOut" @keydown.esc="onEscape">
    <button v-if="!inline" ref="trigger" class="chat-toolbar-trigger" type="button" :aria-label="label" :title="label" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="open ? dismiss() : reveal()" @keydown.down.prevent="reveal">
      <slot name="trigger" />
      <span v-if="attention" class="chat-toolbar-attention" aria-hidden="true" />
    </button>
    <section v-if="inline || open" :id="panelId" ref="panel" class="chat-toolbar-popover-panel" :role="inline ? 'group' : 'dialog'" :aria-label="label" tabindex="-1">
      <slot :close="closeForAction" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps<{ label: string; inline?: boolean; attention?: boolean }>()
const panelId = `chat-toolbar-${useId()}`
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const open = ref(false)

async function reveal() {
  if (open.value || props.inline) return
  open.value = true
  document.addEventListener('pointerdown', onOutsidePointer)
  await nextTick()
  if (open.value) (panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? panel.value)?.focus()
}
function closeWithoutFocus() {
  open.value = false
  document.removeEventListener('pointerdown', onOutsidePointer)
}
function closeForAction() {
  closeWithoutFocus()
  // Give a subsequently mounted modal a persistent opener rather than a removed menu item.
  trigger.value?.focus({ preventScroll: true })
}
function dismiss() {
  if (!open.value) return
  closeForAction()
  void nextTick(() => trigger.value?.focus())
}
function onEscape(event: KeyboardEvent) {
  if (!open.value) return
  event.preventDefault()
  event.stopPropagation()
  dismiss()
}
function onOutsidePointer(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) closeWithoutFocus()
}
function onFocusOut(event: FocusEvent) {
  if (event.relatedTarget && !root.value?.contains(event.relatedTarget as Node)) closeWithoutFocus()
}
watch(() => props.inline, closeWithoutFocus)
onBeforeUnmount(closeWithoutFocus)
</script>

<style scoped>
.chat-toolbar-popover { position: relative; flex: 0 0 auto; }
.chat-toolbar-trigger { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 38px; min-height: 38px; padding: 8px 10px; color: var(--muted); background: transparent; border: 1px solid transparent; border-radius: var(--radius-control); cursor: pointer; transition: color 150ms ease, background 150ms ease; }
.chat-toolbar-trigger:hover, .chat-toolbar-trigger[aria-expanded='true'] { color: var(--blue); background: var(--blue-soft); }
.chat-toolbar-attention { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--warning); }
.chat-toolbar-popover-panel { position: absolute; top: calc(100% + 10px); right: 0; z-index: 65; width: 248px; max-width: calc(100vw - 32px); padding: 8px; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-panel); box-shadow: var(--shadow-popover); animation: toolbar-reveal 150ms ease-out; }
.is-inline { width: 100%; }
.is-inline .chat-toolbar-popover-panel { position: static; width: 100%; max-width: none; padding: 0; border: 0; border-radius: 0; box-shadow: none; animation: none; }
@keyframes toolbar-reveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .chat-toolbar-trigger { transition: none; } .chat-toolbar-popover-panel { animation: none; } }
</style>
