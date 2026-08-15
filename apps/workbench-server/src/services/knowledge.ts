/**
 * 知识/排障检索：SQLite FTS5（trigram 分词，支持中文 3 字及以上短语）
 * + LIKE 子串兜底（覆盖 1-2 字短关键词）。
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

export interface SearchHit {
  path: string
  snippet: string
}

const INDEXABLE_EXT = new Set(['.md', '.txt', '.go', '.py', '.java', '.ts', '.tsx', '.js', '.thrift', '.proto', '.sql', '.yaml', '.yml', '.json'])

export class KnowledgeIndex {
  private db: DatabaseSync

  constructor(dbPath = ':memory:') {
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(path, content, tokenize='trigram');
    `)
  }

  /** 清空并重建索引。 */
  rebuild(root: string): { indexed: number } {
    this.db.exec('DELETE FROM docs')
    const stmt = this.db.prepare('INSERT INTO docs (path, content) VALUES (?, ?)')
    let indexed = 0
    const walk = (dir: string, relPrefix: string) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const rel = relPrefix ? `${relPrefix}/${entry}` : entry
        const st = statSync(full)
        if (st.isDirectory()) {
          if (entry === 'node_modules' || entry === '.git') continue
          walk(full, rel)
        } else if (INDEXABLE_EXT.has(extname(entry))) {
          try {
            const content = readFileSync(full, 'utf8')
            // 大文件截断，避免索引爆炸
            stmt.run(rel, content.slice(0, 200_000))
            indexed++
          } catch {
            // 跳过不可读文件
          }
        }
      }
    }
    walk(join(root, 'docs'), 'docs')
    walk(join(root, 'specs'), 'specs')
    walk(join(root, 'services'), 'services')
    return { indexed }
  }

  /**
   * 检索：trigram 匹配（3 字+），失败时 LIKE 子串兜底。
   */
  search(query: string, limit = 20): SearchHit[] {
    const q = query.trim()
    if (!q) return []
    const hits: SearchHit[] = []

    if ([...q].length >= 3) {
      try {
        const rows = this.db
          .prepare('SELECT path, snippet(docs, 1, \'\', \'\', \'…\', 24) AS snip FROM docs WHERE docs MATCH ? LIMIT ?')
          .all(q, limit) as { path: string; snip: string }[]
        for (const r of rows) hits.push({ path: r.path, snippet: r.snip })
      } catch {
        // MATCH 语法错误（特殊字符），走 LIKE 兜底
      }
    }

    if (hits.length === 0) {
      const like = `%${q}%`
      const rows = this.db
        .prepare('SELECT path, substr(content, 1, 200) AS snip FROM docs WHERE content LIKE ? LIMIT ?')
        .all(like, limit) as { path: string; snip: string }[]
      for (const r of rows) hits.push({ path: r.path, snippet: r.snip })
    }

    return hits
  }

  close() {
    this.db.close()
  }
}
