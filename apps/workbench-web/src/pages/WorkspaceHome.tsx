import { useEffect, useState } from 'react'
import { api, Workspace, Repo, Demand } from '../api'
import { Page } from '../App'

interface Props {
  ws: Workspace
  onNav: (p: Page) => void
  showToast: (msg: string) => void
}

export function WorkspaceHome({ ws, onNav, showToast }: Props) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [demands, setDemands] = useState<Demand[]>([])
  const [docs, setDocs] = useState<string[]>([])

  useEffect(() => {
    api.listRepos(ws.id).then(setRepos).catch(e => showToast(e.message))
    api.listDemands(ws.id).then(setDemands).catch(e => showToast(e.message))
    api.listDocs(ws.id).then(d => setDocs(d.files)).catch(() => {})
  }, [ws.id])

  const activeDemands = demands.filter(d => d.status !== 'done' && d.status !== 'compound')

  return (
    <>
      <div className="topbar">
        <h1>项目总览</h1>
        <span className="crumb">{ws.name}</span>
        <div className="spacer"></div>
        <button className="btn" onClick={() => onNav({ kind: 'repos', ws })}>＋ 添加仓库</button>
        <button className="btn" onClick={() => onNav({ kind: 'demands', ws })}>＋ 新建需求</button>
      </div>
      <div className="content">
        <div className="grid grid-4 mb20">
          <div className="card stat"><div className="label">代码仓库</div><div className="num">{repos.length}</div></div>
          <div className="card stat"><div className="label">进行中需求</div><div className="num">{activeDemands.length}</div></div>
          <div className="card stat"><div className="label">docs 文档</div><div className="num">{docs.length}</div></div>
          <div className="card stat"><div className="label">需求总数</div><div className="num">{demands.length}</div></div>
        </div>
        <div className="grid grid-2">
          <div className="card card-pad">
            <div className="section-title">活跃需求</div>
            <table>
              <tbody>
                <tr><th>需求</th><th>阶段</th></tr>
                {activeDemands.length === 0 && <tr><td colSpan={2} className="muted">暂无进行中需求</td></tr>}
                {activeDemands.map(d => (
                  <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => onNav({ kind: 'demand', ws, demandId: d.id })}>
                    <td style={{ fontWeight: 500 }}>{d.name}</td>
                    <td><span className="tag orange">{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card card-pad">
            <div className="section-title">代码仓库</div>
            <table>
              <tbody>
                <tr><th>仓库</th><th>分支</th><th>状态</th></tr>
                {repos.length === 0 && <tr><td colSpan={3} className="muted">暂无仓库</td></tr>}
                {repos.slice(0, 8).map(r => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontWeight: 500 }}>{r.name}</td>
                    <td className="mono">{r.status?.branch ?? '—'}</td>
                    <td>{r.status?.dirty ? <span className="tag orange">dirty</span> : <span className="tag green">clean</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
