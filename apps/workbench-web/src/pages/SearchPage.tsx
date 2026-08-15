import { useEffect, useState } from 'react'
import { api, Workspace } from '../api'

interface Props {
  ws: Workspace
  showToast: (msg: string) => void
}

interface Hit {
  path: string
  snippet: string
}

export function SearchPage({ ws, showToast }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [total, setTotal] = useState(0)
  const [searching, setSearching] = useState(false)

  const doSearch = (query: string) => {
    if (!query.trim()) {
      setHits([])
      setTotal(0)
      return
    }
    setSearching(true)
    api.search(ws.id, query.trim())
      .then((r) => {
        setHits(r.hits)
        setTotal(r.total)
      })
      .catch(e => showToast(e.message))
      .finally(() => setSearching(false))
  }

  const rebuild = () => {
    api.rebuildSearch(ws.id)
      .then(r => showToast(`索引已重建，共 ${r.indexed} 个文件`))
      .catch(e => showToast(e.message))
  }

  // 首次进入自动重建索引
  useEffect(() => {
    rebuild()
  }, [ws.id])

  return (
    <>
      <div className="topbar">
        <h1>排障检索</h1>
        <span className="crumb">SQLite FTS5（trigram）+ LIKE 兜底</span>
        <div className="spacer"></div>
        <button className="btn" onClick={rebuild}>🔄 重建索引</button>
      </div>
      <div className="content">
        <div className="card card-pad mb20">
          <div className="flex">
            <input
              className="input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder="输入关键词检索代码/文档/配置/排障记录…（如：预算返还、ORDER_BOOST）"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch(q)}
            />
            <button className="btn primary" onClick={() => doSearch(q)} disabled={searching}>
              {searching ? '搜索中…' : '搜索'}
            </button>
          </div>
        </div>
        {total > 0 && <div className="muted mb12" style={{ fontSize: 12.5 }}>共 {total} 条结果</div>}
        {hits.length === 0 ? (
          <div className="card empty">{q ? '无结果，尝试其他关键词' : '输入关键词开始检索（首次使用请先点"重建索引"）'}</div>
        ) : (
          <div className="card">
            {hits.map(h => (
              <div className="result-item" key={h.path}>
                <div className="file">{h.path}</div>
                <div className="snippet">{h.snippet}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
