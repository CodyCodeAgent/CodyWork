// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentTheme, initializeTheme, normalizeTheme, setTheme, THEME_KEY } from './theme'

describe('workbench appearance preferences', () => {
  let dispose: (() => void) | undefined
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => values.set(key, value)) })
    document.documentElement.removeAttribute('data-theme')
  })
  afterEach(() => { dispose?.(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('restores a valid selection and its native control color scheme', () => {
    window.localStorage.setItem(THEME_KEY, 'midnight')
    dispose = initializeTheme()
    expect(currentTheme.value).toBe('midnight')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    setTheme('forest')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('forest')
    expect(document.documentElement.dataset.theme).toBe('forest')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
  it('recovers invalid preferences and synchronizes changes from another tab', () => {
    window.localStorage.setItem(THEME_KEY, 'obsolete-theme')
    dispose = initializeTheme()
    expect(currentTheme.value).toBe('professional')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'midnight' }))
    expect(currentTheme.value).toBe('midnight')
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))
    expect(currentTheme.value).toBe('professional')
    expect(normalizeTheme(null)).toBe('professional')
  })
  it('still applies themes when browser storage is denied', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('denied') })
    dispose = initializeTheme()
    expect(() => setTheme('midnight')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('midnight')
  })
  it('stops synchronizing after disposal', () => {
    dispose = initializeTheme()
    dispose()
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'midnight' }))
    expect(currentTheme.value).toBe('professional')
  })
})

// New skin catalog is one atomic snapshot, so a failed import never leaves a selected missing skin.
import { exportSkin, importedSkins, importSkin, removeSkin, selectedSkin, SKIN_STATE_KEY, themeError, themePreferences, updateTheme } from './theme'
import { BUILT_IN_SKINS } from './skins/skins'

describe('skin catalog persistence', () => {
  let dispose: (() => void) | undefined
  beforeEach(() => {
    const data = new Map<string,string>()
    vi.stubGlobal('localStorage', { getItem: vi.fn((key:string) => data.get(key) ?? null), setItem: vi.fn((key:string,value:string) => data.set(key,value)) })
    dispose = initializeTheme()
  })
  afterEach(() => { dispose?.(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('keeps accent and density in exported built-in copies and reloads the catalog', async () => {
    setTheme('forest'); updateTheme({ accentColor:'#6b315e',density:'spacious' })
    const skin = importSkin(await exportSkin())
    expect(skin.id).not.toBe('forest')
    expect(skin.variants.light!.tokens.color.accent).toBe('#6b315e')
    expect(skin.variants.light!.tokens.density).toBe('spacious')
    dispose?.(); dispose=initializeTheme()
    expect(currentTheme.value).toBe(skin.id)
    expect(importedSkins.value).toHaveLength(1)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#6b315e')
    removeSkin(skin.id)
    expect(currentTheme.value).toBe('professional')
    expect(JSON.parse(localStorage.getItem(SKIN_STATE_KEY)!).skins).toEqual([])
  })
  it('keeps current state and stored catalog intact on quota failure', () => {
    setTheme('midnight')
    vi.spyOn(localStorage,'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => importSkin(JSON.stringify(BUILT_IN_SKINS[0]))).toThrow(/浏览器无法保存/)
    expect(importedSkins.value).toHaveLength(0)
    expect(currentTheme.value).toBe('midnight')
    expect(themeError.value).toContain('导出备份')
  })
  it('imports a complete cross-tab snapshot without feedback writes and ignores invalid snapshots', () => {
    const skin={...BUILT_IN_SKINS[3],id:'custom-qq',name:'Custom QQ'}
    const snapshot={version:1,skins:[skin],preferences:{skinId:'custom-qq',colorMode:'dark',accentColor:'',density:'compact'}}
    window.dispatchEvent(new StorageEvent('storage',{key:SKIN_STATE_KEY,newValue:JSON.stringify(snapshot)}))
    expect(selectedSkin.value.id).toBe('custom-qq')
    expect(themePreferences.value.colorMode).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    window.dispatchEvent(new StorageEvent('storage',{key:SKIN_STATE_KEY,newValue:'{bad'}))
    expect(selectedSkin.value.id).toBe('custom-qq')
    expect(themeError.value).toContain('当前外观保持不变')
  })
  it('exports QQ as a self-contained package with both raster avatars', async () => {
    setTheme('qq-2007')
    const pack=JSON.parse(await exportSkin())
    expect(pack.assets.userAvatar).toMatch(/^data:image\/png;base64,/)
    expect(pack.assets.assistantAvatar).toMatch(/^data:image\/png;base64,/)
    expect(importSkin(JSON.stringify(pack)).variants.dark).toBeDefined()
  })
})
