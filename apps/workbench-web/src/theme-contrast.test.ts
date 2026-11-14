import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const palette = readFileSync(new URL('./theme-tokens.css', import.meta.url), 'utf8')
import { themeOptions } from './theme'

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/.{2}/g)!.map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  return .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!
}

describe('theme text readability', () => {
  for (const theme of themeOptions) {
    it(`${theme.label} keeps normal text at WCAG AA contrast`, () => {
      const block = palette.match(new RegExp(`:root\\[data-theme="${theme.id}"\\]\\s*\\{([^}]+)\\}`))?.[1]
      expect(block).toBeTruthy()
      const tokens = Object.fromEntries([...block!.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/g)].map(match => [match[1], match[2]]))
      const pairs = [
        ['ink-primary', 'surface-panel'], ['ink-secondary', 'surface-panel'],
        ['ink-tertiary', 'surface-panel'], ['ink-secondary', 'surface-subtle'],
        ['nav-text', 'nav-bg'], ['nav-muted', 'nav-bg'],
        ['on-accent', 'accent'], ['accent', 'accent-subtle'],
        ['success', 'success-bg'], ['warning', 'warning-bg'], ['danger', 'danger-bg'],
        ['code-text', 'code-bg'],
      ]
      for (const [foreground, background] of pairs) {
        const values = [luminance(tokens[foreground!]!), luminance(tokens[background!]!)].sort((a, b) => a - b)
        expect((values[1]! + .05) / (values[0]! + .05), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
