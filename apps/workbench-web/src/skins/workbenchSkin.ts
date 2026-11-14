import { contrastRatio, contrastingTextColor, resolveSkinPack } from './themeRegistry'
import type { SkinPack, ThemePreferences } from './tokens'

// Product-specific adapter: a portable CodyWeb skin never controls Workbench layout or Runtime.
export function workbenchSkinVariables(skin: SkinPack, prefs: ThemePreferences, systemDark = false): Record<string, string> {
  const resolved = resolveSkinPack(skin, prefs.colorMode, systemDark)
  const t = resolved.tokens, c = t.color
  const readable = (color: string, background: string) => {
    if (contrastRatio(color, background) >= 4.5) return color
    const target = contrastingTextColor(background)
    const rgb = (value: string) => value.replace('#', '').match(/../g)!.slice(0, 3).map(part => parseInt(part, 16))
    if (!/^#[a-f0-9]{6}$/i.test(color)) return target
    const start = rgb(color), end = rgb(target)
    for (let step = 1; step <= 20; step++) {
      const blended = '#' + start.map((channel, index) => Math.round(channel + (end[index] - channel) * step / 20).toString(16).padStart(2, '0')).join('')
      if (contrastRatio(blended, background) >= 4.5) return blended
    }
    return target
  }
  const mix = (color: string, percent: number, base = c.panel) => `color-mix(in srgb, ${color} ${percent}%, ${base})`
  const vars: Record<string, string> = {
    'surface-canvas': c.background, 'surface-panel': c.panel, 'surface-subtle': c.surface, 'surface-raised': c.elevated,
    'ink-primary': readable(c.text, c.panel), 'ink-secondary': readable(c.textMuted, c.panel), 'ink-tertiary': readable(c.textMuted, c.panel),
    'border-default': c.border, 'border-strong': mix(c.textMuted, 60),
    accent: readable(c.accent, c.panel), 'accent-hover': readable(c.accent, c.panel), 'accent-subtle': mix(c.accent, 10), 'on-accent': contrastingTextColor(readable(c.accent, c.panel)),
    'nav-bg': c.surface, 'nav-text': readable(c.text, c.surface), 'nav-muted': readable(c.textMuted, c.surface), 'nav-hover': c.elevated,
    success: readable(c.success, c.panel), 'success-bg': c.panel, warning: readable(c.warning, c.panel), 'warning-bg': c.panel, danger: readable(c.danger, c.panel), 'danger-bg': c.panel,
    'code-bg': c.codeBackground, 'code-text': readable(c.text, c.codeBackground),
    overlay: resolved.isDark ? 'rgba(0,5,16,.68)' : 'rgba(16,29,48,.42)',
    'shadow-panel': t.shadow.panel, 'shadow-popover': t.shadow.floating,
    'radius-panel': t.radius.md, 'radius-control': t.radius.sm,
    ...skin.workbench,
    'font-body': t.font.sans, 'font-mono': t.font.mono,
    'space-1': t.spacing.xs, 'space-2': t.spacing.sm, 'space-3': t.spacing.md, 'space-4': t.spacing.lg,
    'duration-fast': t.motion.fast,
    'skin-background': skin.assets?.background ? `url("${skin.assets.background}")` : 'none',
    'skin-background-position': resolved.background?.position ?? 'center',
    'skin-background-size': resolved.background?.fit ?? 'cover',
    'skin-background-blur': `${resolved.background?.blur ?? 0}px`,
    'skin-background-dim': String(skin.assets?.background ? (resolved.background?.dim ?? 20) / 100 : 0),
    'skin-background-saturation': `${resolved.background?.saturation ?? 100}%`,
    'skin-user-avatar': skin.assets?.userAvatar ? `url("${skin.assets.userAvatar}")` : 'none',
    'skin-assistant-avatar': skin.assets?.assistantAvatar ? `url("${skin.assets.assistantAvatar}")` : 'none',
    'skin-brand-mark': skin.assets?.brandMark ? `url("${skin.assets.brandMark}")` : 'none',
  }
  if (prefs.accentColor) {
    vars.accent = prefs.accentColor
    vars['accent-hover'] = prefs.accentColor
    vars['on-accent'] = contrastingTextColor(prefs.accentColor)
    vars['accent-subtle'] = `color-mix(in srgb, ${prefs.accentColor} 12%, ${vars['surface-panel']})`
  }
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [`--${key}`, value]))
}
