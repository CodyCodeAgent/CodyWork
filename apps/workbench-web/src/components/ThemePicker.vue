<script setup lang="ts">
import { computed, ref } from 'vue'
import { allSkins, currentTheme, exportSkin, importSkin, importedSkins, removeSkin, resetThemeCustomization, resolvedSkin, selectedSkin, setTheme, themeError, themePreferences, updateTheme } from '../theme'
import { supportedSkinColorModes } from '../skins/themeRegistry'
import type { ThemeColorMode, ThemeDensity } from '../skins/tokens'
import SkinPreview from './SkinPreview.vue'
import ImageSkinStudio from './ImageSkinStudio.vue'
const importer = ref<HTMLInputElement | null>(null)
const showStudio = ref(false), showAdvanced = ref(false), packageText = ref(''), message = ref(''), error = ref(''), exporting = ref(false), importing = ref(false)
const deleteId = ref('')
const builtIns = computed(() => allSkins.value.filter(skin => !importedSkins.value.some(item => item.id === skin.id)))
const modes = computed(() => supportedSkinColorModes(selectedSkin.value))
const accent = computed(() => themePreferences.value.accentColor || resolvedSkin.value.tokens.color.accent)
function inputValue(event: Event) { return (event.target as HTMLInputElement).value }
function imported(text: string) {
  try { const skin = importSkin(text); error.value = ''; message.value = `已导入并应用「${skin.name}」`; packageText.value = '' }
  catch (err) { error.value = err instanceof Error ? err.message : '导入失败' }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file) return
  importing.value = true
  try { if (file.size > 1_500_000) throw new Error('皮肤包不能超过 1.5 MB'); imported(await file.text()) }
  catch (err) { error.value = err instanceof Error ? err.message : '读取失败' }
  finally { importing.value = false }
}
async function download() {
  exporting.value = true; error.value = ''
  try {
    const text = await exportSkin(), url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${selectedSkin.value.id}.cody-skin`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    message.value = '已导出皮肤包，包含当前配色、密度与图片。'
  } catch (err) { error.value = err instanceof Error ? err.message : '导出失败' }
  finally { exporting.value = false }
}
async function showJson() { try { packageText.value = await exportSkin(); error.value = '' } catch (err) { error.value = String(err) } }
function deleteSkin() {
  try { removeSkin(deleteId.value); deleteId.value = ''; message.value = '已删除自定义皮肤'; error.value = '' }
  catch (err) { error.value = err instanceof Error ? err.message : '删除失败' }
}
</script>
<template>
  <section class="theme-preferences skin-settings" aria-labelledby="theme-preferences-title">
    <div class="theme-preferences-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h2 id="theme-preferences-title">工作台外观</h2><p>熟悉的工作方式，你喜欢的样子。</p></div><div class="skin-toolbar"><button type="button" :aria-expanded="showStudio" @click="showStudio = !showStudio">图片生成皮肤</button><button type="button" :disabled="importing" @click="importer?.click()">{{ importing ? '导入中…' : '导入皮肤' }}</button></div></div>
    <input ref="importer" class="skin-file-input" type="file" accept=".cody-skin,.json,application/json" aria-label="导入皮肤文件" @change="importFile" />
    <p v-if="message" role="status" class="skin-feedback">{{ message }}</p>
    <p v-if="error || themeError" role="alert" class="skin-error">{{ error || themeError }}</p>
    <h3 class="skin-group-title">内置皮肤 <span>4</span></h3>
    <div class="skin-gallery" role="group" aria-label="工作台主题">
      <button v-for="skin in builtIns" :key="skin.id" type="button" class="skin-card" :aria-pressed="currentTheme === skin.id" @click="setTheme(skin.id)"><SkinPreview :skin="skin" /><span class="skin-card-title">{{ skin.name }}<small v-if="currentTheme === skin.id">✓ 使用中</small></span><span class="skin-card-description">{{ skin.id === 'qq-2007' ? '蓝银色经典桌面 · QQ 2007' : skin.description }}</span></button>
    </div>
    <div v-if="importedSkins.length" class="skin-custom-group"><h3 class="skin-group-title">我的皮肤 <span>{{ importedSkins.length }}</span></h3><div class="skin-gallery"><div v-for="skin in importedSkins" :key="skin.id" class="skin-custom-card"><button type="button" class="skin-card" :aria-pressed="currentTheme === skin.id" @click="setTheme(skin.id)"><SkinPreview :skin="skin" /><span class="skin-card-title">{{ skin.name }}<small v-if="currentTheme === skin.id">✓ 使用中</small></span><span class="skin-card-description">{{ skin.manifest.author }} · {{ skin.manifest.version }}</span></button><button type="button" class="skin-delete" :aria-label="`删除皮肤 ${skin.name}`" @click="deleteId = skin.id">删除</button></div></div></div>
    <div v-if="deleteId" class="skin-delete-confirm" role="alert"><span>删除这个自定义皮肤？正在使用时将恢复清爽专业。建议先导出备份。</span><button type="button" @click="deleteId = ''">取消</button><button type="button" @click="deleteSkin">确认删除</button></div>
    <div class="skin-customization">
      <div class="skin-section-heading"><div><h3>{{ selectedSkin.name }}</h3><p>调整当前皮肤，随时恢复默认。</p></div><button type="button" @click="resetThemeCustomization">恢复皮肤默认</button></div>
      <div class="skin-controls">
        <label>明暗模式<select :value="themePreferences.colorMode" @change="updateTheme({ colorMode: inputValue($event) as ThemeColorMode })"><option value="light" :disabled="!modes.includes('light')">浅色</option><option value="dark" :disabled="!modes.includes('dark')">深色</option><option value="system" :disabled="modes.length < 2">跟随系统</option></select><small v-if="modes.length === 1">保留原有{{ modes[0] === 'dark' ? '深色' : '浅色' }}外观</small></label>
        <label>界面密度<select :value="themePreferences.density" @change="updateTheme({ density: inputValue($event) as ThemeDensity })"><option value="compact">紧凑</option><option value="comfortable">舒适</option><option value="spacious">宽松</option></select></label>
        <label>强调色<span class="skin-color-field"><input type="color" :value="accent" @input="updateTheme({ accentColor: inputValue($event) })" /><code>{{ accent }}</code><button v-if="themePreferences.accentColor" type="button" @click="updateTheme({ accentColor: '' })">重置</button></span></label>
      </div>
      <div class="skin-footer"><p>自动保存在当前浏览器 · 导出皮肤包可备份或带到其他设备</p><button type="button" :disabled="exporting" @click="download">{{ exporting ? '导出中…' : '导出当前皮肤' }}</button></div>
    </div>
    <ImageSkinStudio v-if="showStudio" @saved="message = `已创建并应用「${$event}」`; error = ''" />
    <button type="button" class="skin-advanced-toggle" :aria-expanded="showAdvanced" @click="showAdvanced = !showAdvanced">{{ showAdvanced ? '收起' : '展开' }}高级配置 · JSON</button>
    <div v-if="showAdvanced" class="skin-advanced"><p>支持 CodyWeb Skin API v1 / v2。仅接受内嵌图片，不执行脚本、远程图片或任意 CSS。布局由 CodyWork 管理。</p><label>皮肤 JSON<textarea v-model="packageText" rows="8" spellcheck="false" /></label><div class="skin-toolbar"><button type="button" @click="showJson">载入当前配置</button><button type="button" :disabled="!packageText.trim()" @click="imported(packageText)">导入 JSON 为新皮肤</button></div></div>
  </section>
</template>
