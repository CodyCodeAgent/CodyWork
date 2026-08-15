import { useEffect, useState } from 'react'
import { api, Workspace, Demand, Worktree, Repo } from '../api'
import { statusLabel } from '../App'

interface Props {
  ws: Workspace
  demandId: string
  showToast: (msg: string) => void
}

const STEPS = ['draft', 'spec', 'plan', 'tasks', 'implement', 'review', 'test-report', 'done', 'compound']

export function DemandDetail({ ws, demandId, showToast }: Props) {
  const [demand, setDemand] = useState<(Demand & { worktrees: Worktree[] }) | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState('')

  const refresh = () => {
    api.getDemand(demandId).then(setDemand).catch(e => showToast(e.message))
    api.listRepos(ws.id).then(setRepos).catch(() => {})
  }
  useEffect(refresh, [demandId, ws.id])

  const setStatus = (status: string) => {
    api.setDemandStatus(demandId, status).then(() => {
      showToast(`状态 → ${statusLabel(status)}`)
      refresh()
    }).catch(e => showToast(e.message))
  }

  const generate = (step: string) => {
    setGenerating(true)
    setGenerated('')
    api.generateSdd(demandId, step)
      .then((r) => {
        setGenerated(r.content)
        showToast(`AI 已生成 ${step} 内容`)
      })
      .catch(e => showToast(e.message))
      .finally(() => setGenerating(false))
  }

  const createWorktrees = () => {
    const names = Array.from(selectedRepos)
    if (names.length === 0) {
      showToast('请先勾选仓库')
      return
    }
    api.createWorktrees(demandId, names).then((r) => {
      const failed = r.results.filter(x => !x.ok)
      if (failed.length > 0) showToast(`部分失败: ${failed[0]?.error ?? '未知错误'}`)
      else showToast(`已创建 ${r.results.length} 个 worktree`)
      refresh()
    }).catch(e => showToast(e.message))
  }

  if (!demand) return <div className="content">加载中…</div>

  const stepIdx = STEPS.indexOf(demand.status)
  const worktreeRepos = new Set(demand.worktrees.map(w => w.repo))

  return (
    <>
      <div className="topbar">
        <h1>{demand.name}</h1>
        <span className="crumb">specs/{demand.slug}</span>
      </div>
      <div className="content">
        <div className="card card-pad mb20">
          <div className="section-title mb12">SDD 流水线</div>
          <div className="pipeline">
            {STEPS.map((s, i) => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div
                  className={`pipe-step ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'wait'}`}
                  onClick={() => setStatus(s)}
                  title={`点击推进到 ${statusLabel(s)}`}
                >
                  <span className="dot"></span>
                  {statusLabel(s)}
                </div>
                {i < STEPS.length - 1 && <span className="pipe-arrow">→</span>}
              </span>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>点击步骤可推进/回退状态（确定性操作，立即生效）</div>
        </div>

        <div className="grid grid-2">
          <div className="card card-pad">
            <div className="section-title mb12">Worktree 管理</div>
            {demand.worktrees.length === 0 ? (
              <div className="muted mb12" style={{ fontSize: 12.5 }}>暂无 worktree</div>
            ) : (
              <table>
                <tbody>
                  <tr><th>仓库</th><th>分支</th><th>状态</th></tr>
                  {demand.worktrees.map(w => (
                    <tr key={w.repo}>
                      <td className="mono">{w.repo}</td>
                      <td className="mono">{w.branch}</td>
                      <td>{w.dirty ? <span className="tag orange">dirty</span> : <span className="tag green">clean</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="section-title mt20 mb12" style={{ fontSize: 13 }}>为需求创建 worktree（跨仓库）</div>
            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 12 }}>
              {repos.filter(r => !worktreeRepos.has(r.name)).map(r => (
                <label key={r.id} style={{ display: 'block', padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedRepos.has(r.name)}
                    onChange={(e) => {
                      const next = new Set(selectedRepos)
                      if (e.target.checked) next.add(r.name)
                      else next.delete(r.name)
                      setSelectedRepos(next)
                    }}
                  />{' '}
                  <span className="mono">{r.name}</span>
                </label>
              ))}
              {repos.filter(r => !worktreeRepos.has(r.name)).length === 0 && (
                <div className="muted" style={{ fontSize: 12.5 }}>所有仓库已创建 worktree</div>
              )}
            </div>
            <button className="btn primary" onClick={createWorktrees}>创建 worktree</button>
          </div>

          <div className="card card-pad">
            <div className="section-title mb12">AI 生成层（SDD 文档）</div>
            <div className="muted mb12" style={{ fontSize: 12.5 }}>
              由 dsh agent 生成对应文档，写入 specs/ 目录。需要服务端配置 DEEPSEEK_API_KEY。
            </div>
            <div className="flex" style={{ flexWrap: 'wrap' }}>
              {(['spec', 'plan', 'tasks', 'review', 'test-report'] as const).map(s => (
                <button key={s} className="btn small" disabled={generating} onClick={() => generate(s)}>
                  {generating ? '生成中…' : `生成 ${s}`}
                </button>
              ))}
            </div>
            {generated && (
              <div className="mt20">
                <div className="section-title mb12" style={{ fontSize: 13 }}>生成结果</div>
                <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: '#fafbfc', padding: 12, borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>{generated}</pre>
              </div>
            )}
            <table className="mt20">
              <tbody>
                <tr><th>字段</th><th>值</th></tr>
                <tr><td>slug</td><td className="mono">{demand.slug}</td></tr>
                <tr><td>状态</td><td><span className="tag orange">{statusLabel(demand.status)}</span></td></tr>
                <tr><td>创建时间</td><td className="mono">{new Date(demand.created_at).toLocaleString()}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
