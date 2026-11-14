import { describe, expect, it } from 'vitest'
import { BUILT_IN_SKINS } from './skins'
import { parseSkinPack, serializeSkinPack, resolveSkinPack, contrastRatio } from './themeRegistry'
import { workbenchSkinVariables } from './workbenchSkin'
import { createImageSkinPack, extractPaletteFromPixels } from './imageSkinGenerator'
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const source = () => JSON.parse(JSON.stringify(BUILT_IN_SKINS[0]))

describe('portable skins and Workbench adaptation', () => {
  it('retains all original Workbench roles exactly and exports all four built-ins', () => {
    expect(BUILT_IN_SKINS.map(s => s.id)).toEqual(['professional', 'midnight', 'forest', 'qq-2007'])
    for (const skin of BUILT_IN_SKINS) {
      const parsed = parseSkinPack(serializeSkinPack(skin))
      expect(parsed).toEqual(skin)
      const variables = workbenchSkinVariables(parsed, { skinId: skin.id, colorMode: skin.defaultColorMode, density: 'comfortable', accentColor: '' })
      for (const [role, value] of Object.entries(skin.workbench ?? {})) expect(variables[`--${role}`]).toBe(value)
    }
  })
  it('supports old single-mode packages and system fallback without inventing a palette', () => {
    const old = source(), variant = old.variants.light
    delete old.variants; delete old.defaultColorMode
    Object.assign(old, variant, { isDark: false, manifest: { schemaVersion: 1 } })
    const skin = parseSkinPack(JSON.stringify(old))
    expect(skin.manifest.schemaVersion).toBe(2)
    expect(resolveSkinPack(skin, 'system', true).colorMode).toBe('light')
    expect(resolveSkinPack(BUILT_IN_SKINS[3], 'system', true).colorMode).toBe('dark')
  })
  it('makes both QQ palettes readable on Workbench surfaces and code blocks', () => {
    for (const mode of ['light', 'dark'] as const) {
      const vars = workbenchSkinVariables(BUILT_IN_SKINS[3], { skinId: 'qq-2007', colorMode: mode, density: 'compact', accentColor: '' })
      for (const [fg,bg] of [['ink-primary','surface-panel'],['ink-secondary','surface-panel'],['nav-muted','nav-bg'],['code-text','code-bg'],['on-accent','accent']]) expect(contrastRatio(vars[`--${fg}`],vars[`--${bg}`])).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('extracts distinct colors, generates dual-mode image skins and retains image controls in export', () => {
    const palette = extractPaletteFromPixels(new Uint8ClampedArray([240,30,40,255,242,32,42,255,20,80,230,255,0,255,0,0]))
    expect(palette).toHaveLength(2)
    const skin = createImageSkinPack({ name:'山林', backgroundUrl:png, palette, blur:12, dim:30, saturation:110, position:'top' })
    const parsed = parseSkinPack(serializeSkinPack(skin))
    expect(parsed.assets?.background).toBe(png)
    for (const variant of Object.values(parsed.variants)) {
      expect(variant.background).toMatchObject({ blur:12, dim:30, saturation:110, position:'top' })
      expect(contrastRatio(variant.tokens.color.text,variant.tokens.color.panel)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(variant.tokens.color.textMuted,variant.tokens.color.panel)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it.each(['https://example.com/a.png','javascript:alert(1)','/codex-api/theme-assets/'+'a'.repeat(64),'data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8='])('rejects nonportable or disguised assets: %s', asset => {
    const pack=source(); pack.assets={ background:asset }
    expect(() => parseSkinPack(JSON.stringify(pack))).toThrow()
  })
  it.each(['url(https://example.com/x)','image-set("https://example.com/x" 1x)','red; background:red','u\\72l(https://example.com/x)'])('rejects executable/network CSS in extended roles: %s', value => {
    const pack=source(); pack.workbench['surface-panel']=value
    expect(() => parseSkinPack(JSON.stringify(pack))).toThrow()
  })
  it('rejects malformed, oversized and unsupported packages before use', () => {
    expect(() => parseSkinPack('{')).toThrow()
    expect(() => parseSkinPack(' '.repeat(1_500_001))).toThrow()
    const pack=source(); pack.recipes.panel='javascript'
    expect(() => parseSkinPack(JSON.stringify(pack))).toThrow()
    pack.recipes.panel='native'; pack.manifest.schemaVersion=99
    expect(() => parseSkinPack(JSON.stringify(pack))).toThrow()
  })
})
