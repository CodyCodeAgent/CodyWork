import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, Conversation, ConversationEvent, ConversationPermissionMode, DashboardSnapshot, Demand, KnowledgeDocument, Repository, RuntimeSettings, SkillInstallEvent, Workspace, WorkspaceSkill, WorkspaceSource, WorkspaceSummary } from './api'

type WorkspacePage = 'dashboard' | 'demands' | 'demand' | 'knowledge' | 'skills'
type Page = { kind: 'create' } | { kind: 'list' } | { kind: 'settings' } | { kind: 'workspace'; workspace: Workspace; summary: WorkspaceSummary; tab: WorkspacePage; demandId?: string }

type IconName = 'activity' | 'arrow' | 'branch' | 'chat' | 'chevron' | 'code' | 'dashboard' | 'document' | 'folder' | 'gear' | 'grid' | 'plus' | 'refresh' | 'repository' | 'search' | 'sparkles' | 'workspace' | 'x'

const iconPaths: Record<IconName, ReactNode> = {
  activity: <><path d="M3 12h4l2-7 4 14 2-7h6" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 7c4 0 4 5 8 5h2" /></>,
  chat: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></>,
  chevron: <><path d="m9 18 6-6-6-6" /></>,
  code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  document: <><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>,
  folder: <><path d="M3 6h7l2 2h9v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.36.4.7.7 1 .3.25.68.4 1.1.4h.1v4h-.1c-.42 0-.8.15-1.1.4-.3.3-.53.64-.7 1Z" /></>,
  grid: <><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="7" cy="5" r="1" /><circle cx="7" cy="12" r="1" /><circle cx="7" cy="19" r="1" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  refresh: <><path d="M20 6v5h-5M4 18v-5h5" /><path d="M18 9a7 7 0 0 0-12-2M6 15a7 7 0 0 0 12 2" /></>,
  repository: <><path d="M4 4h16v16H4z" /><path d="M8 4v16M8 8h8M8 12h8" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  sparkles: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  workspace: <><path d="M4 5h16v14H4z" /><path d="M8 5v14M8 9h12" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
}

type LocationRoute =
  | { kind: 'create' | 'list' | 'settings' }
  | { kind: 'workspace'; workspaceId: string; tab: WorkspacePage; demandId?: string }

function parseRoute(pathname: string): LocationRoute {
  const parts = pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part))
  if (parts[0] === 'settings' && parts[1] === 'runtime') return { kind: 'settings' }
  if (parts[0] === 'workspaces' || parts[0] === 'create') return { kind: parts[0] === 'create' ? 'create' : 'list' }
  if (parts[0] !== 'w' || !parts[1]) return { kind: 'list' }
  const workspaceId = parts[1]
  if (parts[2] === 'demands' && parts[3]) return { kind: 'workspace', workspaceId, tab: 'demand', demandId: parts[3] }
  if (parts[2] === 'demands') return { kind: 'workspace', workspaceId, tab: 'demands' }
  if (parts[2] === 'knowledge') return { kind: 'workspace', workspaceId, tab: 'knowledge' }
  if (parts[2] === 'skills') return { kind: 'workspace', workspaceId, tab: 'skills' }
  return { kind: 'workspace', workspaceId, tab: 'dashboard' }
}

function pagePath(page: Page): string {
  if (page.kind === 'create') return '/create'
  if (page.kind === 'list') return '/workspaces'
  if (page.kind === 'settings') return '/settings/runtime'
  if (page.tab === 'knowledge') return `/w/${encodeURIComponent(page.workspace.id)}/knowledge`
  if (page.tab === 'skills') return `/w/${encodeURIComponent(page.workspace.id)}/skills`
  if (page.tab === 'demands') return `/w/${encodeURIComponent(page.workspace.id)}/demands`
  if (page.tab === 'demand' && page.demandId) return `/w/${encodeURIComponent(page.workspace.id)}/demands/${encodeURIComponent(page.demandId)}/chat`
  return `/w/${encodeURIComponent(page.workspace.id)}/dashboard`
}

function compactConversationEvents(events: ConversationEvent[]): ConversationEvent[] {
  const output: ConversationEvent[] = []
  const deltaByItem = new Map<string, number>()
  const planByItem = new Map<string, number>()
  const reasoningByItem = new Map<string, number>()
  const toolByItem = new Map<string, number>()
  for (const event of events) {
    const itemId = event.itemId
    if (event.type === 'message.delta' && itemId) {
      const existingIndex = deltaByItem.get(itemId)
      if (existingIndex !== undefined) {
        const existing = output[existingIndex]
        if (existing) existing.data = { ...existing.data, text: `${String(existing.data.text ?? '')}${String(event.data.text ?? '')}` }
      } else {
        deltaByItem.set(itemId, output.length)
        output.push({ ...event, data: { ...event.data } })
      }
      continue
    }
    if (event.type === 'reasoning.delta') {
      const reasoningKey = itemId ?? `turn:${event.turnId ?? 'unknown'}`
      const existingIndex = reasoningByItem.get(reasoningKey)
      const text = String(event.data.text ?? event.data.delta ?? '')
      if (existingIndex !== undefined) {
        const existing = output[existingIndex]
        if (existing) existing.data = { ...existing.data, text: `${String(existing.data.text ?? '')}${text}` }
      } else {
        reasoningByItem.set(reasoningKey, output.length)
        output.push({ ...event, data: { ...event.data, text } })
      }
      continue
    }
    if ((event.type === 'tool.started' || event.type === 'tool.completed') && itemId) {
      const existingIndex = toolByItem.get(itemId)
      if (existingIndex !== undefined) {
        const existing = output[existingIndex]
        if (existing) { existing.type = event.type; existing.data = { ...existing.data, ...event.data, ...(event.type === 'tool.completed' ? { completed: true } : {}) } }
      } else {
        toolByItem.set(itemId, output.length)
        output.push({ ...event, data: { ...event.data } })
      }
      continue
    }
    if (event.type === 'plan.updated' && itemId) {
      const existingIndex = planByItem.get(itemId)
      const item = event.data.item && typeof event.data.item === 'object' ? event.data.item as { text?: unknown } : undefined
      if (existingIndex !== undefined) {
        const existing = output[existingIndex]
        if (existing) existing.data = { ...existing.data, ...(typeof event.data.text === 'string' ? { text: `${String(existing.data.text ?? '')}${event.data.text}` } : {}), ...(typeof item?.text === 'string' && item.text ? { text: item.text } : {}) }
      } else {
        planByItem.set(itemId, output.length)
        output.push({ ...event, data: { ...event.data, ...(typeof item?.text === 'string' && item.text ? { text: item.text } : {}) } })
      }
      continue
    }
    if (event.type === 'message.completed' && itemId && deltaByItem.has(itemId)) continue
    output.push(event)
  }
  return output
}

function pendingInteraction(events: ConversationEvent[]): ConversationEvent | null {
  let pending: ConversationEvent | null = null
  for (const event of events) {
    if (event.type === 'approval.requested' || event.type === 'question.requested') pending = event
    if (pending && ((pending.type === 'approval.requested' && event.type === 'approval.resolved') || (pending.type === 'question.requested' && event.type === 'question.resolved'))) pending = null
  }
  return pending
}

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [page, setPageState] = useState<Page>({ kind: 'create' })
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [demandsExpanded, setDemandsExpanded] = useState(true)
  const [sidebarDemands, setSidebarDemands] = useState<Demand[]>([])
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000) }, [])
  const setPage = useCallback((next: Page) => {
    setSwitcherOpen(false)
    setPageState(next)
    const nextPath = pagePath(next)
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
  }, [])
  const loadWorkspaces = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.listWorkspaces(); setWorkspaces(rows)
      const route = parseRoute(window.location.pathname)
      if (route.kind === 'settings') { setPageState({ kind: 'settings' }); return }
      if (route.kind === 'create') { setPageState({ kind: 'create' }); return }
      if (route.kind === 'list' && window.location.pathname.startsWith('/workspaces')) { setPageState({ kind: 'list' }); return }
      const requested = route.kind === 'workspace' ? rows.find(row => row.id === route.workspaceId) : undefined
      const active = requested ?? rows.find(row => row.active) ?? rows[0]
      if (active) {
        const opened = await api.openWorkspace(active.id)
        const target = requested && route.kind === 'workspace' ? { tab: route.tab, ...(route.demandId ? { demandId: route.demandId } : {}) } : { tab: 'dashboard' as const }
        setPageState({ kind: 'workspace', workspace: opened.workspace, summary: opened.summary, ...target })
        if (!requested || route.kind !== 'workspace') window.history.replaceState({}, '', pagePath({ kind: 'workspace', workspace: opened.workspace, summary: opened.summary, tab: 'dashboard' }))
      } else setPageState(window.location.pathname.startsWith('/workspaces') ? { kind: 'list' } : { kind: 'create' })
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); setPageState({ kind: 'create' }) } finally { setLoading(false) }
  }, [showToast])
  useEffect(() => { void loadWorkspaces() }, [loadWorkspaces])
  useEffect(() => {
    const onPopState = () => { void loadWorkspaces() }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [loadWorkspaces])
  const activeWorkspaceId = page.kind === 'workspace' ? page.workspace.id : ''
  const activeWorkspaceRoute = page.kind === 'workspace' ? `${page.tab}:${page.demandId ?? ''}` : ''
  useEffect(() => {
    if (!activeWorkspaceId) { setSidebarDemands([]); return }
    let cancelled = false
    void api.listDemands(activeWorkspaceId).then((rows) => { if (!cancelled) setSidebarDemands(rows) }).catch(() => { if (!cancelled) setSidebarDemands([]) })
    return () => { cancelled = true }
  }, [activeWorkspaceId, activeWorkspaceRoute])
  const openWorkspace = async (workspace: Workspace) => {
    try { const opened = await api.openWorkspace(workspace.id); setPage({ kind: 'workspace', workspace: opened.workspace, summary: opened.summary, tab: 'dashboard' }); setWorkspaces(current => current.map(row => ({ ...row, active: row.id === workspace.id }))); setSwitcherOpen(false) }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)) }
  }
  const createWorkspace = async (source: WorkspaceSource, name?: string) => {
    try { const result = await api.createWorkspace(source, name); setWorkspaces(await api.listWorkspaces()); setPage({ kind: 'workspace', workspace: result.workspace, summary: result.summary, tab: 'dashboard' }); showToast(result.action === 'adopted' ? '检查通过，已直接复用 Workspace' : result.initialization.status === 'initialized' ? 'Codex 已完成 Workspace 初始化' : result.initialization.message) }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); throw error }
  }
  const deleteWorkspace = async (workspace: Workspace) => {
    if (!window.confirm(`只移除 Workspace 注册，不删除文件夹：\n${workspace.path}`)) return
    try { await api.deleteWorkspace(workspace.id); await loadWorkspaces(); showToast('Workspace 已从列表移除，文件夹未删除') } catch (error) { showToast(error instanceof Error ? error.message : String(error)) }
  }
  if (loading) return <div className="page-loading">正在读取 Workspace…</div>
  const current = page.kind === 'workspace' ? page.workspace : workspaces.find(row => row.active)
  const setTab = (tab: WorkspacePage, demandId?: string) => { setSwitcherOpen(false); if (page.kind === 'workspace') setPage(demandId === undefined ? { ...page, tab } : { ...page, tab, demandId }) }
  const inWorkspace = current && page.kind === 'workspace'
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">CW</span>
        <span><strong>CodyWork</strong><small>Agentic Development</small></span>
      </div>
      {current && <WorkspaceSwitcher current={current} workspaces={workspaces} open={switcherOpen} onToggle={() => setSwitcherOpen(value => !value)} onOpen={openWorkspace} onList={() => { setPage({ kind: 'list' }); setSwitcherOpen(false) }} onCreate={() => { setPage({ kind: 'create' }); setSwitcherOpen(false) }} />}
      {inWorkspace ? <nav className="workspace-nav" aria-label={`${current.name} Workspace 导航`}>
        <div className="sidebar-section-label"><span>WORKSPACE</span><small>工作区内容</small></div>
        <button className={`sidebar-item ${page.tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}><span className="sidebar-icon"><Icon name="dashboard" /></span><span className="sidebar-label"><strong>概览</strong><small>健康度与工作进展</small></span></button>
        <button className={`sidebar-item sidebar-accordion-trigger ${page.tab === 'demands' || page.tab === 'demand' ? 'active' : ''} ${demandsExpanded ? 'expanded' : ''}`} onClick={() => { setSwitcherOpen(false); if (page.tab === 'demands') setDemandsExpanded(value => !value); else { setTab('demands'); setDemandsExpanded(true) } }} aria-expanded={demandsExpanded} aria-controls="workspace-demand-navigation"><span className="sidebar-icon"><Icon name="grid" /></span><span className="sidebar-label"><strong>需求</strong><small>Worktree 与开发会话</small></span><em>{sidebarDemands.length}</em><span className="sidebar-accordion-chevron"><Icon name="chevron" size={14} /></span></button>
        {demandsExpanded && <div className="sidebar-subnav" id="workspace-demand-navigation">
          {sidebarDemands.length === 0 ? <button className="sidebar-subnav-empty" onClick={() => setTab('demands')}>暂无需求，点击创建</button> : sidebarDemands.map(demand => <button key={demand.id} className={`sidebar-subnav-item ${page.tab === 'demand' && page.demandId === demand.id ? 'active' : ''}`} onClick={() => setTab('demand', demand.id)} title={demand.name}><span className={`subnav-status ${demand.status}`} /><span><strong>{demand.name}</strong><small>{demand.branchName}</small></span></button>)}
        </div>}
        <button className={`sidebar-item ${page.tab === 'knowledge' ? 'active' : ''}`} onClick={() => setTab('knowledge')}><span className="sidebar-icon"><Icon name="document" /></span><span className="sidebar-label"><strong>知识库</strong><small>规范与需求沉淀</small></span></button>
        <button className={`sidebar-item ${page.tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}><span className="sidebar-icon"><Icon name="sparkles" /></span><span className="sidebar-label"><strong>Skills</strong><small>Agent 可用能力</small></span></button>
      </nav> : <nav className="workspace-nav" aria-label="Workspace 管理">
        <div className="sidebar-section-label"><span>WORKSPACES</span><small>选择研发上下文</small></div>
        {current && <button className="sidebar-item" onClick={() => void openWorkspace(current)}><span className="sidebar-icon"><Icon name="dashboard" /></span><span className="sidebar-label"><strong>返回当前 Workspace</strong><small>{current.name}</small></span></button>}
        <button className={`sidebar-item ${page.kind === 'create' ? 'active' : ''}`} onClick={() => setPage({ kind: 'create' })}><span className="sidebar-icon"><Icon name="plus" /></span><span className="sidebar-label"><strong>创建 Workspace</strong><small>本地目录或 Git 仓库</small></span></button>
      </nav>}
      <div className="sidebar-spacer" />
      <div className="sidebar-section-label settings-section-label"><span>GLOBAL</span><small>全局配置</small></div>
      <button className={`sidebar-item ${page.kind === 'settings' ? 'active' : ''}`} onClick={() => setPage({ kind: 'settings' })}><span className="sidebar-icon"><Icon name="gear" /></span><span className="sidebar-label"><strong>Codex Runtime</strong><small>App Server 与执行策略</small></span></button>
      <div className="sidebar-note"><span className="status-dot" /><span><strong>Codex ready</strong><small>CSR policy enforced</small></span></div>
    </aside>
    <main className="main" id="main-content">{page.kind === 'create' ? <CreateWorkspace onCreate={createWorkspace} onCancel={() => current ? void openWorkspace(current) : setPage({ kind: 'list' })} hasExisting={workspaces.length > 0} /> : page.kind === 'list' ? <WorkspaceListPage workspaces={workspaces} onOpen={openWorkspace} onCreate={() => setPage({ kind: 'create' })} onDelete={deleteWorkspace} /> : page.kind === 'settings' ? <RuntimeSettingsPage showToast={showToast} /> : page.tab === 'dashboard' ? <DashboardPage workspace={page.workspace} /> : page.tab === 'knowledge' ? <KnowledgePage workspace={page.workspace} /> : page.tab === 'skills' ? <SkillsPage workspace={page.workspace} /> : page.tab === 'demands' ? <DemandsPage workspace={page.workspace} onOpen={id => setTab('demand', id)} onCreated={id => setTab('demand', id)} showToast={showToast} /> : page.demandId ? <DemandShell workspace={page.workspace} demandId={page.demandId} onBack={() => setTab('demands')} showToast={showToast} /> : <DemandsPage workspace={page.workspace} onOpen={id => setTab('demand', id)} onCreated={id => setTab('demand', id)} showToast={showToast} />}</main>
    <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>
}

function WorkspaceSwitcher({ current, workspaces, open, onToggle, onOpen, onList, onCreate }: { current: Workspace; workspaces: Workspace[]; open: boolean; onToggle: () => void; onOpen: (workspace: Workspace) => Promise<void>; onList: () => void; onCreate: () => void }) {
  return <div className="switcher-wrap">
    <div className="current-context-label">当前 Workspace</div>
    <button className="switcher" onClick={onToggle} aria-expanded={open} aria-haspopup="menu">
      <span className="folder-mark">{current.name.slice(0, 1).toUpperCase()}</span>
      <span className="switcher-copy"><strong>{current.name}</strong><small>{current.path}</small></span>
      <span className={`switcher-chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={16} /></span>
    </button>
    {open && <div className="switcher-menu" role="menu">
      <div className="switcher-menu-label">切换 Workspace</div>
      {workspaces.map(workspace => <button key={workspace.id} role="menuitem" className={workspace.id === current.id ? 'selected' : ''} onClick={() => void onOpen(workspace)}><span className="folder-mark small">{workspace.name.slice(0, 1).toUpperCase()}</span><span><strong>{workspace.name}</strong><small>{workspace.path}</small></span>{workspace.id === current.id && <span className="menu-check">当前</span>}</button>)}
      <button className="menu-all" onClick={onList}><Icon name="workspace" size={16} /> 查看全部 Workspace</button>
      <button className="menu-create" onClick={onCreate}><Icon name="plus" size={16} /> 创建 Workspace</button>
    </div>}
  </div>
}

function CreateWorkspace({ onCreate, onCancel, hasExisting }: { onCreate: (source: WorkspaceSource, name?: string) => Promise<void>; onCancel: () => void; hasExisting: boolean }) {
  const [mode, setMode] = useState<'folder' | 'git'>('folder'); const [path, setPath] = useState(''); const [url, setUrl] = useState(''); const [destination, setDestination] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async () => { setBusy(true); try { await onCreate(mode === 'folder' ? { type: 'folder', path } : { type: 'git', url, destination }, name.trim() || undefined) } finally { setBusy(false) } }
  return <div className="create-page"><div className="create-hero"><div className="eyebrow">CODYWORK</div><h1>{hasExisting ? '创建另一个 Workspace' : '创建你的第一个 Workspace'}</h1><p>Workspace 就是真实文件夹。初始化完成后，系统会自动进入该目录，把后续任务交给 Codex 执行。</p></div><section className="create-card"><div className="mode-tabs" role="tablist" aria-label="Workspace 来源"><button className={mode === 'folder' ? 'active' : ''} onClick={() => setMode('folder')}>选择本地文件夹</button><button className={mode === 'git' ? 'active' : ''} onClick={() => setMode('git')}>从 Git clone</button></div>{mode === 'folder' ? <><label htmlFor="folder-path">文件夹路径</label><input id="folder-path" autoFocus className="input" value={path} onChange={event => setPath(event.target.value)} placeholder="/Users/you/projects/life-csr" /><p className="field-help">已有完整 Workspace 会只检查并直接复用；空文件夹会交给 Codex 初始化。非空但不完整的目录不会被覆盖。</p></> : <><label htmlFor="git-url">Git 地址</label><input id="git-url" autoFocus className="input" value={url} onChange={event => setUrl(event.target.value)} placeholder="git@code.byted.org:life_service/basic_marketing_ai_hub.git" /><label htmlFor="clone-destination">Clone 目标路径</label><input id="clone-destination" className="input" value={destination} onChange={event => setDestination(event.target.value)} placeholder="/Users/you/projects/basic_marketing_ai_hub" /><p className="field-help">目标路径必须不存在或是空文件夹。Clone 完成后会自动注册并进入 Workspace。</p></>}<label htmlFor="workspace-name">显示名称 <span className="optional">可选</span></label><input id="workspace-name" className="input" value={name} onChange={event => setName(event.target.value)} placeholder="默认使用文件夹名称" /><div className="create-actions"><button className="btn" disabled={busy} onClick={onCancel}>取消</button><button className="btn primary" disabled={busy || (mode === 'folder' ? !path.trim() : !url.trim() || !destination.trim())} onClick={() => void submit()}>{busy ? '正在检查…' : mode === 'folder' ? '检查并进入 Workspace' : 'Clone、检查并进入 Workspace'}</button></div></section><div className="create-footnote">Codex 负责 Workspace 初始化与研发任务；CodyWork 负责上下文、需求和权限边界。</div></div>
}

function WorkspaceListPage({ workspaces, onOpen, onCreate, onDelete }: { workspaces: Workspace[]; onOpen: (workspace: Workspace) => Promise<void>; onCreate: () => void; onDelete: (workspace: Workspace) => Promise<void> }) {
  return <div className="workspace-list-page"><header className="topbar"><div><div className="eyebrow">WORKSPACES</div><h1>所有 Workspace</h1></div><button className="btn primary" onClick={onCreate}>＋ 新建 Workspace</button></header><div className="workspace-list-body"><p className="list-intro">Workspace 只是本机上的真实文件夹。选择一个进入，或移除注册（不会删除文件夹）。</p>{workspaces.length === 0 ? <section className="empty-list"><strong>还没有 Workspace</strong><span>创建一个本地文件夹或从 Git clone 开始。</span><button className="btn primary" onClick={onCreate}>创建第一个 Workspace</button></section> : <section className="workspace-list-card">{workspaces.map(workspace => <div className="workspace-list-row" key={workspace.id}><div className="workspace-large-mark small-mark">{workspace.name.slice(0, 1).toUpperCase()}</div><div className="workspace-list-copy"><strong>{workspace.name}</strong><code>{workspace.path}</code><small>最近打开：{new Date(workspace.lastOpenedAt).toLocaleString()}</small></div>{workspace.active && <span className="status-pill">当前</span>}<div className="workspace-list-actions"><button className="btn primary" onClick={() => void onOpen(workspace)}>进入</button><button className="btn danger" onClick={() => void onDelete(workspace)}>移除注册</button></div></div>)}</section>}</div></div>
}

function DashboardPage({ workspace }: { workspace: Workspace }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [repoModal, setRepoModal] = useState(false); const [repoMessage, setRepoMessage] = useState('')
  const load = useCallback(async (refresh = false) => { setBusy(true); try { const data = refresh ? await api.refreshDashboard(workspace.id) : await api.dashboard(workspace.id); setSnapshot(data); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }, [workspace.id])
  useEffect(() => { void load() }, [load])
  const card = (icon: IconName, title: string, value: string | number, detail: string, tone = '') => <div className={`metric-card ${tone}`}><div className="metric-card-head"><span className="metric-icon"><Icon name={icon} size={17} /></span><span className="metric-title">{title}</span></div><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span></div>
  return <div className="dashboard-page">
    <header className="topbar"><div><div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={12} /><strong>概览</strong></div><h1>{workspace.name}</h1><p className="topbar-subtitle">研发上下文、代码健康度与 Agent 能力一览</p></div><div className="topbar-actions"><button className="btn" onClick={() => setRepoModal(true)}><Icon name="plus" size={16} />添加 Repo</button><button className="btn" disabled={busy} onClick={() => void load(true)}><Icon name="refresh" size={16} />{busy ? '刷新中…' : '刷新数据'}</button></div></header>
    <div className="dashboard-body">{error && <div className="error-banner">Dashboard 读取失败：{error}</div>}{repoMessage && <div className="success-banner">{repoMessage}</div>}{snapshot && <>
      <section className="dashboard-welcome"><div><span className="workspace-live"><i />Workspace ready</span><h2>今天从哪里开始？</h2><p>所有变更都会被限制在需求 Worktree 中，Workspace 基线保持只读。</p></div><div className="dashboard-path"><span>ROOT</span><code>{workspace.path}</code></div></section>
      <div className="metric-grid">{card('grid', '需求', snapshot.demands.total, `进行中 ${snapshot.demands.inProgress} · 已完成 ${snapshot.demands.completed} · 阻塞 ${snapshot.demands.blocked}`)}{card('repository', 'Repositories', snapshot.repositories.total, `正常 ${snapshot.repositories.normal} · 未提交 ${snapshot.repositories.dirty} · 拉取失败 ${snapshot.repositories.pullFailed}`)}{card('code', '代码变更', `${snapshot.codeChanges.additions} / ${snapshot.codeChanges.deletions}`, `新增 / 删除行 · 修改文件 ${snapshot.codeChanges.filesChanged}`)}{card('document', '知识文档', snapshot.knowledge.documents, snapshot.knowledge.lastUpdatedAt ? `最近更新 ${new Date(snapshot.knowledge.lastUpdatedAt).toLocaleString()}` : '暂无文档')}{card('sparkles', 'Agent Skills', snapshot.skills.available, `可用 · 禁用 ${snapshot.skills.disabled} · 加载失败 ${snapshot.skills.loadFailed}`)}</div>
      <section className="dashboard-note"><span className="dashboard-note-icon"><Icon name="branch" size={20} /></span><div><div className="card-kicker">CSR WORKSPACE</div><h2>需求隔离已启用</h2><p>基础 services 保持只读；需求代码写入 <code>worktrees/&lt;需求&gt;/services</code>，需求文档写入对应的 <code>docs</code>。</p></div><span className="dashboard-refresh">更新于 {new Date(snapshot.generatedAt).toLocaleString()}</span></section>
    </>}{repoModal && <AddRepositoryModal workspace={workspace} onClose={() => setRepoModal(false)} onSuccess={async (repository) => { setRepoModal(false); setRepoMessage(`${repository.name} 已添加到 Workspace services`); await load(true) }} />}</div>
  </div>
}

function RuntimeSettingsPage({ showToast }: { showToast: (message: string) => void }) {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null)
  const [codexUrl, setCodexUrl] = useState(''); const [codexCommand, setCodexCommand] = useState(''); const [busy, setBusy] = useState(false); const [testing, setTesting] = useState(false); const [error, setError] = useState('')
  useEffect(() => { void api.runtimeSettings().then((value) => { setSettings(value); setCodexUrl(value.codex.url); setCodexCommand(value.codex.command) }).catch(err => setError(err instanceof Error ? err.message : String(err))) }, [])
  const save = async () => { setBusy(true); setError(''); try { const value = await api.updateRuntimeSettings({ codex: { url: codexUrl, command: codexCommand } }); setSettings(value); showToast('Codex Runtime 配置已保存') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }
  const test = async () => { setTesting(true); setError(''); try { const manifest = await api.testRuntime(); showToast(`连接成功：Codex · ${manifest.runtimeVersion}`) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setTesting(false) } }
  return <div className="runtime-settings-page"><header className="topbar"><div><div className="eyebrow">GLOBAL SETTINGS / CODEX RUNTIME</div><h1>Codex Runtime</h1></div><div className="topbar-actions"><button className="btn" disabled={testing || !settings} onClick={() => void test()}>{testing ? '测试中…' : '测试连接'}</button><button className="btn primary" disabled={busy || !settings} onClick={() => void save()}>{busy ? '保存中…' : '保存设置'}</button></div></header><div className="runtime-settings-body"><section className="settings-intro"><div><div className="card-kicker">CODYWORK RUNTIME</div><h2>所有 Workspace 统一使用 Codex</h2><p>CodyWork 负责 Workspace、需求和 CSR 权限边界；Codex App Server 负责真实的 Agent 执行与会话恢复。</p></div><span className="runtime-status ready"><i />Codex 已启用</span></section>{error && <div className="error-banner">Codex Runtime 设置失败：{error}</div>}<section className="settings-card"><div className="settings-card-head"><div><div className="card-kicker">CODEX CONNECTION</div><h3>Codex App Server</h3></div><span className="settings-note">全局生效</span></div><label htmlFor="codex-url">App Server URL <span className="optional">预留</span></label><input id="codex-url" className="input" value={codexUrl} onChange={event => setCodexUrl(event.target.value)} placeholder="当前使用本机 stdio，无需填写" /><label htmlFor="codex-command">启动命令 <span className="optional">可选</span></label><input id="codex-command" className="input" value={codexCommand} onChange={event => setCodexCommand(event.target.value)} placeholder="codex app-server --stdio" /><p className="field-help">默认启动本机 <code>codex app-server --stdio</code> 并复用 Codex 登录状态；自定义安装路径时可覆盖启动命令，无需在 CodyWork 中保存 API Key。</p></section><section className="settings-security"><div className="security-mark">CSR</div><div><strong>权限边界仍由 CodyWork 管理</strong><p>Runtime 配置不会扩大可读写目录。只读、Workspace 写入和 Yolo 都受当前需求 Worktree 范围约束，Workspace 外路径始终拒绝。</p></div></section></div></div>
}

function AddRepositoryModal({ workspace, onClose, onSuccess }: { workspace: Workspace; onClose: () => void; onSuccess: (repository: Repository) => Promise<void> }) {
  const [mode, setMode] = useState<'folder' | 'git'>('folder'); const [path, setPath] = useState(''); const [url, setUrl] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async () => { setBusy(true); setError(''); try { const label = name.trim(); const input = mode === 'folder' ? { source: 'folder' as const, path, ...(label ? { name: label } : {}) } : { source: 'git' as const, url, ...(label ? { name: label } : {}) }; await onSuccess(await api.addRepository(workspace.id, input)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }
  const ready = mode === 'folder' ? path.trim() : url.trim()
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-repository-title"><div className="modal-head"><div><div className="eyebrow">ADD REPOSITORY</div><h2 id="add-repository-title">添加 Repo</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭">×</button></div><p className="field-help">Repo 会进入 Workspace 的 <code>services/</code> 下，完成后立即可用于新需求，也可以挂到已有需求。</p><div className="mode-tabs" role="tablist" aria-label="Repo 来源"><button className={mode === 'folder' ? 'active' : ''} onClick={() => setMode('folder')}>选择本地目录</button><button className={mode === 'git' ? 'active' : ''} onClick={() => setMode('git')}>从 Git clone</button></div>{mode === 'folder' ? <><label htmlFor="repository-path">本地目录路径</label><input id="repository-path" autoFocus className="input" value={path} onChange={event => setPath(event.target.value)} placeholder="/Users/you/projects/service" /></> : <><label htmlFor="repository-url">Git 地址</label><input id="repository-url" autoFocus className="input" value={url} onChange={event => setUrl(event.target.value)} placeholder="git@github.com:org/repo.git" /></>}<label htmlFor="repository-name">Repo 目录名 <span className="optional">可选</span></label><input id="repository-name" className="input" value={name} onChange={event => setName(event.target.value)} placeholder="默认使用源目录名" />{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>取消</button><button className="btn primary" disabled={busy || !ready} onClick={() => void submit()}>{busy ? mode === 'folder' ? '正在登记…' : '正在 Clone…' : mode === 'folder' ? '登记并添加' : 'Clone 并添加'}</button></div></section></div>
}

function KnowledgePage({ workspace }: { workspace: Workspace }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.listKnowledge(workspace.id)
      setDocuments(rows)
      if (rows.length) setSelected(current => rows.some(document => document.id === current?.id) ? current : rows[0] ?? null)
      else setSelected(null)
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setLoading(false) }
  }, [workspace.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!selected || selected.content !== undefined) return
    let cancelled = false
    void api.getKnowledge(workspace.id, selected.id).then((document) => { if (!cancelled) setSelected(document) }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [workspace.id, selected])
  const filtered = documents.filter(document => !query.trim() || `${document.relativePath} ${document.name}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="knowledge-page"><header className="topbar"><div><div className="eyebrow">WORKSPACE / KNOWLEDGE</div><h1>知识库</h1><p className="topbar-subtitle">浏览 Workspace <code>docs/</code> 中的知识文档与需求沉淀。</p></div><button className="btn" onClick={() => void load()} disabled={loading}>{loading ? '读取中…' : '刷新'}</button></header><div className="knowledge-body">{error && <div className="error-banner">知识库读取失败：{error}</div>}{loading ? <div className="inline-loading">正在读取知识文档…</div> : <div className="knowledge-layout"><section className="knowledge-list-card"><div className="knowledge-list-head"><strong>全部文档</strong><span>{documents.length} 个</span></div><div className="knowledge-search"><input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文档名称或路径" /></div>{filtered.length === 0 ? <div className="knowledge-empty">{documents.length ? '没有匹配的文档。' : 'docs/ 目录中还没有知识文档。'}</div> : filtered.map(document => <button key={document.id} className={`knowledge-row ${document.id === selected?.id ? 'active' : ''}`} onClick={() => { const { content: _content, ...metadata } = document; setSelected(metadata) }}><span className="knowledge-file-icon">{document.extension === 'md' || document.extension === 'mdx' ? 'M' : '·'}</span><span className="knowledge-row-copy"><strong>{document.name}</strong><small>{document.relativePath} · {formatBytes(document.size)}</small></span></button>)}</section><section className="knowledge-detail-card">{selected ? <><div className="knowledge-detail-head"><div><div className="eyebrow">KNOWLEDGE DOCUMENT</div><h2>{selected.name}</h2><p>{selected.relativePath}</p></div><span className="knowledge-extension">.{selected.extension}</span></div><div className="knowledge-meta">{formatBytes(selected.size)} · 更新于 {new Date(selected.updatedAt).toLocaleString()}</div>{selected.content === undefined ? <div className="inline-loading">正在读取文档…</div> : <pre className="knowledge-content">{selected.content || '文档为空。'}</pre>}</> : <div className="knowledge-detail-empty">选择左侧文档查看内容。</div>}</section></div>}</div></div>
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function SkillsPage({ workspace }: { workspace: Workspace }) {
  const [skills, setSkills] = useState<WorkspaceSkill[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [installRun, setInstallRun] = useState<{ source: string; provider?: string; phase: 'running' | 'completed' | 'failed'; message?: string; events: SkillInstallEvent[] }>({ source: '', phase: 'running', events: [] })
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.listSkills(workspace.id)
      setSkills(rows)
      setSelectedId(current => rows.some(skill => skill.id === current) ? current : rows[0]?.id ?? '')
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setLoading(false) }
  }, [workspace.id])
  useEffect(() => { void load() }, [load])
  const selected = skills.find(skill => skill.id === selectedId) ?? skills[0] ?? null
  const install = async () => {
    const value = source.trim()
    if (!value) return
    setBusy(true); setError(''); setInstallRun({ source: value, phase: 'running', events: [] })
    try {
      const started = await api.installSkill(workspace.id, value)
      setSource('')
      for (;;) {
        await new Promise(resolve => window.setTimeout(resolve, 900))
        const result = await api.skillInstallStatus(workspace.id, started.jobId)
        setInstallRun(current => ({ ...current, ...(result.provider ? { provider: result.provider } : {}), events: result.events, ...(result.message ? { message: result.message } : {}) }))
        if (result.status === 'completed' || result.status === 'failed') {
          await load()
          setInstallRun(current => ({ ...current, ...(result.provider ? { provider: result.provider } : {}), phase: result.status, ...(result.message ? { message: result.message } : {}), events: result.events }))
          break
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setInstallRun(current => ({ ...current, phase: 'failed', message, events: current.events }))
    } finally { setBusy(false) }
  }
  const statusLabel = (status: WorkspaceSkill['status']) => status === 'available' ? '可用' : status === 'disabled' ? '已禁用' : '加载失败'
  const eventLabel = (event: SkillInstallEvent) => {
    const labels: Record<string, string> = { 'conversation.created': 'Agent 会话已创建', 'turn.started': 'Agent 开始执行任务', 'reasoning.delta': 'Agent 正在分析', 'tool.started': '工具调用中', 'tool.completed': '工具调用完成', 'item.started': '执行项开始', 'item.completed': '执行项完成', 'message.delta': 'Agent 回复生成中', 'turn.completed': 'Agent 执行完成', 'turn.failed': 'Agent 执行失败', 'runtime.disconnected': 'Runtime 已断开' }
    return labels[event.type] ?? event.type
  }
  const eventDetail = (event: SkillInstallEvent) => {
    const data = event.data
    if (typeof data.name === 'string') return data.name
    if (typeof data.text === 'string' && data.text.trim()) return data.text.trim().slice(0, 160)
    if (typeof data.status === 'string') return data.status
    return ''
  }
  return <div className="skills-page"><header className="topbar"><div><div className="eyebrow">WORKSPACE / SKILLS</div><h1>Skills</h1><p className="topbar-subtitle">查看当前 Workspace 与用户目录中 Codex 可以识别的 Skill。</p></div><button className="btn primary" onClick={() => document.getElementById('skill-source')?.focus()}>＋ 添加 Skill</button></header><div className="skills-body"><section className="skill-install-card"><div><div className="card-kicker">CODEX INSTALL</div><h2>让 Codex 添加 Skill</h2><p>输入 Skill 的安装命令、Git 地址或文档链接。安装由 Codex 执行，只允许写入 Workspace 的 <code>.agents/skills</code>。</p></div><div className="skill-install-form"><input id="skill-source" className="input" value={source} onChange={event => setSource(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void install() }} placeholder="例如：git@github.com:org/skill.git 或 Skill 链接" /><button className="btn primary" disabled={busy || !source.trim()} onClick={() => void install()}>{busy ? 'Codex 安装中…' : '交给 Codex 添加'}</button></div></section>{error && <div className="error-banner">Skills 操作失败：{error}</div>}{loading ? <div className="inline-loading">正在读取 Codex Skills…</div> : <div className="skills-layout"><section className="skills-list-card"><div className="skills-list-head"><strong>可识别 Skills</strong><span>{skills.length} 个</span></div>{skills.length === 0 ? <div className="skills-empty">当前 Workspace 还没有识别到 Skill。</div> : skills.map(skill => <button key={skill.id} className={`skill-row ${skill.id === selected?.id ? 'active' : ''}`} onClick={() => setSelectedId(skill.id)}><span className={`skill-status-pill ${skill.status}`}>{statusLabel(skill.status)}</span><span className="skill-row-copy"><strong>{skill.name}</strong><small>{skill.description || '没有描述'}</small></span><span className="skill-source-label">{skill.source === 'workspace' ? 'Workspace' : 'User'}</span></button>)}</section><section className="skill-detail-card">{selected ? <><div className="skill-detail-head"><div><div className="eyebrow">{selected.source === 'workspace' ? 'WORKSPACE SKILL' : 'USER SKILL'}</div><h2>{selected.name}</h2><p>{selected.description || '没有描述'}</p></div><span className={`skill-status-pill ${selected.status}`}>{statusLabel(selected.status)}</span></div><div className="skill-meta"><span>路径 <code>{selected.path}</code></span><span>{selected.modelInvocable ? 'Codex 可调用' : '不会自动调用'}</span><span>更新于 {new Date(selected.updatedAt).toLocaleString()}</span></div><pre className="skill-content">{selected.content || '暂无可展示内容'}</pre></> : <div className="skill-detail-empty">选择左侧 Skill 查看完整内容。</div>}</section></div>}{installRun.source && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setInstallRun(current => ({ ...current, source: '' })) }}><section className="modal-card skill-progress-modal" role="dialog" aria-modal="true" aria-labelledby="skill-progress-title"><div className="modal-head"><div><div className="eyebrow">CODEX RUN</div><h2 id="skill-progress-title">{installRun.phase === 'running' ? 'Codex 正在添加 Skill' : installRun.phase === 'completed' ? 'Skill 添加完成' : 'Skill 添加失败'}</h2></div><button className="icon-button" disabled={busy} onClick={() => setInstallRun(current => ({ ...current, source: '' }))} aria-label="关闭">×</button></div><div className="skill-progress-source">{installRun.source}</div>{installRun.phase === 'running' && <div className="skill-live-status"><span className="spinner" /> Codex 正在执行，请稍候…</div>}{installRun.events.length > 0 && <div className="skill-event-list">{installRun.events.map((event, index) => <div className={`skill-event ${event.type.includes('failed') ? 'failed' : event.type.includes('completed') ? 'completed' : ''}`} key={`${event.timestamp}-${index}`}><span className="skill-event-dot" /><span><strong>{eventLabel(event)}</strong>{eventDetail(event) && <small>{eventDetail(event)}</small>}</span></div>)}</div>}{installRun.phase !== 'running' && <div className={`skill-run-result ${installRun.phase}`}>{installRun.message}</div>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={() => setInstallRun(current => ({ ...current, source: '' }))}>{busy ? '等待 Codex…' : '关闭'}</button></div></section></div>}</div></div>
}

function DemandsPage({ workspace, onOpen, onCreated, showToast }: { workspace: Workspace; onOpen: (id: string) => void; onCreated: (id: string) => void; showToast: (message: string) => void }) {
  const [demands, setDemands] = useState<Demand[]>([]); const [repositories, setRepositories] = useState<Repository[]>([]); const [modal, setModal] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [filter, setFilter] = useState<'all' | Demand['status']>('all')
  const load = useCallback(async () => { setLoading(true); try { const [nextDemands, nextRepos] = await Promise.all([api.listDemands(workspace.id), api.listRepositories(workspace.id)]); setDemands(nextDemands); setRepositories(nextRepos); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setLoading(false) } }, [workspace.id])
  useEffect(() => { void load() }, [load])
  const filtered = demands.filter(demand => (filter === 'all' || demand.status === filter) && (!query.trim() || `${demand.name} ${demand.branchName} ${demand.repositories.map(repo => repo.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())))
  const count = (status: Demand['status']) => demands.filter(demand => demand.status === status).length
  return <div className="demands-page">
    <header className="topbar"><div><div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={12} /><strong>需求</strong></div><h1>需求</h1><p className="topbar-subtitle">一个需求对应一组隔离的 Git Worktree 与 Agent 会话</p></div><button className="btn primary" onClick={() => setModal(true)}><Icon name="plus" size={16} />新建需求</button></header>
    <div className="demands-body">{error && <div className="error-banner">需求读取失败：{error}</div>}{loading ? <div className="inline-loading">正在读取需求…</div> : demands.length === 0 ? <section className="empty-list"><span className="empty-icon"><Icon name="branch" size={24} /></span><strong>还没有需求</strong><span>选择 Repo，创建第一个隔离的需求开发空间。</span><button className="btn primary" onClick={() => setModal(true)}><Icon name="plus" size={16} />新建需求</button></section> : <>
      <section className="demand-controls"><div className="demand-filter" role="group" aria-label="需求状态筛选"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 <span>{demands.length}</span></button><button className={filter === 'in_progress' ? 'active' : ''} onClick={() => setFilter('in_progress')}>进行中 <span>{count('in_progress')}</span></button><button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>已完成 <span>{count('completed')}</span></button><button className={filter === 'blocked' ? 'active' : ''} onClick={() => setFilter('blocked')}>阻塞 <span>{count('blocked')}</span></button></div><label className="demand-search"><Icon name="search" size={15} /><span className="sr-only">搜索需求</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索需求、分支或 Repo" /></label></section>
      <section className="demand-list-card"><div className="demand-list-head"><div><strong>{filter === 'all' ? '全部需求' : filter === 'in_progress' ? '进行中的需求' : filter === 'completed' ? '已完成的需求' : '阻塞的需求'}</strong><small>{filtered.length} 个结果</small></div><span>分支 / Repositories</span></div>{filtered.length === 0 ? <div className="demand-empty-result">没有匹配的需求。</div> : filtered.map(demand => <button className="demand-row" key={demand.id} onClick={() => onOpen(demand.id)}><span className={`demand-status ${demand.status}`} /><span className="demand-copy"><strong>{demand.name}</strong><small><Icon name="branch" size={12} />{demand.branchName}<span className="demand-repo-divider" /> <Icon name="repository" size={12} />{demand.repositories.map(repo => repo.name).join('、')}</small></span><span className="demand-repo-count">{demand.repositories.length} Repo</span><span className="demand-state">{demand.status === 'in_progress' ? '进行中' : demand.status === 'completed' ? '已完成' : '阻塞'}</span><span className="demand-arrow"><Icon name="chevron" size={15} /></span></button>)}</section>
    </>}{modal && <CreateDemandModal workspace={workspace} repositories={repositories} onClose={() => setModal(false)} onSuccess={async (id) => { setModal(false); await load(); onCreated(id); showToast('需求创建成功，Worktree 已准备好') }} />}</div>
  </div>
}

function CreateDemandModal({ workspace, repositories, onClose, onSuccess }: { workspace: Workspace; repositories: Repository[]; onClose: () => void; onSuccess: (id: string) => Promise<void> }) {
  const [name, setName] = useState(''); const [branchName, setBranchName] = useState(''); const [selected, setSelected] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const submit = async () => { setBusy(true); setError(''); try { const result = await api.createDemand(workspace.id, { name, ...(branchName.trim() ? { branchName: branchName.trim() } : {}), repositoryIds: selected }); await onSuccess(result.demand.id) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }
  const preview = branchName.trim() || name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'demand'
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-demand-title"><div className="modal-head"><div><div className="eyebrow">NEW DEMAND</div><h2 id="create-demand-title">创建需求</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div><label htmlFor="demand-name">需求名</label><input id="demand-name" autoFocus className="input" value={name} onChange={event => setName(event.target.value)} placeholder="例如：优惠规则优化" /><label htmlFor="demand-branch">需求代码分支名 <span className="optional">可选</span></label><input id="demand-branch" className="input" value={branchName} onChange={event => setBranchName(event.target.value)} placeholder="不填则按需求名生成" /><div className="branch-preview">Worktree 目录：<code>worktrees/{preview.replaceAll('/', '__')}</code></div><label>选择开发 Repo</label><div className="repo-picker">{repositories.length === 0 ? <span className="muted">Workspace services 下没有可用 Repo</span> : repositories.map(repo => <label className={`repo-option ${selected.includes(repo.id) ? 'selected' : ''}`} key={repo.id}><input type="checkbox" checked={selected.includes(repo.id)} onChange={() => toggle(repo.id)} /><span><strong>{repo.name}</strong><small>{repo.dirty ? '存在未提交变更' : repo.path}</small></span></label>)}</div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>取消</button><button className="btn primary" disabled={busy || !name.trim() || selected.length === 0} onClick={() => void submit()}>{busy ? '正在创建 Worktree…' : '创建需求并进入'}</button></div></section></div>
}

function DemandShell({ workspace, demandId, onBack, showToast }: { workspace: Workspace; demandId?: string; onBack: () => void; showToast: (message: string) => void }) {
  const [demand, setDemand] = useState<Demand | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [events, setEvents] = useState<ConversationEvent[]>([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [permission, setPermission] = useState<ConversationPermissionMode>('workspace-write')
  const [socketState, setSocketState] = useState<'connecting' | 'open' | 'closed'>('closed')
  const [busy, setBusy] = useState(false)
  const [deliveryMode, setDeliveryMode] = useState<'queue' | 'steer'>('queue')
  const [goalEditorOpen, setGoalEditorOpen] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [attachModal, setAttachModal] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<number | null>(null)
  const lastEventRef = useRef(0)

  const loadDemand = useCallback(async () => {
    if (!demandId) return
    try {
      const [nextDemand, nextConversations] = await Promise.all([api.getDemand(workspace.id, demandId), api.listConversations(workspace.id, demandId)])
      setDemand(nextDemand); setConversations(nextConversations); setError('')
      const first = nextConversations[0]
      if (first) setSelectedId(current => current || first.id)
      else {
        const created = await api.createConversation(workspace.id, demandId)
        setConversations([created]); setSelectedId(created.id)
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [workspace.id, demandId])

  const connect = useCallback((conversationId: string, after: number) => {
    socketRef.current?.close()
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.hostname || '127.0.0.1'
    const socket = new WebSocket(`${protocol}://${host}:3210/api/workspaces/${encodeURIComponent(workspace.id)}/conversations/${encodeURIComponent(conversationId)}/events?after=${after}`)
    socketRef.current = socket; setSocketState('connecting')
    socket.onopen = () => { setSocketState('open'); socket.send(JSON.stringify({ type: 'ping' })) }
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as { type?: string; event?: ConversationEvent }
        if (payload.type !== 'event' || !payload.event) return
        const event = payload.event
        if (event.id <= lastEventRef.current) return
        lastEventRef.current = event.id
        setEvents(current => [...current, event])
        setConversations(current => current.map(item => item.id === conversationId ? {
          ...item,
          status: event.type === 'turn.started' ? 'running' : event.type === 'approval.requested' || event.type === 'question.requested' ? 'awaiting_approval' : event.type === 'turn.failed' ? 'failed' : event.type === 'turn.completed' ? 'completed' : item.status,
          goal: event.type === 'goal.updated' ? event.data as Conversation['goal'] : item.goal,
          plan: event.type === 'plan.updated' ? event.data as Conversation['plan'] : item.plan,
          lastEventId: event.id,
          updatedAt: event.timestamp ?? item.updatedAt,
        } : item))
      } catch { setError('收到无法识别的 Runtime 事件') }
    }
    socket.onerror = () => setSocketState('closed')
    socket.onclose = () => {
      if (socketRef.current !== socket) return
      setSocketState('closed')
      reconnectRef.current = window.setTimeout(() => connect(conversationId, lastEventRef.current), 1000)
    }
  }, [workspace.id])

  const openConversation = useCallback(async (conversationId: string) => {
    setSelectedId(conversationId); setEvents([]); lastEventRef.current = 0; setError('')
    try {
      const history = await api.conversationHistory(workspace.id, conversationId)
      const last = history.events.at(-1)?.id ?? 0
      lastEventRef.current = last; setEvents(history.events)
      const selected = conversations.find(item => item.id === conversationId)
      setPermission(selected?.permissionMode ?? 'workspace-write')
      connect(conversationId, last)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [workspace.id, conversations, connect])

  useEffect(() => { void loadDemand() }, [loadDemand])
  useEffect(() => { if (selectedId) void openConversation(selectedId) }, [selectedId])
  useEffect(() => () => { if (reconnectRef.current !== null) window.clearTimeout(reconnectRef.current); socketRef.current?.close() }, [])
  const selected = conversations.find(item => item.id === selectedId)
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 180
    if (nearBottom || selected?.status === 'running') node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [events.length, selected?.status])

  const newConversation = async () => {
    if (!demandId) return
    try { const created = await api.createConversation(workspace.id, demandId); setConversations(current => [created, ...current]); setSelectedId(created.id) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const send = async (requestedMode?: 'queue' | 'steer') => {
    if (!selectedId || !draft.trim() || busy) return
    const content = draft.trim(); const mode = selected?.status === 'running' ? (requestedMode ?? deliveryMode) : 'queue'; setDraft(''); setBusy(true)
    try { await api.sendMessage(workspace.id, selectedId, content, mode) } catch (err) { setError(err instanceof Error ? err.message : String(err)); setDraft(content) } finally { setBusy(false) }
  }
  const choosePermission = async (mode: ConversationPermissionMode) => {
    if (!selectedId) return
    try { const updated = await api.setConversationPermission(workspace.id, selectedId, mode); setPermission(updated.permissionMode); setConversations(current => current.map(item => item.id === updated.id ? updated : item)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const stop = async () => { if (!selectedId) return; try { await api.interruptConversation(workspace.id, selectedId) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }
  const approve = async (event: ConversationEvent, outcome: 'allowed-once' | 'rejected') => { const approvalId = String(event.data.approvalId ?? event.data.id ?? ''); if (!approvalId || !selectedId) return; try { await api.resolveApproval(workspace.id, selectedId, approvalId, outcome) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }
  const answerQuestion = async (event: ConversationEvent, answer: unknown) => { const requestId = String(event.data.requestId ?? event.data.questionRpcId ?? ''); if (!requestId || !selectedId) return; try { await api.answerQuestion(workspace.id, selectedId, requestId, answer) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }
  const setGoal = async (command?: string) => { if (!selectedId) return; const value = (command ?? goalDraft).trim(); try { await api.sendMessage(workspace.id, selectedId, value ? `/goal ${value}` : '/goal clear'); setGoalDraft(''); if (command) setGoalEditorOpen(false) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }
  const togglePlan = async () => { if (!selectedId) return; try { await api.sendMessage(workspace.id, selectedId, '/plan') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }
  const renameConversation = async (conversation: Conversation) => { const title = window.prompt('重命名会话', conversation.title); if (!title?.trim()) return; try { const updated = await api.renameConversation(workspace.id, conversation.id, title.trim()); setConversations(current => current.map(item => item.id === updated.id ? updated : item)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }
  const pending = pendingInteraction(events)
  const running = selected?.status === 'running'
  const renderEvent = (event: ConversationEvent) => {
    const text = typeof event.data.text === 'string' ? event.data.text : ''
    const agentLabel = 'Codex Agent'
    if (event.type === 'message.user') return <div className="chat-bubble user" key={event.id}><div className="chat-label">你</div>{text}</div>
    if (event.type === 'message.delta' || event.type === 'message.completed') return <div className="chat-bubble assistant" key={event.id}><div className="chat-label">{agentLabel}</div>{text || '（空响应）'}</div>
    if (event.type === 'approval.requested' || event.type === 'question.requested') return null
    if (event.type === 'reasoning.delta') {
      const reasoningText = String(event.data.text ?? event.data.delta ?? '')
      if (!reasoningText.trim()) return null
      return <details className="runtime-card reasoning-card" key={event.id}><summary><span className="runtime-icon"><Icon name="sparkles" size={15} /></span> 推理过程</summary><div className="reasoning-content">{reasoningText}</div></details>
    }
    if (event.type === 'item.completed' && event.data.nativeEvent) return null
    if (event.type === 'item.started' || event.type === 'item.completed') {
      if (!event.data.name && !event.data.tool) return null
      const completed = event.type === 'item.completed'
      return <details className="runtime-card tool-card" key={event.id} open={!completed}><summary><span className="runtime-icon"><Icon name="gear" size={15} /></span><span>{String(event.data.name ?? event.data.tool ?? event.type)}</span><span className="runtime-status-text">{completed ? '已完成' : '执行中'}</span></summary>{event.data.output !== undefined && <pre>{String(event.data.output)}</pre>}</details>
    }
    if (event.type === 'tool.started' || event.type === 'tool.completed') {
      const completed = event.type === 'tool.completed' || Boolean(event.data.completed)
      const output = event.data.output ?? event.data.result
      return <details className="runtime-card tool-card" key={event.id} open={!completed}><summary><span className="runtime-icon"><Icon name="gear" size={15} /></span><span>{String(event.data.name ?? event.data.tool ?? 'tool')}</span><span className="runtime-status-text">{completed ? '已完成' : '执行中'}</span></summary>{output !== undefined && <pre>{String(output)}</pre>}</details>
    }
    if (event.type === 'file.changed' || event.type === 'diff.updated') return <div className="runtime-card diff-card" key={event.id}><span className="runtime-icon">⌁</span><span>{String(event.data.path ?? event.data.summary ?? '检测到文件变更')}</span></div>
    if (event.type === 'goal.updated') return <div className="runtime-card state-card" key={event.id}><strong>Goal</strong><span>{String(event.data.objective ?? event.data.status ?? '')}</span></div>
    if (event.type === 'plan.updated') return <PlanReviewCard event={event} onDecision={(decision) => { if (selectedId) void api.sendMessage(workspace.id, selectedId, `/plan ${decision}`).catch(err => setError(err instanceof Error ? err.message : String(err))) }} />
    if (event.type === 'runtime.disconnected') return <div className="runtime-card error-card" key={event.id}>Agent Runtime 已断开，请重试或恢复会话。</div>
    if (event.type === 'turn.failed') return <div className="runtime-card error-card" key={event.id}>任务失败：{String(event.data.error ?? 'Runtime error')}</div>
    return null
  }

  return <div className="demand-chat-page">
    <header className="topbar chat-topbar">
      <div>
        <button className="back-link" onClick={onBack}>‹ 返回需求</button>
        <div className="eyebrow">DEMAND DEVELOPMENT · CSR AGENT</div>
        <h1>{demand?.name ?? '需求开发'}</h1>
      </div>
      <div className="topbar-actions">
        <button className="btn" onClick={() => { void navigator.clipboard?.writeText(window.location.href); showToast('需求链接已复制') }}>复制链接</button>
        {demand && <button className="btn" onClick={() => setAttachModal(true)}>＋ 添加 Repo</button>}
        <span className={`socket-pill ${socketState}`}>{socketState === 'open' ? '实时连接' : socketState === 'connecting' ? '连接中…' : '已断开'}</span>
      </div>
    </header>
    <div className="chat-layout">
      <aside className="conversation-sidebar">
        <div className="conversation-head"><div><div className="card-kicker">SESSIONS</div><strong>会话</strong></div><button className="btn primary compact" onClick={() => void newConversation()}>＋ 新会话</button></div>
        <div className="conversation-demand"><strong>{demand?.name}</strong><small>{demand?.branchName}</small></div>
        <div className="conversation-list">{conversations.map(item => <button key={item.id} className={`conversation-row ${item.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}><span className={`conversation-status ${item.status}`} /><span><strong>{item.title}</strong><small>{item.status === 'running' ? '执行中' : item.status === 'awaiting_approval' ? '待确认' : new Date(item.updatedAt).toLocaleTimeString()}</small></span><span className="conversation-rename" role="button" onClick={(event) => { event.stopPropagation(); void renameConversation(item) }}>⋯</span></button>)}</div>
        <div className="conversation-foot">{demand?.repositories.length ?? 0} 个 Repo · CSR roots 已锁定</div>
      </aside>
      <section className="chat-main">
        <div className="chat-toolbar">
          <div className="goal-control">
            <button className="goal-chip" onClick={() => { setGoalDraft(selected?.goal?.objective ?? ''); setGoalEditorOpen(value => !value) }}>Goal {selected?.goal?.objective ? `· ${selected.goal.objective}` : '· 设置'}</button>
            {goalEditorOpen && <div className="goal-popover"><strong>Goal</strong><input className="input" value={goalDraft} onChange={event => setGoalDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void setGoal() } }} placeholder="描述本次工作的目标" /><div className="goal-actions"><button className="btn primary" onClick={() => void setGoal()}>保存</button><button className="btn" onClick={() => void setGoal('pause')}>暂停</button><button className="btn" onClick={() => void setGoal('resume')}>恢复</button><button className="btn" onClick={() => void setGoal('complete')}>完成</button><button className="btn" onClick={() => void setGoal('clear')}>清除</button></div></div>}
          </div>
          <button className={`plan-chip ${selected?.plan?.active ? 'active' : ''}`} onClick={() => void togglePlan()}>{selected?.plan?.active ? 'Plan 模式中' : '进入 Plan'}</button>
          <select value={permission} onChange={event => void choosePermission(event.target.value as ConversationPermissionMode)} aria-label="权限模式"><option value="read-only">只读</option><option value="workspace-write">Workspace 写入</option><option value="yolo">Yolo（需求范围）</option></select>
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          {error && <div className="error-banner">{error}</div>}
          {events.length === 0 ? <div className="chat-empty"><span className="workspace-large-mark">CW</span><h2>开始这个需求的开发</h2><p>你可以直接描述目标，或先输入 <code>/goal 你的目标</code>，再用 Plan 模式拆解。</p></div> : compactConversationEvents(events).map(renderEvent)}
        </div>
        <div className={`composer ${pending ? 'composer-takeover' : ''}`}>
          {pending ? pending.type === 'approval.requested' ? <ApprovalComposer event={pending} onApprove={outcome => void approve(pending, outcome)} /> : <QuestionCard event={pending} onAnswer={answer => void answerQuestion(pending, answer)} /> : <>
            <div className="composer-hint">{selected?.plan?.active ? 'Plan 模式：Agent 会先澄清并提出执行计划' : 'CSR Agent 会遵循 Workspace 宪章、AGENTS.md 和当前需求上下文'}</div>
            {running && <div className="composer-queue-switch"><span>发送方式</span><button className={deliveryMode === 'queue' ? 'active' : ''} onClick={() => setDeliveryMode('queue')}>排队</button><button className={deliveryMode === 'steer' ? 'active' : ''} onClick={() => setDeliveryMode('steer')}>引导当前回合</button></div>}
            <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(running && (event.metaKey || event.ctrlKey) ? 'steer' : 'queue') } }} placeholder={running ? '描述下一步…（Enter 排队，⌘/Ctrl + Enter 引导）' : '描述你希望完成的事情…（Enter 发送，Shift + Enter 换行）'} rows={3} />
            <div className="composer-actions"><button className="btn" disabled={!running} onClick={() => void stop()}>停止</button><span className="composer-mode">{permission === 'yolo' ? 'Yolo：仅需求 Worktree' : permission === 'workspace-write' ? 'Workspace 写入 · 需审批' : '只读模式'}</span><button className="btn primary" disabled={!draft.trim() || busy} onClick={() => void send()}>{busy ? '发送中…' : running && deliveryMode === 'steer' ? '引导 Agent' : running ? '排队发送' : '发送'}</button></div>
          </>}
        </div>
      </section>
    </div>
    {attachModal && demandId && demand && <AttachRepositoryModal workspace={workspace} demand={demand} demandId={demandId} onClose={() => setAttachModal(false)} onSuccess={async () => { setAttachModal(false); await loadDemand() }} />}
  </div>
}

function PlanReviewCard({ event, onDecision }: { event: ConversationEvent; onDecision: (decision: 'approve' | 'reject') => void }) {
  const status = typeof event.data.status === 'string' ? event.data.status : ''
  const reviewable = status === 'planning'
  const content = typeof event.data.text === 'string' ? event.data.text : ''
  return <div className="runtime-card state-card" key={event.id}><strong>Plan</strong>{status && <span>{status}</span>}{content && <pre className="plan-content">{String(content)}</pre>}{reviewable && <div className="approval-actions"><button className="btn primary" onClick={() => onDecision('approve')}>确认计划</button><button className="btn" onClick={() => onDecision('reject')}>拒绝并继续澄清</button></div>}</div>
}

function ApprovalComposer({ event, onApprove }: { event: ConversationEvent; onApprove: (outcome: 'allowed-once' | 'rejected') => void }) {
  const detail = event.data.command ?? event.data.path
  return <div className="approval-takeover"><div className="approval-takeover-head"><span className="runtime-icon">⚠</span><strong>需要你的确认</strong><span>Agent 暂停等待</span></div><p>{String(event.data.reason ?? event.data.description ?? 'Agent 请求执行一项受保护操作。')}</p>{detail !== undefined && <code>{String(detail)}</code>}<div className="approval-actions"><button className="btn primary" onClick={() => onApprove('allowed-once')}>允许一次</button><button className="btn" onClick={() => onApprove('rejected')}>拒绝</button></div></div>
}

function QuestionCard({ event, onAnswer }: { event: ConversationEvent; onAnswer: (answer: string) => void }) {
  const [answer, setAnswer] = useState('')
  const questions = Array.isArray(event.data.questions) ? event.data.questions as Array<{ question?: unknown; detail?: unknown }> : []
  const question = questions[0]
  return <div className="approval-takeover question-takeover" key={event.id}><div className="approval-takeover-head"><span className="runtime-icon">?</span><strong>Agent 需要补充信息</strong><span>回答后继续</span></div><p>{String(question?.question ?? question?.detail ?? '请回答 Agent 的问题。')}</p><div className="question-actions"><input className="input" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="输入回答…" /><button className="btn primary" disabled={!answer.trim()} onClick={() => onAnswer(answer.trim())}>提交回答</button></div></div>
}

function AttachRepositoryModal({ workspace, demand, demandId, onClose, onSuccess }: { workspace: Workspace; demand: Demand; demandId: string; onClose: () => void; onSuccess: () => Promise<void> }) {
  const [repositories, setRepositories] = useState<Repository[]>([]); const [selected, setSelected] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { void api.listRepositories(workspace.id).then(rows => setRepositories(rows.filter(row => !demand.repositories.some(existing => existing.id === row.id)))).catch(err => setError(err instanceof Error ? err.message : String(err))) }, [workspace.id, demand.repositories])
  const submit = async () => { if (!selected) return; setBusy(true); setError(''); try { await api.addRepositoryToDemand(workspace.id, demandId, selected); await onSuccess() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="attach-repository-title"><div className="modal-head"><div><div className="eyebrow">DEMAND REPOSITORIES</div><h2 id="attach-repository-title">给需求添加 Repo</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭">×</button></div><p className="field-help">会在现有需求分支 <code>{demand.branchName}</code> 上为该 Repo 创建 Linked Worktree，并更新需求上下文文档。</p><label htmlFor="attach-repository">选择 Repo</label><select id="attach-repository" className="input" value={selected} onChange={event => setSelected(event.target.value)}><option value="">请选择</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name} · {repo.path}</option>)}</select>{repositories.length === 0 && <div className="muted">没有可添加的 Repo；可先回到 Dashboard 添加。</div>}{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>取消</button><button className="btn primary" disabled={busy || !selected} onClick={() => void submit()}>{busy ? '正在创建 Worktree…' : '添加到需求'}</button></div></section></div>
}

export default App
