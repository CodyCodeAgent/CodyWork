<template>
  <div class="settings-overview">
    <p class="settings-lead">管理当前 Workspace 的运行环境和可复用工作入口。</p>
    <div class="settings-grid">
      <button type="button" class="settings-tile" @click="emit('open', 'quick-actions')">
        <span class="tile-icon accent" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 8h8v8H8zM5 8a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H5Z" /></svg></span>
        <span class="tile-copy"><strong>快捷指令</strong><small>组合 Prompt、多个 Skill 和使用场景，在需求会话中一键执行。</small></span>
        <span class="tile-count">{{ actionCount }} 条</span><span class="tile-arrow" aria-hidden="true">→</span>
      </button>
      <button type="button" class="settings-tile" @click="emit('open', 'runtime')">
        <span class="tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="4" /></svg></span>
        <span class="tile-copy"><strong>Codex Runtime</strong><small>配置 App Server 启动命令并检查运行连接。</small></span>
        <span class="tile-arrow" aria-hidden="true">→</span>
      </button>
      <button type="button" class="settings-tile" @click="emit('open', 'feishu')">
        <span class="tile-icon feishu" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 5.5h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-5l-4.5 3v-3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z"/><path d="M8 10h8M8 13h5"/></svg></span>
        <span class="tile-copy"><strong>飞书机器人</strong><small>连接独立应用，将飞书对话绑定到需求会话和同一个 Codex Thread。</small></span>
        <span class="tile-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ actionCount: number }>()
const emit = defineEmits<{ open: [section: 'runtime' | 'quick-actions' | 'feishu'] }>()
</script>

<style scoped>
.settings-overview{max-width:1040px;padding:34px 36px 60px;margin:0 auto}.settings-lead{margin:0 0 20px;color:#697484;font-size:13px}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.settings-tile{display:grid;grid-template-columns:48px minmax(0,1fr) auto 24px;align-items:center;gap:15px;min-height:132px;padding:22px;color:#171a22;background:#fff;border:1px solid #e3e7ec;border-radius:15px;text-align:left;box-shadow:0 5px 18px rgba(28,38,58,.035);transition:border-color .16s,transform .16s,box-shadow .16s}.settings-tile:hover{border-color:#aebfff;transform:translateY(-1px);box-shadow:0 10px 28px rgba(40,61,115,.08)}.tile-icon{display:grid;place-items:center;width:48px;height:48px;color:#657186;background:#f1f4f8;border-radius:13px}.tile-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.tile-icon.accent{color:#315fd0;background:#edf3ff}.tile-copy{min-width:0}.tile-copy strong,.tile-copy small{display:block}.tile-copy strong{font-size:16px}.tile-copy small{margin-top:6px;color:#7b8696;font-size:11px;line-height:1.65}.tile-count{padding:4px 8px;color:#4569c9;background:#edf3ff;border-radius:999px;font-size:10px;white-space:nowrap}.tile-arrow{color:#9ba5b3;font-size:18px}@media(max-width:820px){.settings-overview{padding:24px 22px}.settings-grid{grid-template-columns:1fr}}
.tile-icon.feishu{color:#1f7aec;background:#eaf4ff}
</style>
