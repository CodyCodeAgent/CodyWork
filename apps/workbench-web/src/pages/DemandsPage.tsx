import { useEffect, useState } from 'react'
import { api, Workspace, Demand } from '../api'
import { statusLabel } from '../App'

interface Props {
  ws: Workspace
  onOpenDemand: (demandId: string) => void
  showToast: (msg: string) => void
}

const COLUMNS: { key: string; label: string }[] = [
  { key: 'draft', label: '📝 起草' },
  { key: 'spec', label: '📐 方案中' },
  { key: 'plan', label: '📐 计划中' },
  { key: 'tasks', label: '🗒️ 任务中' },
  { key: 'implement', label: '⚒️ 开发中' },
  { key: 'review', label: '👀 Review' },
  { key: 'test-report', label: '🧪 测试' },
  { key: 'done', label: '✅ 完成' },
  { key: 'compound', label: '🌱 已沉淀' },
]

export function DemandsPage({ ws, onOpenDemand, showToast }: Props) {
  const [demands, setDemands] = useState<Demand[]>([])
  const [name, setName] = useState('')

  const refresh = () => api.listDemands(ws.id).then(setDemands).catch(e => showToast(e.message))
  useEffect(() => {
    void refresh()
  }, [ws.id])

  const create = () => {
    if (!name.trim()) return
    api.createDemand(ws.id, name.trim()).then(() => {
      showToast('需求已创建（specs/ 模板已生成）')
      setName('')
      refresh()
    }).catch(e => showToast(e.message))
  }

  return (
    <>
      <div className="topbar">
        <h1>需求看板</h1>
        <span className="crumb">SDD 全流程</span>
        <div className="spacer"></div>
        <div className="flex">
          <input
            className="input"
            style={{ marginBottom: 0, width: 220 }}
            placeholder="需求名称"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
          />
          <button className="btn primary" onClick={create}>＋ 新建需求</button>
        </div>
      </div>
      <div className="content">
        <div className="kanban">
          {COLUMNS.map((col) => {
            const items = demands.filter(d => d.status === col.key)
            return (
              <div className="kanban-col" key={col.key}>
                <div className="kanban-head">{col.label} <span className="count">{items.length}</span></div>
                {items.length === 0 && <div className="empty" style={{ padding: 20 }}>暂无</div>}
                {items.map(d => (
                  <div className="kcard" key={d.id} onClick={() => onOpenDemand(d.id)}>
                    <div className="title">{d.name}</div>
                    <div className="sub mono">{d.slug}</div>
                    <div className="foot"><span className="tag orange">{statusLabel(d.status)}</span></div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
