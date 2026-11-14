<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { createImageSkinPack, processThemeImage } from '../skins/imageSkinGenerator'
import type { ProcessedThemeImage } from '../skins/imageSkinGenerator'
import type { ResolvedThemeColorMode } from '../skins/tokens'
import { importSkin } from '../theme'
import SkinPreview from './SkinPreview.vue'
const emit = defineEmits<{ saved: [name: string] }>()
const fileInput = ref<HTMLInputElement | null>(null)
const image = ref<ProcessedThemeImage | null>(null)
const name = ref('我的图片皮肤'), blur = ref(8), dim = ref(20), saturation = ref(100), position = ref('center')
const mode = ref<ResolvedThemeColorMode>('light'), busy = ref(false), error = ref('')
let generation = 0
const preview = computed(() => image.value ? createImageSkinPack({ name: name.value, backgroundUrl: image.value.dataUrl, palette: image.value.palette, blur: blur.value, dim: dim.value, saturation: saturation.value, position: position.value, defaultColorMode: mode.value }) : null)
async function load(file?: File) {
  if (!file) return
  const request = ++generation
  busy.value = true; error.value = ''; image.value = null
  try {
    const result = await processThemeImage(file)
    if (request !== generation) return
    image.value = result; name.value = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || '我的图片皮肤'
  } catch (err) { if (request === generation) error.value = err instanceof Error ? err.message : '图片处理失败' }
  finally { if (request === generation) busy.value = false }
}
function fileChanged(event: Event) {
  const input = event.target as HTMLInputElement
  void load(input.files?.[0]); input.value = ''
}
function dropped(event: DragEvent) { void load(event.dataTransfer?.files[0]) }
function save() {
  if (!preview.value || !name.value.trim()) return
  try { const skin = importSkin(JSON.stringify(preview.value)); emit('saved', skin.name) }
  catch (err) { error.value = err instanceof Error ? err.message : '无法保存皮肤' }
}
onBeforeUnmount(() => { ++generation })
</script>
<template>
  <section class="image-skin-studio" aria-labelledby="image-skin-title">
    <div class="skin-section-heading"><div><h3 id="image-skin-title">用一张图片，生成你的皮肤</h3><p>本地提取配色，生成浅色与深色版本。图片不会发送给模型。</p></div></div>
    <input ref="fileInput" class="skin-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择皮肤图片" @change="fileChanged" />
    <button type="button" class="skin-dropzone" :aria-busy="busy" @click="fileInput?.click()" @dragover.prevent @drop.prevent="dropped">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m4 17 5-5 4 4 3-3 5 5"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>
      <strong>{{ busy ? '正在提取配色…' : image ? '更换图片' : '选择图片，或拖到这里' }}</strong><small>PNG / JPEG / WebP · 最大 15 MB · 自动压缩为可导出的背景</small>
    </button>
    <p v-if="error" role="alert" class="skin-error">{{ error }}</p>
    <div v-if="preview && image" class="skin-studio-editor">
      <div><SkinPreview :skin="preview" :mode="mode" /><div class="skin-palette" aria-label="图片提取配色"><span v-for="color in image.palette" :key="color" :style="{ background: color }" :title="color" /></div><p class="skin-hint">{{ image.width }} × {{ image.height }} · {{ Math.round(image.byteSize / 1024) }} KB · 预览不会改变当前外观</p></div>
      <div class="skin-fields">
        <label>皮肤名称<input v-model="name" maxlength="80" /></label>
        <label>默认模式<select v-model="mode"><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <label>模糊 <output>{{ blur }} px</output><input v-model.number="blur" type="range" min="0" max="48" /></label>
        <label>背景遮罩 <output>{{ dim }}%</output><input v-model.number="dim" type="range" min="0" max="80" /></label>
        <label>饱和度 <output>{{ saturation }}%</output><input v-model.number="saturation" type="range" min="50" max="160" /></label>
        <label>图片位置<select v-model="position"><option value="center">居中</option><option value="top">顶部</option><option value="bottom">底部</option><option value="left">左侧</option><option value="right">右侧</option></select></label>
        <button class="primary-btn" type="button" :disabled="busy || !name.trim()" @click="save">保存并应用皮肤</button>
      </div>
    </div>
  </section>
</template>
