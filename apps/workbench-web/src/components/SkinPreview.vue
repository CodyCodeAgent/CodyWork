<script setup lang="ts">
import { computed } from 'vue'
import type { SkinPack, ThemeColorMode } from '../skins/tokens'
import { workbenchSkinVariables } from '../skins/workbenchSkin'
const props = defineProps<{ skin: SkinPack; mode?: ThemeColorMode }>()
const style = computed(() => workbenchSkinVariables(props.skin, { skinId: props.skin.id, colorMode: props.mode ?? props.skin.defaultColorMode, accentColor: '', density: 'comfortable' }))
</script>
<template>
  <div class="skin-preview" :style="style" :data-chrome="skin.recipes.chrome" aria-hidden="true">
    <div class="skin-preview-wallpaper" />
    <div class="skin-preview-nav"><i /><b /><b /><b /></div>
    <div class="skin-preview-work"><div class="skin-preview-bar"><b /><i /></div><div class="skin-preview-chat"><span>需求开发</span><p>让工作台，成为你的工作台。</p><code>✓ 验证通过</code></div><div class="skin-preview-input"><span>继续探索…</span><i>↑</i></div></div>
  </div>
</template>
