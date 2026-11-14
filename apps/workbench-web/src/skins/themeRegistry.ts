// Adapted from CodyWeb (MIT). See LICENSE.CodyWeb in this directory.
export const WORKBENCH_ROLES = ["surface-canvas", "surface-panel", "surface-subtle", "surface-raised", "ink-primary", "ink-secondary", "ink-tertiary", "border-default", "border-strong", "accent", "accent-hover", "accent-subtle", "on-accent", "nav-bg", "nav-text", "nav-muted", "nav-hover", "success", "success-bg", "warning", "warning-bg", "danger", "danger-bg", "code-bg", "code-text", "overlay", "shadow-panel", "shadow-popover", "radius-panel", "radius-control"]
import { BUILT_IN_SKINS } from './skins'
import type {
  SkinPack,
  ResolvedSkinPack,
  ResolvedThemeColorMode,
  SkinVariant,
  ThemeColorMode,
  ThemeDensity,
  ThemePreferences,
  ThemeTokens,
} from './tokens'
import { DEFAULT_SKIN_RECIPES, DEFAULT_THEME_PREFERENCES, SKIN_API_VERSION } from './tokens'

const MAX_SKIN_PACKAGE_BYTES = 1_500_000
const MAX_SKIN_ASSET_BYTES = 512_000
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/]+={0,2})$/iu
const RECIPE_VALUES = {
  chrome: ['native', 'glossy', 'terminal'],
  navigation: ['native', 'classic', 'pill'],
  panel: ['native', 'beveled', 'glass'],
  control: ['native', 'beveled', 'outline'],
  message: ['native', 'bubble', 'rail'],
  identity: ['none', 'avatars'],
  composer: ['native', 'beveled', 'glass'],
  backdrop: ['solid', 'aero-grid', 'grid', 'image'],
} as const

export function getBuiltInSkin(skinId: string): SkinPack | null {
  return BUILT_IN_SKINS.find((skin) => skin.id === skinId) ?? null
}

export function normalizeThemeDensity(value: unknown): ThemeDensity {
  return value === 'compact' || value === 'comfortable' || value === 'spacious' ? value : 'comfortable'
}

export function normalizeThemeColorMode(value: unknown, fallback: ThemeColorMode = DEFAULT_THEME_PREFERENCES.colorMode): ThemeColorMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : fallback
}

function isColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u.test(value.trim())
}

export function normalizeAccentColor(value: string): string {
  const normalized = value.trim()
  return normalized && isColor(normalized) ? normalized : ''
}

export function normalizeThemePreferences(
  value: unknown,
  options: { skinIds?: string[]; skins?: SkinPack[] } = {},
): ThemePreferences {
  const row = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const knownSkinIds = new Set([
    ...BUILT_IN_SKINS.map((skin) => skin.id),
    ...(options.skins ?? []).map((skin) => skin.id),
    ...(options.skinIds ?? []),
  ])
  const skinId = typeof row.skinId === 'string' && knownSkinIds.has(row.skinId)
    ? row.skinId
    : DEFAULT_THEME_PREFERENCES.skinId
  const fallbackMode = (
    getBuiltInSkin(skinId)
    ?? options.skins?.find((skin) => skin.id === skinId)
  )?.defaultColorMode ?? DEFAULT_THEME_PREFERENCES.colorMode
  return {
    skinId,
    colorMode: normalizeThemeColorMode(row.colorMode, row.followSystem === true ? 'system' : fallbackMode),
    accentColor: typeof row.accentColor === 'string' ? normalizeAccentColor(row.accentColor) : '',
    density: normalizeThemeDensity(row.density),
  }
}

export function supportedSkinColorModes(skin: SkinPack): ResolvedThemeColorMode[] {
  return (['light', 'dark'] as const).filter((mode) => Boolean(skin.variants[mode]))
}

export function resolveSkinColorMode(
  skin: SkinPack,
  requestedMode: ThemeColorMode,
  systemPrefersDark = false,
): ResolvedThemeColorMode {
  const desiredMode = requestedMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : requestedMode
  if (skin.variants[desiredMode]) return desiredMode
  if (skin.variants[skin.defaultColorMode]) return skin.defaultColorMode
  return supportedSkinColorModes(skin)[0] ?? 'light'
}

export function resolveSkinPack(
  skin: SkinPack,
  requestedMode: ThemeColorMode,
  systemPrefersDark = false,
): ResolvedSkinPack {
  const colorMode = resolveSkinColorMode(skin, requestedMode, systemPrefersDark)
  const variant = skin.variants[colorMode]
  if (!variant) throw new Error(`Skin "${skin.id}" does not contain a usable color variant.`)
  const { defaultColorMode: _defaultColorMode, variants: _variants, ...definition } = skin
  return {
    ...definition,
    ...variant,
    colorMode,
    isDark: colorMode === 'dark',
  }
}

export function resolveThemeTokens(skin: Pick<ResolvedSkinPack, 'tokens'>, preferences: ThemePreferences): ThemeTokens {
  return {
    ...skin.tokens,
    color: {
      ...skin.tokens.color,
      accent: preferences.accentColor || skin.tokens.color.accent,
    },
    density: preferences.density,
  }
}

function parseHexColor(value: string): [number, number, number] | null {
  const normalized = value.trim().replace(/^#/u, '')
  const expanded = normalized.length === 3
    ? normalized.split('').map((character) => `${character}${character}`).join('')
    : normalized
  if (!/^[0-9a-f]{6}$/iu.test(expanded)) return null
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as [number, number, number]
}

function luminance(color: [number, number, number]): number {
  const channels = color.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundColor = parseHexColor(foreground)
  const backgroundColor = parseHexColor(background)
  if (!foregroundColor || !backgroundColor) return 1
  const lighter = Math.max(luminance(foregroundColor), luminance(backgroundColor))
  const darker = Math.min(luminance(foregroundColor), luminance(backgroundColor))
  return (lighter + 0.05) / (darker + 0.05)
}

export function contrastingTextColor(background: string): '#0b0e13' | '#ffffff' {
  const parsed = parseHexColor(background)
  if (!parsed) return '#ffffff'
  const backgroundLuminance = luminance(parsed)
  const darkContrast = (backgroundLuminance + 0.05) / 0.05
  const lightContrast = 1.05 / (backgroundLuminance + 0.05)
  return darkContrast >= lightContrast ? '#0b0e13' : '#ffffff'
}

export function serializeSkinPack(skin: SkinPack): string {
  return `${JSON.stringify(parseSkinPack(JSON.stringify(skin)), null, 2)}\n`
}

function objectRow(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function safeString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value.trim()
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} is not supported.`)
  return value as T
}

function colorValue(value: unknown, label: string): string {
  const color = safeString(value, label, 9)
  if (!isColor(color)) throw new Error(`${label} must be a hex color.`)
  return color
}

function cssValue(value: unknown, label: string, maxLength = 240): string {
  const result = safeString(value, label, maxLength)
  if (/[{};\\]|url\s*\(|@|expression\s*\(|(?:image|image-set|cross-fade)\s*\(/iu.test(result)) throw new Error(`${label} contains unsupported CSS.`)
  return result
}

function imageAsset(value: unknown, label: string): string {
  const asset = safeString(value, label, MAX_SKIN_ASSET_BYTES * 2)
  const match = DATA_IMAGE_PATTERN.exec(asset)
  if (!match) throw new Error(`${label} 必须内嵌 PNG、JPEG 或 WebP 图片；服务器本地资源链接不可跨应用导入，请先嵌入图片。`)
  if (match[1].length % 4 !== 0) throw new Error(`${label} base64 is invalid.`)
  const decodedBytes = Math.floor(match[1].length * 3 / 4) - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0)
  if (decodedBytes > MAX_SKIN_ASSET_BYTES) throw new Error(`${label} exceeds 500 KB.`)
  const bytes = atob(match[1])
  const mime = asset.slice(5, asset.indexOf(';'))
  const valid = mime === 'image/png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
    : mime === 'image/jpeg' ? bytes.startsWith('\xff\xd8\xff')
    : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
  if (!valid) throw new Error(`${label} 图片格式与内容不匹配。`)
  return asset
}

function normalizedTokens(value: unknown): ThemeTokens {
  const row = objectRow(value, 'tokens')
  const color = objectRow(row.color, 'tokens.color')
  const font = objectRow(row.font, 'tokens.font')
  const spacing = objectRow(row.spacing, 'tokens.spacing')
  const radius = objectRow(row.radius, 'tokens.radius')
  const shadow = objectRow(row.shadow, 'tokens.shadow')
  const motion = objectRow(row.motion, 'tokens.motion')
  return {
    color: {
      background: colorValue(color.background, 'tokens.color.background'),
      surface: colorValue(color.surface, 'tokens.color.surface'),
      panel: colorValue(color.panel, 'tokens.color.panel'),
      elevated: colorValue(color.elevated, 'tokens.color.elevated'),
      text: colorValue(color.text, 'tokens.color.text'),
      textMuted: colorValue(color.textMuted, 'tokens.color.textMuted'),
      border: colorValue(color.border, 'tokens.color.border'),
      accent: colorValue(color.accent, 'tokens.color.accent'),
      danger: colorValue(color.danger, 'tokens.color.danger'),
      warning: colorValue(color.warning, 'tokens.color.warning'),
      success: colorValue(color.success, 'tokens.color.success'),
      info: colorValue(color.info, 'tokens.color.info'),
      codeBackground: colorValue(color.codeBackground, 'tokens.color.codeBackground'),
      terminalBackground: colorValue(color.terminalBackground, 'tokens.color.terminalBackground'),
    },
    font: {
      sans: cssValue(font.sans, 'tokens.font.sans'),
      mono: cssValue(font.mono, 'tokens.font.mono'),
    },
    spacing: {
      xs: cssValue(spacing.xs, 'tokens.spacing.xs', 32),
      sm: cssValue(spacing.sm, 'tokens.spacing.sm', 32),
      md: cssValue(spacing.md, 'tokens.spacing.md', 32),
      lg: cssValue(spacing.lg, 'tokens.spacing.lg', 32),
    },
    radius: {
      sm: cssValue(radius.sm, 'tokens.radius.sm', 32),
      md: cssValue(radius.md, 'tokens.radius.md', 32),
      lg: cssValue(radius.lg, 'tokens.radius.lg', 32),
    },
    shadow: {
      panel: cssValue(shadow.panel, 'tokens.shadow.panel'),
      floating: cssValue(shadow.floating, 'tokens.shadow.floating'),
      focus: cssValue(shadow.focus, 'tokens.shadow.focus'),
    },
    motion: {
      fast: cssValue(motion.fast, 'tokens.motion.fast', 32),
      normal: cssValue(motion.normal, 'tokens.motion.normal', 32),
      slow: cssValue(motion.slow, 'tokens.motion.slow', 32),
    },
    density: normalizeThemeDensity(row.density),
  }
}

function normalizedBackground(value: unknown, label: string): SkinVariant['background'] {
  const row = objectRow(value, label)
  const boundedNumber = (input: unknown, name: string, minimum: number, maximum: number): number => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < minimum || input > maximum) {
      throw new Error(`${name} must be between ${minimum} and ${maximum}.`)
    }
    return Math.round(input * 100) / 100
  }
  return {
    type: enumValue(row.type ?? 'solid', ['solid', 'grid', 'noise', 'image', 'animated'] as const, `${label}.type`),
    ...(row.fit === undefined ? {} : { fit: enumValue(row.fit, ['cover', 'contain'] as const, `${label}.fit`) }),
    ...(row.position === undefined ? {} : { position: safeString(row.position, `${label}.position`, 40) }),
    ...(row.blur === undefined ? {} : { blur: boundedNumber(row.blur, `${label}.blur`, 0, 48) }),
    ...(row.dim === undefined ? {} : { dim: boundedNumber(row.dim, `${label}.dim`, 0, 80) }),
    ...(row.saturation === undefined ? {} : { saturation: boundedNumber(row.saturation, `${label}.saturation`, 50, 160) }),
  }
}

function normalizedVariant(value: unknown, label: string): SkinVariant {
  const row = objectRow(value, label)
  const terminalThemeRow = objectRow(row.terminalTheme, `${label}.terminalTheme`)
  const chartPalette = Array.isArray(row.chartPalette) ? row.chartPalette : []
  if (chartPalette.length < 1 || chartPalette.length > 12) throw new Error(`${label}.chartPalette must contain 1–12 colors.`)
  return {
    tokens: normalizedTokens(row.tokens),
    syntaxTheme: safeString(row.syntaxTheme, `${label}.syntaxTheme`, 40),
    terminalTheme: Object.fromEntries(Object.entries(terminalThemeRow).map(([key, entry]) => [
      safeString(key, `${label}.terminalTheme key`, 40),
      colorValue(entry, `${label}.terminalTheme.${key}`),
    ])),
    chartPalette: chartPalette.map((entry, index) => colorValue(entry, `${label}.chartPalette[${index}]`)),
    ...(row.background === undefined ? {} : { background: normalizedBackground(row.background, `${label}.background`) }),
  }
}

export function parseSkinPack(value: string): SkinPack {
  if (new TextEncoder().encode(value).byteLength > MAX_SKIN_PACKAGE_BYTES) throw new Error('Skin package exceeds 1.5 MB.')
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('Skin package is not valid JSON.')
  }
  const row = objectRow(parsed, 'Skin package')
  const id = safeString(row.id, 'id', 64)
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(id)) throw new Error('id must use 2–64 lowercase letters, numbers, or hyphens.')
  const manifestRow = row.manifest === undefined ? {} : objectRow(row.manifest, 'manifest')
  const schemaVersion = manifestRow.schemaVersion ?? SKIN_API_VERSION
  if (schemaVersion !== 1 && schemaVersion !== SKIN_API_VERSION) throw new Error(`Unsupported skin schema version: ${String(schemaVersion)}.`)
  const recipesRow = row.recipes === undefined ? {} : objectRow(row.recipes, 'recipes')
  const assetsRow = row.assets === undefined ? null : objectRow(row.assets, 'assets')
  let defaultColorMode: ResolvedThemeColorMode
  let variants: SkinPack['variants']
  if (row.variants !== undefined) {
    const variantsRow = objectRow(row.variants, 'variants')
    variants = {
      ...(variantsRow.light === undefined ? {} : { light: normalizedVariant(variantsRow.light, 'variants.light') }),
      ...(variantsRow.dark === undefined ? {} : { dark: normalizedVariant(variantsRow.dark, 'variants.dark') }),
    }
    if (!variants.light && !variants.dark) throw new Error('variants must contain light and/or dark.')
    const requestedDefault = enumValue(row.defaultColorMode ?? (variants.light ? 'light' : 'dark'), ['light', 'dark'] as const, 'defaultColorMode')
    defaultColorMode = variants[requestedDefault] ? requestedDefault : (variants.light ? 'light' : 'dark')
  } else {
    // Skin API v1 stored one resolved palette at the package root. Keep it portable as a single-mode v2 skin.
    defaultColorMode = row.isDark === true ? 'dark' : 'light'
    variants = {
      [defaultColorMode]: normalizedVariant({
        tokens: row.tokens,
        syntaxTheme: row.syntaxTheme,
        terminalTheme: row.terminalTheme,
        chartPalette: row.chartPalette,
        ...(row.background === undefined ? {} : { background: row.background }),
      }, `variants.${defaultColorMode}`),
    }
  }
  const homepage = manifestRow.homepage === undefined ? '' : safeString(manifestRow.homepage, 'manifest.homepage', 300)
  if (homepage && !/^https?:\/\//u.test(homepage)) throw new Error('manifest.homepage must use http or https.')
  const pack: SkinPack = {
    manifest: {
      schemaVersion: SKIN_API_VERSION,
      version: manifestRow.version === undefined ? '1.0.0' : safeString(manifestRow.version, 'manifest.version', 40),
      author: manifestRow.author === undefined ? 'Imported' : safeString(manifestRow.author, 'manifest.author', 100),
      ...(homepage ? { homepage } : {}),
      ...(manifestRow.chromeLabel === undefined ? {} : { chromeLabel: safeString(manifestRow.chromeLabel, 'manifest.chromeLabel', 24) }),
    },
    ...(row.workbench === undefined ? {} : { workbench: Object.fromEntries(
      Object.entries(objectRow(row.workbench, 'workbench')).map(([key, value]) => {
        if (!WORKBENCH_ROLES.includes(key)) throw new Error(`Unsupported Workbench role: ${key}`)
        return [key, cssValue(value, `workbench.${key}`)]
      }),
    ) }),
    id,
    name: safeString(row.name, 'name', 80),
    description: safeString(row.description ?? '', 'description', 240, true),
    defaultColorMode,
    variants,
    recipes: Object.fromEntries(Object.entries(RECIPE_VALUES).map(([key, allowed]) => [
      key,
      enumValue(recipesRow[key] ?? DEFAULT_SKIN_RECIPES[key as keyof typeof DEFAULT_SKIN_RECIPES], allowed, `recipes.${key}`),
    ])) as SkinPack['recipes'],
    ...(assetsRow ? { assets: {
      ...(assetsRow.background === undefined ? {} : { background: imageAsset(assetsRow.background, 'assets.background') }),
      ...(assetsRow.brandMark === undefined ? {} : { brandMark: imageAsset(assetsRow.brandMark, 'assets.brandMark') }),
      ...(assetsRow.assistantAvatar === undefined ? {} : { assistantAvatar: imageAsset(assetsRow.assistantAvatar, 'assets.assistantAvatar') }),
      ...(assetsRow.userAvatar === undefined ? {} : { userAvatar: imageAsset(assetsRow.userAvatar, 'assets.userAvatar') }),
    } } : {}),
  }
  if (pack.assets?.background && pack.recipes.backdrop !== 'image') {
    pack.recipes.backdrop = 'image'
  }
  return pack
}
