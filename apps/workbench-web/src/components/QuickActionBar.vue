<template>
  <section v-if="actions.length" class="quick-bar" aria-label="需求开发快捷指令">
    <div class="quick-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8H8zM5 8a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H5Z" /></svg><strong>快捷指令</strong></div>
    <div class="quick-list">
      <button v-for="action in actions" :key="action.id" type="button" class="quick-chip" :disabled="disabled || action.missingSkillIds.length > 0" :title="actionTitle(action)" @click="emit('execute', action)">
        <span>{{ action.name }}</span><em v-if="action.skills.length">{{ action.skills.length }} Skills</em>
      </button>
    </div>
    <span v-if="feedback" class="quick-feedback" role="status">{{ feedback }}</span>
  </section>
</template>

<script setup lang="ts">
import type { QuickAction } from '../api'
defineProps<{ actions: QuickAction[]; disabled: boolean; feedback: string }>()
const emit = defineEmits<{ execute: [action: QuickAction] }>()
function actionTitle(action: QuickAction): string {
  return action.missingSkillIds.length ? `Skill 已失效，请到设置中修复：${action.skills.filter(skill => skill.status !== 'available').map(skill => skill.name).join('、')}` : `立即${action.name}`
}
</script>

<style scoped>
.quick-bar{display:flex;align-items:center;gap:10px;min-height:52px;padding:3px 1px 5px}.quick-label{display:flex;align-items:center;gap:6px;flex:0 0 auto;color:#667389;font-size:11px}.quick-label svg{width:16px;height:16px;color:#4d70dc;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.quick-list{display:flex;gap:8px;min-width:0;overflow-x:auto;padding:2px}.quick-chip{display:flex;align-items:center;gap:7px;min-height:44px;padding:7px 12px;color:#37445a;background:#fff;border:1px solid #d5dce8;border-radius:9px;white-space:nowrap;font-size:11px;font-weight:700}.quick-chip:hover:not(:disabled){color:#315ecb;border-color:#9fb4ef;background:#f7f9ff}.quick-chip em{padding:2px 5px;color:#6e7d96;background:#eef2f7;border-radius:999px;font-size:9px;font-style:normal;font-weight:600}.quick-feedback{flex:0 0 auto;color:#27845f;font-size:10px;font-weight:700}@media(max-width:820px){.quick-label strong{display:none}.quick-feedback{display:none}}
</style>
