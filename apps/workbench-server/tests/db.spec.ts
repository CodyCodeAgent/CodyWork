import { describe, it, expect, beforeEach } from 'vitest'
import { WorkbenchDb, makeId, slugify, nowIso } from '../src/db/index.js'

describe('WorkbenchDb', () => {
  let db: WorkbenchDb

  beforeEach(() => {
    db = new WorkbenchDb(':memory:')
  })

  it('插入并查询工作台', () => {
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run('ws1', 'demo', '/tmp/demo', nowIso())
    const ws = db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get('ws1') as { name: string }
    expect(ws.name).toBe('demo')
  })

  it('workspace path 唯一约束', () => {
    const insert = () => db.db.prepare('INSERT INTO workspaces (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run('ws1', 'a', '/tmp/same', nowIso())
    insert()
    expect(() => db.db.prepare('INSERT INTO workspaces (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run('ws2', 'b', '/tmp/same', nowIso())).toThrow()
  })

  it('需求状态默认 draft，可更新', () => {
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run('ws1', 'demo', '/tmp/d1', nowIso())
    db.db.prepare('INSERT INTO demands (id, workspace_id, name, slug, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('d1', 'ws1', '需求', 'demand-x', 'draft', nowIso())
    const d = db.db.prepare('SELECT status FROM demands WHERE id = ?').get('d1') as { status: string }
    expect(d.status).toBe('draft')
    db.db.prepare('UPDATE demands SET status = ? WHERE id = ?').run('spec', 'd1')
    const d2 = db.db.prepare('SELECT status FROM demands WHERE id = ?').get('d1') as { status: string }
    expect(d2.status).toBe('spec')
  })

  it('删除工作台级联删除需求', () => {
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run('ws1', 'demo', '/tmp/c1', nowIso())
    db.db.prepare('INSERT INTO demands (id, workspace_id, name, slug, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('d1', 'ws1', '需求', 'demand-x', 'draft', nowIso())
    db.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws1')
    const count = db.db.prepare('SELECT count(*) c FROM demands').get() as { c: number }
    expect(count.c).toBe(0)
  })
})

describe('工具函数', () => {
  it('makeId 唯一且带前缀', () => {
    const a = makeId('ws')
    const b = makeId('ws')
    expect(a).not.toBe(b)
    expect(a.startsWith('ws_')).toBe(true)
  })

  it('slugify 处理中英文和特殊字符', () => {
    expect(slugify('出单宝 资源接入')).toBe('出单宝-资源接入')
    expect(slugify('Order Boost!')).toBe('order-boost')
    expect(slugify('  边缘  ')).toBe('边缘')
  })

  it('nowIso 返回 ISO 时间', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
