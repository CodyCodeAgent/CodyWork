import { useState } from 'react'
import { Workspace } from '../api'

interface Props {
  workspaces: Workspace[]
  onOpen: (ws: Workspace) => void
  onCreate: (name: string, path: string, repos: string[]) => void
  onDelete: (id: string) => void
}

export function WorkspacesPage({ workspaces, onOpen, onCreate, onDelete }: Props) {
  const [showWizard, setShowWizard] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [reposText, setReposText] = useState('')

  return (
    <>
      <div className="topbar">
        <h1>工作台实例</h1>
        <span className="crumb">每个工作台 = 一个 CSR 项目目录</span>
        <div className="spacer"></div>
        <button className="btn primary" onClick={() => setShowWizard(!showWizard)}>＋ 初始化新工作台</button>
      </div>
      <div className="content">
        {showWizard && (
          <div className="card card-pad mb20">
            <div className="section-title mb12">初始化新工作台</div>
            <label className="muted" style={{ fontSize: 12 }}>项目名称</label>
            <input className="input" placeholder="life-csr" value={name} onChange={e => setName(e.target.value)} />
            <label className="muted" style={{ fontSize: 12 }}>目录位置（绝对路径）</label>
            <input className="input" placeholder="/Users/you/code/life-csr" value={path} onChange={e => setPath(e.target.value)} />
            <label className="muted" style={{ fontSize: 12 }}>仓库列表（每行一个 git URL，可留空稍后再加）</label>
            <textarea
              className="input"
              style={{ minHeight: 90 }}
              placeholder={'git@code.byted.org:life/life_marketing_assets_api.git\ngit@code.byted.org:life/life_idl.git'}
              value={reposText}
              onChange={e => setReposText(e.target.value)}
            />
            <div className="flex">
              <button
                className="btn primary"
                disabled={!name || !path}
                onClick={() => {
                  const repos = reposText.split('\n').map(s => s.trim()).filter(Boolean)
                  onCreate(name, path, repos)
                  setShowWizard(false)
                  setName('')
                  setPath('')
                  setReposText('')
                }}
              >
                🚀 创建
              </button>
              <button className="btn" onClick={() => setShowWizard(false)}>取消</button>
            </div>
          </div>
        )}

        {workspaces.length === 0 ? (
          <div className="card empty">还没有工作台，点击右上角"初始化新工作台"开始</div>
        ) : (
          <div className="grid grid-2">
            {workspaces.map(ws => (
              <div className="card ws-card" style={{ padding: 18, cursor: 'pointer' }} key={ws.id} onClick={() => onOpen(ws)}>
                <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  🏠 {ws.name}
                  <button
                    className="btn small danger"
                    style={{ marginLeft: 'auto' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`删除工作台 ${ws.name}？\n（只删除记录，不删除磁盘目录）`)) onDelete(ws.id)
                    }}
                  >
                    删除
                  </button>
                </div>
                <div className="mono" style={{ fontSize: 11.5, color: '#9ca3af', margin: '6px 0 12px' }}>{ws.path}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>创建于 {new Date(ws.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
