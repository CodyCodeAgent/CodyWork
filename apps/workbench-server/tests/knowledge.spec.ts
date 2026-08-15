import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeIndex } from '../src/services/knowledge.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'idx-test-'))
})

function makeDocs() {
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'specs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'budget.md'), '# 预算返还规则\n\n活动结束后 T+1 返还至预算账本。\n')
  writeFileSync(join(root, 'specs', 'order-boost.md'), '# 出单宝资源接入\n\n支持资源包创建、编辑、转换。\n')
  writeFileSync(join(root, 'README.md'), '顶层文件，不应被索引。\n')
}

describe('KnowledgeIndex', () => {
  it('只索引 docs/ 和 specs/ 下的可索引文件', () => {
    makeDocs()
    const idx = new KnowledgeIndex(':memory:')
    const r = idx.rebuild(root)
    // 2 个 md 文件，README.md 在根目录不在索引范围
    expect(r.indexed).toBe(2)
    idx.close()
  })

  it('中文 3 字及以上短语走 trigram 命中', () => {
    makeDocs()
    const idx = new KnowledgeIndex(':memory:')
    idx.rebuild(root)
    const hits = idx.search('预算返还')
    expect(hits.length).toBe(1)
    expect(hits[0]?.path).toBe('docs/budget.md')
    idx.close()
  })

  it('中文 2 字短词走 LIKE 兜底命中', () => {
    makeDocs()
    const idx = new KnowledgeIndex(':memory:')
    idx.rebuild(root)
    const hits = idx.search('预算')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some(h => h.path === 'docs/budget.md')).toBe(true)
    idx.close()
  })

  it('英文关键词命中', () => {
    makeDocs()
    const idx = new KnowledgeIndex(':memory:')
    idx.rebuild(root)
    const hits = idx.search('order')
    expect(hits.some(h => h.path === 'specs/order-boost.md')).toBe(true)
    idx.close()
  })

  it('无匹配返回空数组', () => {
    makeDocs()
    const idx = new KnowledgeIndex(':memory:')
    idx.rebuild(root)
    expect(idx.search('不存在的关键词xyz').length).toBe(0)
    idx.close()
  })

  it('空查询返回空数组', () => {
    makeDocs()
    const idx = new KnowledgeIndex(':memory:')
    idx.rebuild(root)
    expect(idx.search('  ').length).toBe(0)
    idx.close()
  })
})

// 清理临时目录（vitest 结束后）
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})
