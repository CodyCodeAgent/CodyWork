import { useCallback, useEffect, useState } from 'react'
import { api, Workspace } from './api'
import { WorkspacesPage } from './pages/WorkspacesPage'
import { WorkspaceHome } from './pages/WorkspaceHome'
import { ReposPage } from './pages/ReposPage'
import { DocsPage } from './pages/DocsPage'
import { DemandsPage } from './pages/DemandsPage'
import { DemandDetail } from './pages/DemandDetail'

export type Page =
  | { kind: 'workspaces' }
  | { kind: 'home'; ws: Workspace }
  | { kind: 'repos'; ws: Workspace }
  | { kind: 'docs'; ws: Workspace }
  | { kind: 'demands'; ws: Workspace }
  | { kind: 'demand'; ws: Workspace; demandId: string }

const STEP_LABELS: Record<string, string> = {
  draft: '起草',
  spec: 'Spec',
  plan: 'Plan',
  tasks: 'Tasks',
  implement: 'Implement',
  review: 'Review',
  'test-report': 'Test',
  done: 'Done',
  compound: 'Compound',
}

export function statusLabel(status: string): string {
  return STEP_LABELS[status] ?? status
}

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [page, setPage] = useState<Page>({ kind: 'workspaces' })
  const [toast, setToast] = useState('')

  const refreshWorkspaces = useCallback(() => {
    api.listWorkspaces().then(setWorkspaces).catch(e => showToast(e.message))
  }, [])

  useEffect(() => {
    refreshWorkspaces()
  }, [refreshWorkspaces])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const nav = (p: Page) => setPage(p)

  const ws = page.kind !== 'workspaces' ? page.ws : null

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo" onClick={() => nav({ kind: 'workspaces' })} style={{ cursor: 'pointer' }}>
          <div className="logo-badge">CS</div>
          <div>
            <div className="logo-title">CSR Workbench</div>
            <div className="logo-sub">AI 研发工作台</div>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-label">工作台</div>
          <div className={`nav-item ${page.kind === 'workspaces' ? 'active' : ''}`} onClick={() => nav({ kind: 'workspaces' })}>
            <span className="icon">🗂️</span> 工作台列表
          </div>
          {ws && (
            <>
              <div className="nav-label">CSR 项目</div>
              <div className={`nav-item ${page.kind === 'home' ? 'active' : ''}`} onClick={() => nav({ kind: 'home', ws })}>
                <span className="icon">📊</span> 项目总览
              </div>
              <div className={`nav-item ${page.kind === 'repos' ? 'active' : ''}`} onClick={() => nav({ kind: 'repos', ws })}>
                <span className="icon">📦</span> 代码仓库
              </div>
              <div className={`nav-item ${page.kind === 'docs' ? 'active' : ''}`} onClick={() => nav({ kind: 'docs', ws })}>
                <span className="icon">📚</span> 知识库
              </div>
              <div className="nav-label">需求</div>
              <div className={`nav-item ${page.kind === 'demands' || page.kind === 'demand' ? 'active' : ''}`} onClick={() => nav({ kind: 'demands', ws })}>
                <span className="icon">📋</span> 需求看板
              </div>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <span className="dot"></span> 服务端运行中 · 端口 3210
        </div>
      </aside>
      <main className="main">
        {page.kind === 'workspaces' && (
          <WorkspacesPage
            workspaces={workspaces}
            onOpen={ws => nav({ kind: 'home', ws })}
            onCreate={(name, path, repos) =>
              api.createWorkspace(name, path, repos).then((ws) => {
                refreshWorkspaces()
                nav({ kind: 'home', ws })
                showToast(`工作台 ${ws.name} 已创建`)
              })
            }
            onDelete={id =>
              api.deleteWorkspace(id).then(() => {
                refreshWorkspaces()
                showToast('已删除')
              })
            }
          />
        )}
        {page.kind === 'home' && <WorkspaceHome ws={page.ws} onNav={nav} showToast={showToast} />}
        {page.kind === 'repos' && <ReposPage ws={page.ws} showToast={showToast} />}
        {page.kind === 'docs' && <DocsPage ws={page.ws} showToast={showToast} />}
        {page.kind === 'demands' && <DemandsPage ws={page.ws} onOpenDemand={demandId => nav({ kind: 'demand', ws: page.ws, demandId })} showToast={showToast} />}
        {page.kind === 'demand' && <DemandDetail ws={page.ws} demandId={page.demandId} showToast={showToast} />}
      </main>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}

export default App
