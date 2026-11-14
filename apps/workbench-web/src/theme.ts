import { ref } from 'vue'

export const themeOptions = [
  { id: 'professional', label: '清爽专业', description: '冷白与墨蓝 · 清晰、高效的日常工作台' },
  { id: 'midnight', label: '深色科技', description: '深蓝与青色 · 专注于代码与执行进展' },
  { id: 'forest', label: '松林手记', description: '暖纸与松绿 · 有温度的研发工作空间' },
] as const
export type WorkbenchTheme = typeof themeOptions[number]['id']
export const THEME_KEY = 'codywork.theme'
export function normalizeTheme(value: unknown): WorkbenchTheme {
  return themeOptions.some(option => option.id === value) ? value as WorkbenchTheme : 'professional'
}
export const currentTheme = ref<WorkbenchTheme>('professional')

function applyTheme(value: unknown) {
  currentTheme.value = normalizeTheme(value)
  document.documentElement.dataset.theme = currentTheme.value
  document.documentElement.style.colorScheme = currentTheme.value === 'midnight' ? 'dark' : 'light'
}
export function setTheme(value: WorkbenchTheme) {
  applyTheme(value)
  try { window.localStorage.setItem(THEME_KEY, currentTheme.value) } catch { /* Theme still works when storage is unavailable. */ }
}
export function initializeTheme() {
  try { applyTheme(window.localStorage.getItem(THEME_KEY)) } catch { applyTheme('professional') }
  const synchronize = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) applyTheme(event.newValue)
  }
  window.addEventListener('storage', synchronize)
  return () => window.removeEventListener('storage', synchronize)
}
