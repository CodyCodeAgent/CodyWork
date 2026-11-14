// Adapted from CodyWeb (MIT). See LICENSE.CodyWeb in this directory.
import { DEFAULT_SKIN_RECIPES, SKIN_API_VERSION } from './tokens'
import type { SkinPack, SkinRecipes, SkinVariant, ThemeTokens } from './tokens'

const systemSans = 'Inter, "IBM Plex Sans", "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
const systemMono = '"IBM Plex Mono", "Cascadia Code", "SFMono-Regular", ui-monospace, monospace'

function tokens(overrides: Partial<ThemeTokens> & { color: ThemeTokens['color'] }): ThemeTokens {
  return {
    color: overrides.color,
    font: overrides.font ?? {
      sans: systemSans,
      mono: systemMono,
    },
    spacing: overrides.spacing ?? {
      xs: '0.25rem',
      sm: '0.625rem',
      md: '0.875rem',
      lg: '1.25rem',
    },
    radius: overrides.radius ?? {
      sm: '0.4rem',
      md: '0.7rem',
      lg: '1rem',
    },
    shadow: overrides.shadow ?? {
      panel: '0 1px 0 rgb(255 255 255 / 0.035), 0 12px 32px rgb(7 10 15 / 0.14)',
      floating: '0 24px 64px rgb(7 10 15 / 0.34)',
      focus: '0 0 0 3px rgb(66 200 245 / 0.22)',
    },
    motion: overrides.motion ?? {
      fast: '120ms',
      normal: '180ms',
      slow: '280ms',
    },
    density: overrides.density ?? 'comfortable',
  }
}

function skin(input: Omit<SkinPack, 'manifest' | 'recipes' | 'defaultColorMode' | 'variants'> & SkinVariant & {
  isDark: boolean
  alternate: SkinVariant
  manifest?: Partial<SkinPack['manifest']>
  recipes?: Partial<SkinRecipes>
}): SkinPack {
  const {
    isDark,
    tokens: defaultTokens,
    syntaxTheme: defaultSyntaxTheme,
    terminalTheme: defaultTerminalTheme,
    chartPalette: defaultChartPalette,
    background: defaultBackground,
    alternate,
    ...definition
  } = input
  const defaultColorMode = isDark ? 'dark' : 'light'
  const alternateColorMode = isDark ? 'light' : 'dark'
  return {
    ...definition,
    manifest: {
      schemaVersion: SKIN_API_VERSION,
      version: input.manifest?.version ?? '1.0.0',
      author: input.manifest?.author ?? 'CodyWeb',
      ...(input.manifest?.homepage ? { homepage: input.manifest.homepage } : {}),
      ...(input.manifest?.chromeLabel ? { chromeLabel: input.manifest.chromeLabel } : {}),
    },
    recipes: {
      ...DEFAULT_SKIN_RECIPES,
      ...input.recipes,
    },
    defaultColorMode,
    variants: {
      [defaultColorMode]: {
        tokens: defaultTokens,
        syntaxTheme: defaultSyntaxTheme,
        terminalTheme: defaultTerminalTheme,
        chartPalette: defaultChartPalette,
        ...(defaultBackground ? { background: defaultBackground } : {}),
      },
      [alternateColorMode]: alternate,
    },
  }
}


export const qqSkin = skin({
    id: 'qq-2007',
    name: 'QQ 2007',
    description: 'Blue-silver desktop nostalgia with crisp, readable work surfaces.',
    isDark: false,
    syntaxTheme: 'light',
    terminalTheme: { background: '#10273d', foreground: '#eaf6ff' },
    chartPalette: ['#1677c8', '#2d9b5f', '#e08a17', '#d94b45', '#7657b5'],
    background: { type: 'solid' },
    manifest: {
      version: '1.0.0',
      author: 'CodyWeb',
      chromeLabel: '2007',
    },
    recipes: {
      chrome: 'glossy',
      navigation: 'classic',
      panel: 'beveled',
      control: 'beveled',
      message: 'rail',
      identity: 'avatars',
      composer: 'beveled',
      backdrop: 'aero-grid',
    },
    tokens: tokens({
      color: {
        background: '#d9eafa',
        surface: '#c9e1f7',
        panel: '#f8fbff',
        elevated: '#e8f3fd',
        text: '#173752',
        textMuted: '#526f88',
        border: '#77a3ca',
        accent: '#1677c8',
        danger: '#c83d36',
        warning: '#d8790b',
        success: '#207a4c',
        info: '#1677c8',
        codeBackground: '#112b42',
        terminalBackground: '#10273d',
      },
      font: {
        sans: 'Tahoma, "Microsoft YaHei", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
        mono: systemMono,
      },
      spacing: {
        xs: '0.25rem',
        sm: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
      },
      radius: {
        sm: '0.2rem',
        md: '0.3rem',
        lg: '0.45rem',
      },
      shadow: {
        panel: 'inset 0 1px 0 rgb(255 255 255 / 0.92), 0 1px 2px rgb(34 82 122 / 0.18)',
        floating: '0 12px 30px rgb(34 82 122 / 0.28), inset 0 1px 0 rgb(255 255 255 / 0.9)',
        focus: '0 0 0 3px rgb(22 119 200 / 0.25)',
      },
      motion: {
        fast: '120ms',
        normal: '180ms',
        slow: '240ms',
      },
      density: 'compact',
    }),
    alternate: {
      syntaxTheme: 'dark',
      terminalTheme: { background: '#071521', foreground: '#dff3ff' },
      chartPalette: ['#5eb7ff', '#55d58b', '#ffb44c', '#ff7972', '#b79bff'],
      background: { type: 'solid' },
      tokens: tokens({
        color: {
          background: '#0d2234',
          surface: '#132f46',
          panel: '#193a55',
          elevated: '#244c69',
          text: '#edf8ff',
          textMuted: '#a8c5d8',
          border: '#426d8c',
          accent: '#5eb7ff',
          danger: '#ff7972',
          warning: '#ffb44c',
          success: '#55d58b',
          info: '#5eb7ff',
          codeBackground: '#071521',
          terminalBackground: '#071521',
        },
        font: {
          sans: 'Tahoma, "Microsoft YaHei", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
          mono: systemMono,
        },
        spacing: {
          xs: '0.25rem',
          sm: '0.5rem',
          md: '0.75rem',
          lg: '1rem',
        },
        radius: {
          sm: '0.2rem',
          md: '0.3rem',
          lg: '0.45rem',
        },
        shadow: {
          panel: 'inset 0 1px 0 rgb(255 255 255 / 0.12), 0 2px 5px rgb(0 0 0 / 0.35)',
          floating: '0 16px 38px rgb(0 0 0 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.14)',
          focus: '0 0 0 3px rgb(94 183 255 / 0.28)',
        },
        motion: {
          fast: '120ms',
          normal: '180ms',
          slow: '240ms',
        },
        density: 'compact',
      }),
    },
  })
