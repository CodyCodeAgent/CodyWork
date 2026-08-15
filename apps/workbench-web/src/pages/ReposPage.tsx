import { useEffect, useState } from 'react'
import { api, Workspace, Repo } from '../api'

interface Props {
  ws: Workspace
  showToast: (msg: string) => void
}

export function ReposPage({ ws, showToast }: Props) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [url, setUrl] = useState('')

  const refresh = () => {
    api.listRepos(ws.id).then(setRepos).catch(e => showToast(e.message))
  }
  useEffect(() => {
    refresh()
  }, [ws.id])

  const add = () => {
    if (!url.trim()) return
    api.addRepo(ws.id, url.trim()).then((r) => {
      if (!r.ok) showToast(r.error ?? '添加失败')
      else showToast(`已添加仓库 ${r.name}`)
      setUrl('')
      refresh()
    }).catch(e => showToast(e.message))
  }

  return (
    <>
      <div className="topbar">
        <h1>代码仓库</h1>
        <span className="crumb">services/ · 只读基线</span>
      </div>
      <div className="content">
        <div className="card card-pad mb20">
          <div className="section-title mb12">添加仓库</div>
          <div className="flex">
            <input
              className="input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder="git@code.byted.org:life/life_marketing_assets_api.git"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
            />
            <button className="btn primary" onClick={add}>添加</button>
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <tbody>
              <tr><th>仓库</th><th>分支</th><th>状态</th><th>最近提交</th><th></th></tr>
              {repos.length === 0 && <tr><td colSpan={5} className="muted">暂无仓库，请先添加</td></tr>}
              {repos.map(r => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontWeight: 500 }}>{r.name}</td>
                  <td className="mono">{r.status?.branch ?? '—'}</td>
                  <td>{r.status?.dirty ? <span className="tag orange">dirty</span> : <span className="tag green">clean</span>}</td>
                  <td className="mono muted">{r.status?.lastCommit ?? '—'}</td>
                  <td>
                    <button
                      className="btn small danger"
                      onClick={() => {
                        if (confirm(`移除仓库 ${r.name}？\n（只移除记录，不删除磁盘目录）`)) {
                          api.removeRepo(ws.id, r.name).then(() => {
                            showToast('已移除')
                            refresh()
                          })
                        }
                      }}
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
