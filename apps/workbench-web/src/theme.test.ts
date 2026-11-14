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
