import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const publicAsset = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url))

describe('browser favicon assets', () => {
  it('declares same-origin SVG and ICO assets instead of depending on data URLs', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toContain('href="/favicon.ico" sizes="32x32"')
    expect(html).toContain('href="/favicon.svg" type="image/svg+xml" sizes="any"')
    expect(html).not.toContain('data:image/svg+xml')
  })

  it('provides a genuine ICO at the browser fallback path, not renamed SVG or HTML', () => {
    const ico = publicAsset('favicon.ico')
    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0])
    expect([...ico.subarray(6, 8)]).toEqual([32, 32])
    expect(ico.readUInt16LE(12)).toBe(32)
    const length = ico.readUInt32LE(14)
    const offset = ico.readUInt32LE(18)
    expect(offset + length).toBe(ico.length)
    expect(ico.readUInt32LE(offset)).toBe(40)
    expect(ico.readInt32LE(offset + 4)).toBe(32)
    expect(ico.readInt32LE(offset + 8)).toBe(64)
  })

  it('provides a self-contained vector icon with no external resource dependencies', () => {
    const svg = publicAsset('favicon.svg').toString('utf8')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 64 64"')
    expect(svg).toContain('>CW</text>')
    expect(svg).not.toMatch(/(?:href=|<script|<image)/)
  })
})
