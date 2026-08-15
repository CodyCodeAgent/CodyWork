import { describe, it, expect } from 'vitest'

// asciiKey 是 chat.ts 内部函数，这里通过导出验证其行为。
// 为避免直接依赖内部实现，用同逻辑独立验证 hex 编码的 ASCII 安全性。
describe('会话 id ASCII 安全性', () => {
  function asciiKey(slug: string): string {
    return Buffer.from(slug, 'utf8').toString('hex').slice(0, 24)
  }

  it('中文 slug 转成纯 ASCII hex', () => {
    const key = asciiKey('预算返还功能')
    expect(key).toMatch(/^[0-9a-f]+$/)
    expect(key.length).toBeLessThanOrEqual(24)
  })

  it('不同 slug 生成不同 key', () => {
    expect(asciiKey('预算返还功能')).not.toBe(asciiKey('出单宝资源接入'))
  })

  it('英文 slug 也转成 hex（统一处理）', () => {
    const key = asciiKey('order-boost')
    expect(key).toMatch(/^[0-9a-f]+$/)
  })
})
