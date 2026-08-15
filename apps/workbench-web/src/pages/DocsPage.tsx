import { useEffect, useState } from 'react'
import { api, Workspace } from '../api'

interface Props {
  ws: Workspace
  showToast: (msg: string) => void
}

export function DocsPage({ ws, showToast }: Props) {
  const [files, setFiles] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = () => api.listDocs(ws.id).then(d => setFiles(d.files)).catch(() => {})
  useEffect(() => {
    void refresh()
  }, [ws.id])

  useEffect(() => {
    if (!active) return
    api.readDoc(ws.id, active).then(d => setContent(d.content)).catch(e => showToast(e.message))
  }, [active, ws.id])

  const save = () => {
    if (!active) return
    setSaving(true)
    api.writeDoc(ws.id, active, content)
      .then(() => {
        showToast('已保存')
        setSaving(false)
        refresh()
      })
      .catch((e) => {
        showToast(e.message)
        setSaving(false)
      })
  }

  return (
    <>
      <div className="topbar">
        <h1>知识库</h1>
        <span className="crumb">docs/ · TTADK 体系</span>
        <div className="spacer"></div>
        {active && (
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </div>
      <div className="content">
        <div className="grid grid-2" style={{ gridTemplateColumns: '280px 1fr' }}>
          <div className="card card-pad">
            <div className="section-title mb12">目录</div>
            <div className="tree">
              {files.length === 0 && <div className="muted">暂无文档</div>}
              {files.map(f => (
                <div key={f} className={`item ${active === f ? 'active' : ''}`} onClick={() => setActive(f)}>
                  📄 {f}
                </div>
              ))}
            </div>
          </div>
          <div className="card card-pad">
            {active ? (
              <>
                <div className="section-title mb12 mono">{active}</div>
                <textarea className="input" value={content} onChange={e => setContent(e.target.value)} />
              </>
            ) : (
              <div className="empty">选择左侧文档查看/编辑</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
