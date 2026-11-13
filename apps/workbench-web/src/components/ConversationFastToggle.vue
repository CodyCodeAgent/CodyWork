<template>
  <button
    class="conversation-fast-toggle"
    type="button"
    aria-label="快速模式"
    :aria-pressed="enabled"
    title="快速模式 · 仅用于当前会话后续新一轮请求，用量更多"
    @click="setConversationFast(conversationId, !enabled)"
  >
    <WorkbenchIcon name="bolt" />
    <span>快速</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isConversationFast, setConversationFast } from '../conversationFastMode'
import WorkbenchIcon from './WorkbenchIcon.vue'

const props = defineProps<{ conversationId: string }>()
const enabled = computed(() => isConversationFast(props.conversationId))
</script>

<style scoped>
.conversation-fast-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 6px;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--cw-composer-control-bg);
  color: var(--cw-composer-control-text);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}
.conversation-fast-toggle :deep(.workbench-icon) {
  width: 16px;
  height: 16px;
}
.conversation-fast-toggle:hover,
.conversation-fast-toggle[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--blue) 24%, var(--line));
  background: var(--blue-soft);
  color: var(--blue);
}
.conversation-fast-toggle[aria-pressed='true'] :deep(.workbench-icon) {
  fill: currentColor;
}
@media (max-width: 900px) {
  .conversation-fast-toggle { min-height: 44px; padding-inline: 10px; }
}
</style>
