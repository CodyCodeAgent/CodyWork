<template>
  <div class="settings-overview">
    <section class="settings-nav-column" aria-labelledby="settings-workspace-title">
      <header class="settings-column-head">
        <span class="eyebrow">WORKSPACE &amp; RUNTIME</span>
        <h2 id="settings-workspace-title">运行环境与工作流</h2>
        <p class="settings-lead">管理当前 Workspace 的运行环境、自动化任务与协作通道。</p>
      </header>
      <div class="settings-grid">
        <button type="button" class="settings-tile settings-tile--featured" @click="emit('open', 'runtime')">
          <span class="tile-icon runtime" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="4" /></svg></span>
          <span class="tile-copy"><strong>Runtime</strong><small>切换 Codex、Gemini (Antigravity) 与 Trae ACP，配置启动命令与连接检查。</small></span>
          <span class="tile-badge">多引擎</span><span class="tile-arrow" aria-hidden="true">→</span>
        </button>
        <button type="button" class="settings-tile" @click="emit('open', 'quick-actions')">
          <span class="tile-icon accent" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 8h8v8H8zM5 8a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H5Z" /></svg></span>
          <span class="tile-copy"><strong>快捷指令</strong><small>组合 Prompt、多个 Skill 和使用场景，在需求会话中一键执行。</small></span>
          <span class="tile-count">{{ actionCount }} 条</span><span class="tile-arrow" aria-hidden="true">→</span>
        </button>
        <button type="button" class="settings-tile" @click="emit('open', 'followups')">
          <span class="tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg></span>
          <span class="tile-copy"><strong>定时跟进</strong><small>管理后台跟进任务、完成条件、运行记录与通知投递。</small></span>
          <span class="tile-arrow" aria-hidden="true">→</span>
        </button>
        <button type="button" class="settings-tile" @click="emit('open', 'feishu')">
          <span class="tile-icon feishu" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 5.5h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-5l-4.5 3v-3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z"/><path d="M8 10h8M8 13h5"/></svg></span>
          <span class="tile-copy"><strong>飞书机器人</strong><small>连接独立应用，将飞书对话绑定到需求会话和同一个原生 Thread。</small></span>
          <span class="tile-arrow" aria-hidden="true">→</span>
        </button>
        <button type="button" class="settings-tile" @click="emit('open', 'smart-notifications')">
          <span class="tile-icon notify" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg></span>
          <span class="tile-copy"><strong>智能通知</strong><small>长时间复杂任务完成后保留站内通知，可选同步发送到飞书。</small></span>
          <span class="tile-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </section>

    <div class="settings-appearance-column">
      <ThemePicker />
    </div>
  </div>
</template>

<script setup lang="ts">
import ThemePicker from './ThemePicker.vue'
defineProps<{ actionCount: number }>()
const emit = defineEmits<{ open: [section: 'runtime' | 'quick-actions' | 'feishu' | 'smart-notifications' | 'followups'] }>()
</script>

<style scoped>
.settings-overview {
  width: 100%;
  max-width: 1520px;
  padding: 26px 32px 52px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(340px, 430px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.settings-nav-column {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-column-head {
  padding: 2px 4px;
}

.settings-column-head h2 {
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--ink-primary);
}

.settings-lead {
  margin: 6px 0 0;
  color: var(--ink-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-tile {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 14px;
  min-height: 76px;
  padding: 14px 16px;
  color: var(--ink-primary);
  background: var(--surface-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow-panel);
  transition: border-color 160ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease, background-color 160ms ease;
}

.settings-tile:hover {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border-default));
  transform: translateY(-1px);
  box-shadow: 0 12px 26px -14px color-mix(in srgb, var(--accent) 32%, transparent);
}

.settings-tile--featured {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-default));
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, var(--surface-panel)), var(--surface-panel));
}

.tile-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  color: var(--ink-secondary);
  background: var(--surface-subtle);
  border-radius: 11px;
  flex-shrink: 0;
}

.tile-icon svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tile-icon.runtime,
.tile-icon.accent,
.tile-icon.feishu {
  color: var(--accent);
  background: var(--accent-subtle);
}

.tile-icon.notify {
  color: var(--success);
  background: var(--success-bg);
}

.tile-copy {
  min-width: 0;
}

.tile-copy strong,
.tile-copy small {
  display: block;
}

.tile-copy strong {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink-primary);
}

.tile-copy small {
  margin-top: 3px;
  color: var(--ink-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.tile-count,
.tile-badge {
  padding: 3px 8px;
  color: var(--accent);
  background: var(--accent-subtle);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.tile-arrow {
  grid-column: 4;
  color: var(--ink-tertiary);
  font-size: 15px;
  transition: transform 160ms ease, color 160ms ease;
}

.settings-tile:hover .tile-arrow {
  color: var(--accent);
  transform: translateX(2px);
}

.settings-appearance-column {
  min-width: 0;
}

@media (max-width: 1160px) {
  .settings-overview {
    grid-template-columns: 1fr;
    padding: 22px 22px 44px;
  }

  .settings-nav-column {
    position: static;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
}

@media (max-width: 720px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
