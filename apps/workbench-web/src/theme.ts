import { computed, ref } from 'vue'
import { BUILT_IN_SKINS } from './skins/skins'
import { normalizeThemePreferences, parseSkinPack, resolveSkinPack, serializeSkinPack } from './skins/themeRegistry'
import { DEFAULT_THEME_PREFERENCES } from './skins/tokens'
import type { SkinPack, ThemePreferences } from './skins/tokens'
import { workbenchSkinVariables } from './skins/workbenchSkin'

export const THEME_KEY = 'codywork.theme'
export const SKIN_STATE_KEY = 'codywork.skins.v1'
export const themeOptions = BUILT_IN_SKINS.map(skin => ({ id: skin.id, label: skin.name, description: skin.description }))
export type WorkbenchTheme = string
export const importedSkins = ref<SkinPack[]>([])
export const themePreferences = ref<ThemePreferences>({ ...DEFAULT_THEME_PREFERENCES })
export const themeError = ref('')
export const allSkins = computed(() => [...BUILT_IN_SKINS, ...importedSkins.value])
export const currentTheme = computed(() => themePreferences.value.skinId)
export const selectedSkin = computed(() => allSkins.value.find(skin => skin.id === currentTheme.value) ?? BUILT_IN_SKINS[0])
const systemDark = ref(false)
export const resolvedSkin = computed(() => resolveSkinPack(selectedSkin.value, themePreferences.value.colorMode, systemDark.value))
let appliedKeys: string[] = []
let materialVersion = 0
export function normalizeTheme(value: unknown): string {
  return allSkins.value.some(skin => skin.id === value) ? String(value) : 'professional'
}
function applyTheme() {
  const root = document.documentElement, skin = selectedSkin.value
  const resolved = resolveSkinPack(skin, themePreferences.value.colorMode, systemDark.value)
  const variables = workbenchSkinVariables(skin, themePreferences.value, systemDark.value)
  for (const key of appliedKeys) root.style.removeProperty(key)
  for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value)
  appliedKeys = Object.keys(variables)
  try {
    window.localStorage.setItem('codywork.skin-paint.v1', JSON.stringify({ mode: resolved.colorMode,
      variables: Object.fromEntries(Object.entries(variables).filter(([key]) => !key.startsWith('--skin-'))),
    }))
  } catch { /* The authoritative preference write reports storage failures. */ }
  root.dataset.theme = skin.id
  root.dataset.colorMode = resolved.colorMode
  root.style.colorScheme = resolved.colorMode
  root.dataset.density = themePreferences.value.density
  for (const [key, value] of Object.entries(skin.recipes)) root.setAttribute(`data-skin-${key}`, value)
  root.dataset.skinBrand = skin.assets?.brandMark ? 'true' : 'false'
  root.dataset.skinUserAvatar = skin.assets?.userAvatar ? 'true' : 'false'
  root.dataset.skinAssistantAvatar = skin.assets?.assistantAvatar ? 'true' : 'false'
  const version = ++materialVersion
  if (skin.id === 'qq-2007') void import('./skins/qqSkinAssets').then(assets => {
    if (version !== materialVersion) return
    root.dataset.skinUserAvatar = 'true'; root.dataset.skinAssistantAvatar = 'true'
    root.style.setProperty('--skin-user-avatar', `url("${assets.QQ_USER_AVATAR}")`)
    root.style.setProperty('--skin-assistant-avatar', `url("${assets.QQ_ASSISTANT_AVATAR}")`)
  }).catch(() => { themeError.value = 'QQ 头像加载失败，可刷新重试；皮肤仍可使用。' })
}
function readState(raw: string | null) {
  if (!raw) return null
  const value = JSON.parse(raw)
  if (value.version !== 1 || !Array.isArray(value.skins) || value.skins.length > 40) throw new Error('皮肤存档格式无效')
  const skins: SkinPack[] = value.skins.map((skin: unknown) => parseSkinPack(JSON.stringify(skin)))
  const ids = new Set(BUILT_IN_SKINS.map(skin => skin.id))
  for (const skin of skins) {
    if (ids.has(skin.id)) throw new Error('皮肤 ID 重复')
    ids.add(skin.id)
  }
  return { skins, preferences: normalizeThemePreferences(value.preferences, { skins }) }
}
function commit(preferences: ThemePreferences, skins = importedSkins.value, requirePersistence = false) {
  const payload = JSON.stringify({ version: 1, preferences, skins })
  try {
    window.localStorage.setItem(SKIN_STATE_KEY, payload)
    themeError.value = ''
  } catch {
    themeError.value = '浏览器无法保存皮肤（空间不足或存储被禁用）。请导出备份，删除不用的自定义皮肤后重试。'
    if (requirePersistence) throw new Error(themeError.value)
  }
  importedSkins.value = skins
  themePreferences.value = preferences
  applyTheme()
  try { window.localStorage.setItem(THEME_KEY, preferences.skinId) } catch { /* Reported above. */ }
}
export function setTheme(id: string) {
  const skin = allSkins.value.find(skin => skin.id === id) ?? BUILT_IN_SKINS[0]
  commit({ skinId: skin.id, colorMode: skin.defaultColorMode, accentColor: '', density: skin.variants[skin.defaultColorMode]!.tokens.density })
}
export function updateTheme(patch: Partial<ThemePreferences>) {
  commit(normalizeThemePreferences({ ...themePreferences.value, ...patch }, { skins: allSkins.value }))
}
export function resetThemeCustomization() { setTheme(currentTheme.value) }
export function importSkin(text: string): SkinPack {
  const skin = parseSkinPack(text)
  if (BUILT_IN_SKINS.some(item => item.id === skin.id)) {
    // Exported built-ins become editable copies, never replace a shipped definition.
    skin.id = `custom-${skin.id}-${Date.now().toString(36)}`.slice(0, 64)
    skin.name = `${skin.name.slice(0, 70)} · 副本`
  }
  if (importedSkins.value.some(item => item.id === skin.id)) {
    skin.id = `${skin.id.slice(0, 45)}-${Math.random().toString(36).slice(2, 10)}`
    skin.name = `${skin.name.slice(0, 70)} · 副本`
  }
  if (importedSkins.value.length >= 40) throw new Error('最多保存 40 个自定义皮肤，请先导出并删除不用的皮肤。')
  commit({ skinId: skin.id, colorMode: skin.defaultColorMode, accentColor: '', density: skin.variants[skin.defaultColorMode]!.tokens.density }, [...importedSkins.value, skin], true)
  return skin
}
export function removeSkin(id: string) {
  if (!importedSkins.value.some(skin => skin.id === id)) return
  const skins = importedSkins.value.filter(skin => skin.id !== id)
  commit(currentTheme.value === id ? { ...DEFAULT_THEME_PREFERENCES } : themePreferences.value, skins, true)
}
export async function exportSkin(): Promise<string> {
  const skin = JSON.parse(JSON.stringify(selectedSkin.value)) as SkinPack
  if (skin.id === 'qq-2007') {
    const assets = await import('./skins/qqSkinAssets')
    skin.assets = { ...skin.assets, userAvatar: assets.QQ_USER_AVATAR, assistantAvatar: assets.QQ_ASSISTANT_AVATAR }
  }
  if (themePreferences.value.accentColor) {
    for (const variant of Object.values(skin.variants)) variant.tokens.color.accent = themePreferences.value.accentColor
    if (skin.workbench) for (const key of ['accent', 'accent-hover', 'accent-subtle', 'on-accent']) delete skin.workbench[key]
  }
  for (const variant of Object.values(skin.variants)) variant.tokens.density = themePreferences.value.density
  skin.defaultColorMode = resolveSkinPack(skin, themePreferences.value.colorMode, systemDark.value).colorMode
  return serializeSkinPack(skin)
}
export function initializeTheme() {
  themeError.value = ''; importedSkins.value = []; themePreferences.value = { ...DEFAULT_THEME_PREFERENCES }
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  systemDark.value = media?.matches ?? false
  try {
    const state = readState(window.localStorage.getItem(SKIN_STATE_KEY))
    if (state) { importedSkins.value = state.skins; themePreferences.value = state.preferences }
    else {
      const skin = BUILT_IN_SKINS.find(skin => skin.id === window.localStorage.getItem(THEME_KEY)) ?? BUILT_IN_SKINS[0]
      themePreferences.value = { ...DEFAULT_THEME_PREFERENCES, skinId: skin.id, colorMode: skin.defaultColorMode }
    }
  } catch { themeError.value = '无法读取已保存的皮肤，已使用默认外观。原存档未改动，可重新导入皮肤。' }
  applyTheme()
  const synchronize = (event: StorageEvent) => {
    if (event.key === SKIN_STATE_KEY || event.key === null) {
      try {
        const state = readState(event.key === null ? null : event.newValue)
        importedSkins.value = state?.skins ?? []
        themePreferences.value = state?.preferences ?? { ...DEFAULT_THEME_PREFERENCES }
        themeError.value = ''; applyTheme()
      } catch { themeError.value = '另一窗口保存的皮肤无效，当前外观保持不变。' }
    } else if (event.key === THEME_KEY && !window.localStorage.getItem(SKIN_STATE_KEY)) {
      const skin = BUILT_IN_SKINS.find(skin => skin.id === event.newValue) ?? BUILT_IN_SKINS[0]
      themePreferences.value = { ...DEFAULT_THEME_PREFERENCES, skinId: skin.id, colorMode: skin.defaultColorMode }; applyTheme()
    }
  }
  const systemChange = (event: MediaQueryListEvent) => { systemDark.value = event.matches; applyTheme() }
  window.addEventListener('storage', synchronize)
  media?.addEventListener('change', systemChange)
  return () => { window.removeEventListener('storage', synchronize); media?.removeEventListener('change', systemChange); ++materialVersion }
}
