<template>
  <div class="app-shell codywork-vue" data-testid="codywork-app">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">CW</span><span><strong>CodyWork</strong><small>Codex workbench</small></span></div>
      <template v-if="workspace">
        <button class="switcher" @click="showWorkspacePicker = !showWorkspacePicker"><span class="folder-mark">{{ workspace.name.slice(0, 1).toUpperCase() }}</span><span class="switcher-copy"><strong>{{ workspace.name }}</strong><small>{{ workspace.path }}</small></span><span class="switcher-action">切换</span></button>
        <div v-if="showWorkspacePicker" class="switcher-menu"><button v-for="item in workspaces" :key="item.id" :class="{ selected: item.id === workspace?.id }" @click="selectWorkspace(item)"><span class="folder-mark small">{{ item.name.slice(0, 1).toUpperCase() }}</span><span><strong>{{ item.name }}</strong><small>{{ item.path }}</small></span></button><button class="menu-create" @click="showCreateWorkspace = true">＋ 创建 Workspace</button></div>
        <div class="sidebar-section-label"><span>WORKSPACE</span><small>上下文与资产</small></div>
        <button class="sidebar-item" :class="{ active: activePage === 'dashboard' }" @click="goTo('dashboard')"><span>◫</span><span class="sidebar-label"><strong>概览</strong><small>健康度与进展</small></span></button>
        <button class="sidebar-item" :class="{ active: activePage === 'knowledge' }" @click="goTo('knowledge')"><span>▤</span><span class="sidebar-label"><strong>知识库</strong><small>规范与文档</small></span></button>
        <button class="sidebar-item" :class="{ active: activePage === 'skills' }" @click="goTo('skills')"><span>✦</span><span class="sidebar-label"><strong>Skills</strong><small>Agent 可用能力</small></span></button>
        <div class="sidebar-section-label"><span>WORK MODE</span><small>Demand / Worktree</small></div>
        <button class="sidebar-item" :class="{ active: activePage === 'demands' }" @click="goTo('demands')"><span>▦</span><span class="sidebar-label"><strong>需求概览</strong><small>{{ demands.length }} 个需求</small></span></button>
        <button v-for="demand in demands" :key="demand.id" class="sidebar-item demand-nav" :class="{ active: activePage === 'chat' && demand.id === selectedDemand?.id }" @click="openDemand(demand)"><span :class="['demand-dot', demand.status]" /><span class="sidebar-label"><strong>{{ demand.name }}</strong><small>{{ demand.branchName }}</small></span></button>
        <button class="sidebar-item" @click="showCreateDemand = true"><span>＋</span><span class="sidebar-label"><strong>新建需求</strong><small>创建隔离 Worktree</small></span></button>
      </template>
      <template v-else><div class="sidebar-section-label"><span>WORKSPACES</span><small>开始开发</small></div><button class="sidebar-item active" @click="showCreateWorkspace = true"><span>＋</span><span class="sidebar-label"><strong>创建 Workspace</strong><small>目录或 Git 仓库</small></span></button></template>
      <div class="sidebar-spacer" />
      <button class="sidebar-item" :class="{ active: activePage === 'settings' }" @click="goTo('settings')"><span>⚙</span><span class="sidebar-label"><strong>Codex Runtime</strong><small>连接与诊断</small></span></button>
      <div class="sidebar-note"><span class="status-dot" :class="socketState" /><span><strong>{{ socketState === 'open' ? 'Realtime connected' : 'Codex ready' }}</strong><small>{{ workspace ? 'Worktree policy enforced' : '选择一个 Workspace 开始' }}</small></span></div>
    </aside>

    <main class="main">
      <div v-if="loading" class="page-loading">正在加载 CodyWork…</div>
      <section v-else-if="!workspace" class="create-page"><div class="create-hero"><div class="eyebrow">CODYWORK / VUE</div><h1>为你的研发工作创建 Workspace</h1><p>Workspace 管理真实目录；每个需求拥有独立 Worktree，Codex 对话始终遵循这个边界。</p></div><button class="btn primary" @click="showCreateWorkspace = true">创建 Workspace</button></section>
      <section v-else-if="activePage === 'dashboard'" class="workspace-page">
        <header class="topbar"><div><div class="eyebrow">{{ workspace.name.toUpperCase() }} / OVERVIEW</div><h1>Workspace 概览</h1></div><div class="topbar-actions"><button class="btn" @click="refreshDashboard">刷新状态</button><button class="btn primary" @click="showAddRepository = true">＋ 添加 Repo</button></div></header>
        <div class="workspace-body">
          <div class="workspace-header-card"><span class="workspace-large-mark">{{ workspace.name.slice(0, 1).toUpperCase() }}</span><div class="workspace-header-copy"><h2>{{ workspace.name }}</h2><code>{{ workspace.path }}</code><p>所有会话都从 Workspace → Demand → Worktree 进入受限执行。</p></div><span class="ready-pill"><i />ready</span></div>
          <div class="metric-grid"><article class="metric-card"><small>REPOSITORIES</small><strong>{{ dashboard?.repositories.total ?? repositories.length }}</strong><span>登记开发仓库</span></article><article class="metric-card"><small>DEMANDS</small><strong>{{ dashboard?.demands.total ?? demands.length }}</strong><span>隔离 Worktree</span></article><article class="metric-card"><small>KNOWLEDGE</small><strong>{{ dashboard?.knowledge.documents ?? 0 }}</strong><span>可读文档</span></article><article class="metric-card"><small>SKILLS</small><strong>{{ dashboard?.skills.available ?? 0 }}</strong><span>可调用能力</span></article></div>
          <div class="workspace-grid"><article class="info-card"><div class="card-kicker">REPOSITORIES</div><h3>开发根目录</h3><div v-if="repositories.length" class="entry-list"><span v-for="repo in repositories" :key="repo.id" class="entry-chip">{{ repo.name }}{{ repo.dirty ? ' · dirty' : '' }}</span></div><p v-else class="muted">先添加一个 Git 仓库或目录，再创建 Demand。</p><button class="btn" @click="showAddRepository = true">管理仓库</button></article><article class="info-card"><div class="card-kicker">NEXT STEP</div><h3>按需求进入执行</h3><p>Demand 为每个仓库创建独立 Worktree，并将可读写根目录注入 Codex policy。</p><button class="btn primary" @click="goTo('demands')">查看需求</button></article></div>
        </div>
      </section>
      <section v-else-if="activePage === 'knowledge'" class="knowledge-page"><header class="topbar"><div><div class="eyebrow">WORKSPACE / KNOWLEDGE</div><h1>知识库</h1></div><button class="btn" @click="loadKnowledge">刷新</button></header><div class="knowledge-body"><div class="knowledge-layout"><article class="knowledge-list-card"><div class="knowledge-list-head"><strong>文档</strong><span>{{ filteredKnowledge.length }}</span></div><div class="knowledge-search"><input v-model="knowledgeQuery" class="input" placeholder="搜索文档…" /></div><button v-for="doc in filteredKnowledge" :key="doc.id" :class="['knowledge-row', { active: selectedKnowledge?.id === doc.id }]" @click="openKnowledge(doc)"><span class="knowledge-file-icon">{{ doc.extension.replace('.', '').slice(0, 4) || 'doc' }}</span><span class="knowledge-row-copy"><strong>{{ doc.name }}</strong><small>{{ doc.relativePath }}</small></span></button><p v-if="!filteredKnowledge.length" class="knowledge-empty">Workspace 中还没有可展示的知识文档。</p></article><article class="knowledge-detail-card"><template v-if="selectedKnowledge"><div class="knowledge-detail-head"><div><div class="card-kicker">{{ selectedKnowledge.extension || 'DOCUMENT' }}</div><h2>{{ selectedKnowledge.name }}</h2><p>{{ selectedKnowledge.path }}</p></div><span class="knowledge-extension">{{ selectedKnowledge.size }} bytes</span></div><pre class="knowledge-content">{{ selectedKnowledge.content ?? '正在读取文档…' }}</pre></template><p v-else class="knowledge-detail-empty">从左侧选择一个文档查看其内容。</p></article></div></div></section>
      <section v-else-if="activePage === 'skills'" class="skills-page"><header class="topbar"><div><div class="eyebrow">WORKSPACE / SKILLS</div><h1>Skills</h1></div><button class="btn" @click="loadSkills">刷新</button></header><div class="skills-body"><div class="skill-install-card"><div><div class="card-kicker">ADD CAPABILITY</div><h2>为当前 Workspace 安装 Skill</h2><p>Skill 会被安装到 Workspace 的 <code>.agents/skills</code>，并且仍受当前 Workspace 写入策略约束。</p></div><div class="skill-install-form"><input v-model="skillSource" class="input" placeholder="Git URL 或 Skill 来源" /><button class="btn primary" :disabled="installingSkill || !skillSource.trim()" @click="installSkill">{{ installingSkill ? '安装中…' : '安装' }}</button></div></div><div v-if="skillJob" class="skill-run-result" :class="skillJob.status">{{ skillJob.message ?? skillJob.status }}<template v-if="skillJob.events.length"> · {{ skillJob.events.length }} 个运行事件</template></div><div class="skills-layout"><article class="skills-list-card"><div class="skills-list-head"><strong>可用 Skills</strong><span>{{ skills.length }}</span></div><button v-for="skill in skills" :key="skill.id" :class="['skill-row', { active: selectedSkill?.id === skill.id }]" @click="openSkill(skill)"><span class="skill-row-copy"><strong>{{ skill.name }}</strong><small>{{ skill.description || skill.path }}</small></span><span :class="['skill-status-pill', skill.status]">{{ skill.status }}</span></button><p v-if="!skills.length" class="skills-empty">还没有发现可用 Skill。</p></article><article class="skill-detail-card"><template v-if="selectedSkill"><div class="skill-detail-head"><div><div class="card-kicker">{{ selectedSkill.source }}</div><h2>{{ selectedSkill.name }}</h2><p>{{ selectedSkill.description }}</p></div><span :class="['skill-status-pill', selectedSkill.status]">{{ selectedSkill.status }}</span></div><div class="skill-meta"><span>{{ selectedSkill.modelInvocable ? 'Agent 可调用' : '仅供参考' }}</span><code>{{ selectedSkill.path }}</code></div><pre class="skill-content">{{ selectedSkill.content }}</pre></template><p v-else class="skill-detail-empty">从左侧选择一个 Skill 查看详情。</p></article></div></div></section>
      <section v-else-if="activePage === 'settings'" class="workspace-page"><header class="topbar"><div><div class="eyebrow">GLOBAL / RUNTIME</div><h1>Codex Runtime</h1></div><button class="btn" :disabled="testingRuntime" @click="testRuntime">{{ testingRuntime ? '检查中…' : '测试连接' }}</button></header><div class="workspace-body"><article class="settings-card"><div class="card-kicker">APP SERVER</div><h2>Codex App Server</h2><p>服务级共享进程；每个会话仍通过 Demand Worktree policy 隔离。</p><label>启动命令</label><input v-model="runtimeCommand" class="input" placeholder="codex app-server --stdio" /><p v-if="runtimeMessage" class="runtime-result">{{ runtimeMessage }}</p><button class="btn primary" @click="saveRuntime">保存 Runtime 设置</button></article></div></section>
      <section v-else-if="activePage === 'demands' && !selectedDemand" class="demands-body">
        <header class="topbar"><div><div class="eyebrow">{{ workspace.name.toUpperCase() }} / WORK MODE</div><h1>需求工作台</h1></div><div class="topbar-actions"><button class="btn" :disabled="importingWorktrees" @click="importExistingWorktrees">{{ importingWorktrees ? '扫描中…' : '扫描已有 Worktree' }}</button><button class="btn primary" @click="showCreateDemand = true">＋ 新建需求</button></div></header>
        <div class="dashboard-note"><div><strong>每个需求都是一个独立执行上下文</strong><p>Codex 可以跨 Repo 协作，但只会读写当前需求登记的 Worktree 根目录。</p></div><code>{{ workspace.path }}</code></div>
        <div class="demand-grid"><button v-for="demand in demands" :key="demand.id" class="demand-card" @click="openDemand(demand)"><span :class="['demand-dot', demand.status]" /><div><strong>{{ demand.name }}</strong><small>{{ demand.branchName }}</small><p>{{ demand.repositories.length }} 个 Repo · {{ demand.status === 'in_progress' ? '开发中' : demand.status }}</p></div><span>→</span></button><div v-if="demands.length === 0" class="empty-list"><strong>还没有需求</strong><span>先选择开发 Repo，再创建一个隔离的 Demand Worktree。</span><button class="btn primary" @click="showCreateDemand = true">创建需求</button></div></div>
      </section>
      <section v-else-if="activePage === 'chat' && selectedDemand" class="demand-chat-page">
        <header class="topbar chat-topbar"><div><button class="back-link" @click="selectedDemand = null">‹ 返回需求</button><div class="eyebrow">DEMAND / {{ selectedDemand.branchName }}</div><h1>{{ selectedDemand.name }}</h1></div><div class="topbar-actions"><span :class="['socket-pill', socketState]">{{ socketLabel }}</span><button class="btn" @click="createConversation">＋ 新会话</button></div></header>
        <div class="chat-layout">
          <aside class="conversation-sidebar"><div class="conversation-head"><div><div class="card-kicker">SESSIONS</div><strong>会话</strong></div></div><div class="conversation-demand"><strong>{{ selectedDemand.name }}</strong><small>{{ selectedDemand.repositories.map((repo) => repo.name).join(' · ') || '尚未添加 Repo' }}</small></div><button v-for="conversation in conversations" :key="conversation.id" :class="['conversation-row', { active: conversation.id === selectedConversation?.id }]" @click="openConversation(conversation)"><span :class="['conversation-status', conversation.status]" /><span><strong>{{ conversation.title }}</strong><small>{{ statusLabel(conversation.status) }}</small></span></button></aside>
          <section class="chat-main">
            <div class="chat-toolbar"><button :class="['plan-chip', { active: selectedConversation?.plan?.active }]" @click="sendCommand('/plan')">{{ selectedConversation?.plan?.active ? 'Plan 模式' : '进入 Plan' }}</button><select v-model="permission" @change="savePermission"><option value="read-only">只读</option><option value="workspace-write">Worktree 写入</option><option value="yolo">Yolo（仍受 Worktree 限制）</option></select><span v-if="selectedConversation?.goal?.objective" class="goal-chip">Goal · {{ selectedConversation.goal.objective }}</span></div>
            <div ref="scrollArea" class="chat-scroll" @scroll="onScroll">
              <div v-if="error" class="error-banner">{{ error }}</div>
              <div v-if="messages.length === 0 && timeline.length === 0" class="chat-empty"><span class="workspace-large-mark">CW</span><h2>开始这个需求的开发</h2><p>描述目标即可。Codex 会看到当前 Demand 的 Worktree、策略和上下文。</p></div>
              <template v-for="entry in renderedEntries" :key="entry.id">
                <article v-if="entry.kind === 'message'" :class="['chat-bubble', entry.message.role]"><div class="chat-label">{{ entry.message.role === 'user' ? '你' : 'Codex Agent' }}</div><pre v-if="entry.message.messageType === 'plan.live'" class="markdown-message plan-message">{{ entry.message.text }}</pre><div v-else class="markdown-message">{{ entry.message.text }}</div></article>
                <details v-else-if="entry.kind === 'tool'" :class="['runtime-card', 'tool-card', toolStatusTone(entry.tool.status)]" :open="entry.tool.status === 'running'"><summary><span>⌁</span><strong>{{ entry.tool.title }}</strong><small>{{ entry.tool.status }}</small></summary><p>{{ entry.tool.summary }}</p><ul v-if="entry.tool.details.length"><li v-for="detail in entry.tool.details" :key="detail">{{ detail }}</li></ul><pre v-if="entry.tool.output">{{ previewToolOutput(entry.tool.output).text }}</pre></details>
                <details v-else-if="entry.kind === 'reasoning'" class="runtime-card reasoning-card"><summary>✦ 推理过程</summary><pre>{{ entry.text }}</pre></details>
              </template>
              <article v-if="liveStatus" class="live-overlay-inline"><strong>{{ liveStatus }}</strong><span>{{ socketState === 'open' ? '实时更新中' : '等待恢复连接' }}</span></article>
            </div>
            <div class="composer">
              <section v-if="pendingApproval" class="approval-takeover"><div class="approval-takeover-head"><strong>需要你的确认</strong><span>Agent 暂停等待</span></div><p>{{ String(pendingApproval.data.reason ?? 'Codex 请求执行一项受保护操作。') }}</p><code v-if="pendingApproval.data.command">{{ String(pendingApproval.data.command) }}</code><div class="approval-actions"><button class="btn primary" @click="resolveApproval('allowed-once')">允许一次</button><button class="btn" @click="resolveApproval('rejected')">拒绝</button></div></section>
              <section v-else-if="pendingQuestion" class="approval-takeover"><div class="approval-takeover-head"><strong>Agent 需要补充信息</strong><span>回答后继续</span></div><p>{{ questionText }}</p><div class="question-actions"><input v-model="questionAnswer" class="input" placeholder="输入回答…" @keyup.enter="resolveQuestion" /><button class="btn primary" :disabled="!questionAnswer.trim()" @click="resolveQuestion">提交回答</button></div></section>
              <template v-else><div class="composer-hint">{{ selectedConversation?.plan?.active ? 'Plan 模式：先澄清和规划，再确认执行。' : '当前消息只会在该 Demand 的 Worktree 内执行。' }}</div><textarea v-model="draft" :placeholder="isRunning ? '描述下一步…（Enter 排队，Shift + Enter 换行）' : '描述你希望完成的事情…（Enter 发送，Shift + Enter 换行）'" rows="3" @keydown.enter.exact.prevent="sendMessage" /><div class="composer-actions"><button class="btn" :disabled="!isRunning" @click="interrupt">停止</button><span class="composer-mode">{{ permission === 'read-only' ? '只读' : permission === 'yolo' ? 'Yolo · Worktree' : 'Worktree 写入 · 审批' }}</span><button class="btn primary" :disabled="!draft.trim() || sending" @click="sendMessage">{{ sending ? '发送中…' : isRunning ? '排队发送' : '发送' }}</button></div></template>
            </div>
          </section>
        </div>
      </section>
    </main>

    <div v-if="showCreateWorkspace" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">NEW WORKSPACE</div><h2>创建 Workspace</h2></div><button class="icon-button" @click="showCreateWorkspace = false">×</button></div><div class="mode-tabs"><button :class="{ active: workspaceMode === 'folder' }" @click="workspaceMode = 'folder'">本地目录</button><button :class="{ active: workspaceMode === 'git' }" @click="workspaceMode = 'git'">Git clone</button></div><label>显示名称</label><input v-model="workspaceName" class="input" placeholder="可选" /><template v-if="workspaceMode === 'folder'"><label>目录路径</label><input v-model="workspacePath" class="input" placeholder="/Users/you/projects/app" /></template><template v-else><label>Git URL</label><input v-model="workspaceGitUrl" class="input" placeholder="git@github.com:org/repo.git" /><label>目标目录</label><input v-model="workspacePath" class="input" placeholder="/Users/you/projects/repo" /></template><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showCreateWorkspace = false">取消</button><button class="btn primary" :disabled="creating || !workspacePath.trim() || (workspaceMode === 'git' && !workspaceGitUrl.trim())" @click="createWorkspace">{{ creating ? '正在创建…' : '创建并进入' }}</button></div></section></div>
    <div v-if="showCreateDemand" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">NEW DEMAND</div><h2>创建隔离需求</h2></div><button class="icon-button" @click="showCreateDemand = false">×</button></div><label>需求名</label><input v-model="demandName" class="input" placeholder="例如：统一 AI 工作对话" /><label>分支名</label><input v-model="demandBranch" class="input" placeholder="可选，默认按需求名生成" /><label>开发 Repo</label><div class="repo-picker"><label v-for="repo in repositories" :key="repo.id" class="repo-option"><input v-model="selectedRepositoryIds" type="checkbox" :value="repo.id" /><span><strong>{{ repo.name }}</strong><small>{{ repo.path }}</small></span></label></div><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showCreateDemand = false">取消</button><button class="btn primary" :disabled="creating || !demandName.trim() || selectedRepositoryIds.length === 0" @click="createDemand">创建并进入</button></div></section></div>
    <div v-if="showAddRepository" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">REPOSITORY</div><h2>添加开发 Repo</h2></div><button class="icon-button" @click="showAddRepository = false">×</button></div><div class="mode-tabs"><button :class="{ active: repositorySource === 'folder' }" @click="repositorySource = 'folder'">本地目录</button><button :class="{ active: repositorySource === 'git' }" @click="repositorySource = 'git'">Git clone</button></div><label>显示名称</label><input v-model="repositoryName" class="input" placeholder="可选" /><template v-if="repositorySource === 'folder'"><label>仓库目录</label><input v-model="repositoryPath" class="input" placeholder="/Users/you/projects/repository" /></template><template v-else><label>Git URL</label><input v-model="repositoryUrl" class="input" placeholder="git@github.com:org/repository.git" /><label>目标目录</label><input v-model="repositoryPath" class="input" placeholder="/Users/you/projects/repository" /></template><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showAddRepository = false">取消</button><button class="btn primary" :disabled="creating || !repositoryPath.trim() || (repositorySource === 'git' && !repositoryUrl.trim())" @click="addRepository">{{ creating ? '正在添加…' : '添加 Repo' }}</button></div></section></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { previewToolOutput, toolStatusTone, type ConversationMessage } from '@codycodeagent/cody-web-core/conversation'
import {
  api,
  type Conversation,
  type ConversationEvent,
  type ConversationPermissionMode,
  type DashboardSnapshot,
  type Demand,
  type KnowledgeDocument,
  type Repository,
  type RuntimeSettings,
  type SkillInstallStatus,
  type Workspace,
  type WorkspaceSkill,
  type WorkspaceSource,
} from './api'
import { buildMessages, buildTimeline, findPendingEvent, type TimelineEntry } from './conversationState'

type RenderedEntry = { id: string; kind: 'message'; message: ConversationMessage } | TimelineEntry
type Page = 'dashboard' | 'demands' | 'knowledge' | 'skills' | 'settings' | 'chat'

const loading = ref(true); const error = ref(''); const modalError = ref(''); const workspaces = ref<Workspace[]>([]); const workspace = ref<Workspace | null>(null); const demands = ref<Demand[]>([]); const repositories = ref<Repository[]>([]); const selectedDemand = ref<Demand | null>(null); const conversations = ref<Conversation[]>([]); const selectedConversation = ref<Conversation | null>(null); const events = ref<ConversationEvent[]>([])
const draft = ref(''); const sending = ref(false); const permission = ref<ConversationPermissionMode>('workspace-write'); const socketState = ref<'open' | 'connecting' | 'closed'>('closed'); const showWorkspacePicker = ref(false); const showCreateWorkspace = ref(false); const showCreateDemand = ref(false); const creating = ref(false); const importingWorktrees = ref(false); const workspaceMode = ref<'folder' | 'git'>('folder'); const workspaceName = ref(''); const workspacePath = ref(''); const workspaceGitUrl = ref(''); const demandName = ref(''); const demandBranch = ref(''); const selectedRepositoryIds = ref<string[]>([]); const questionAnswer = ref(''); const scrollArea = ref<HTMLElement | null>(null)
const activePage = ref<Page>('dashboard'); const dashboard = ref<DashboardSnapshot | null>(null); const knowledge = ref<KnowledgeDocument[]>([]); const selectedKnowledge = ref<KnowledgeDocument | null>(null); const knowledgeQuery = ref(''); const skills = ref<WorkspaceSkill[]>([]); const selectedSkill = ref<WorkspaceSkill | null>(null); const skillSource = ref(''); const installingSkill = ref(false); const skillJob = ref<SkillInstallStatus | null>(null); const runtime = ref<RuntimeSettings | null>(null); const runtimeCommand = ref(''); const runtimeMessage = ref(''); const testingRuntime = ref(false); const showAddRepository = ref(false); const repositorySource = ref<'folder' | 'git'>('folder'); const repositoryPath = ref(''); const repositoryUrl = ref(''); const repositoryName = ref('')
let socket: WebSocket | null = null; let reconnectTimer: number | null = null; let lastEventId = 0; let followBottom = true
const socketLabel = computed(() => socketState.value === 'open' ? '实时连接' : socketState.value === 'connecting' ? '连接中…' : '已断开')
const isRunning = computed(() => selectedConversation.value?.status === 'running')
const pendingApproval = computed(() => pendingOf('approval.requested', 'approval.resolved'))
const pendingQuestion = computed(() => pendingOf('question.requested', 'question.resolved'))
const questionText = computed(() => { const questions = pendingQuestion.value?.data.questions; return Array.isArray(questions) ? String((questions[0] as { question?: unknown; detail?: unknown } | undefined)?.question ?? (questions[0] as { detail?: unknown } | undefined)?.detail ?? '请回答 Agent 的问题。') : '请回答 Agent 的问题。' })
const messages = computed<ConversationMessage[]>(() => buildMessages(events.value))
const timeline = computed<TimelineEntry[]>(() => buildTimeline(events.value))
const renderedEntries = computed<RenderedEntry[]>(() => { const items: RenderedEntry[] = []; for (const message of messages.value) items.push({ id: message.id, kind: 'message', message }); for (const entry of timeline.value) items.push(entry); return items })
const liveStatus = computed(() => isRunning.value ? (pendingApproval.value ? '等待审批' : pendingQuestion.value ? '等待回答' : 'Codex 正在工作') : '')
const filteredKnowledge = computed(() => { const query = knowledgeQuery.value.trim().toLowerCase(); return query ? knowledge.value.filter(doc => `${doc.name} ${doc.relativePath}`.toLowerCase().includes(query)) : knowledge.value })

function pendingOf(requestType: string, resolvedType: string): ConversationEvent | null { return findPendingEvent(events.value, requestType, resolvedType) }
function statusLabel(status: Conversation['status']): string { return status === 'running' ? '执行中' : status === 'awaiting_approval' ? '待确认' : status === 'failed' ? '失败' : status === 'disconnected' ? '已断开' : '已完成' }
function onScroll(): void { const node = scrollArea.value; if (node) followBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160 }
async function scrollToBottom(): Promise<void> { await nextTick(); if (followBottom) scrollArea.value?.scrollTo({ top: scrollArea.value.scrollHeight, behavior: 'smooth' }) }
async function loadWorkspaces(): Promise<void> { loading.value = true; try { workspaces.value = await api.listWorkspaces(); const active = workspaces.value.find((item) => item.active) ?? workspaces.value[0]; if (active) await selectWorkspace(active) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { loading.value = false } }
function goTo(page: Exclude<Page, 'chat'>): void {
  activePage.value = page
  selectedDemand.value = null
  selectedConversation.value = null
  socket?.close()
  if (page === 'dashboard') void refreshDashboard()
  if (page === 'knowledge') void loadKnowledge()
  if (page === 'skills') void loadSkills()
  if (page === 'settings') void loadRuntime()
}
async function selectWorkspace(next: Workspace): Promise<void> {
  const opened = await api.openWorkspace(next.id)
  workspace.value = opened.workspace
  workspaces.value = workspaces.value.map((item) => ({ ...item, active: item.id === next.id }))
  showWorkspacePicker.value = false
  demands.value = await api.listDemands(next.id)
  repositories.value = await api.listRepositories(next.id)
  activePage.value = 'dashboard'
  selectedDemand.value = null
  selectedConversation.value = null
  await refreshDashboard()
}
async function refreshDashboard(): Promise<void> { if (workspace.value) dashboard.value = await api.refreshDashboard(workspace.value.id) }
async function loadKnowledge(): Promise<void> { if (workspace.value) knowledge.value = await api.listKnowledge(workspace.value.id) }
async function openKnowledge(document: KnowledgeDocument): Promise<void> { if (workspace.value) selectedKnowledge.value = await api.getKnowledge(workspace.value.id, document.id) }
async function loadSkills(): Promise<void> { if (workspace.value) skills.value = await api.listSkills(workspace.value.id) }
async function openSkill(skill: WorkspaceSkill): Promise<void> { if (workspace.value) selectedSkill.value = await api.getSkill(workspace.value.id, skill.id) }
async function installSkill(): Promise<void> {
  if (!workspace.value || !skillSource.value.trim() || installingSkill.value) return
  installingSkill.value = true
  try {
    const created = await api.installSkill(workspace.value.id, skillSource.value.trim())
    skillSource.value = ''
    let job = await api.skillInstallStatus(workspace.value.id, created.jobId)
    skillJob.value = job
    while (job.status === 'running') {
      await new Promise(resolve => window.setTimeout(resolve, 500))
      job = await api.skillInstallStatus(workspace.value.id, created.jobId)
      skillJob.value = job
    }
    await loadSkills()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { installingSkill.value = false }
}
async function loadRuntime(): Promise<void> {
  runtime.value = await api.runtimeSettings()
  runtimeCommand.value = runtime.value.codex.command
}
async function saveRuntime(): Promise<void> {
  try {
    runtime.value = await api.updateRuntimeSettings({ codex: { command: runtimeCommand.value.trim() } })
    runtimeMessage.value = '已保存。下一次会话将使用新的 App Server 设置。'
  } catch (cause) { runtimeMessage.value = cause instanceof Error ? cause.message : String(cause) }
}
async function testRuntime(): Promise<void> {
  testingRuntime.value = true
  try { const manifest = await api.testRuntime(); runtimeMessage.value = `连接成功：${manifest.runtimeVersion} · protocol ${manifest.protocolVersion}` }
  catch (cause) { runtimeMessage.value = cause instanceof Error ? cause.message : String(cause) }
  finally { testingRuntime.value = false }
}
async function addRepository(): Promise<void> {
  if (!workspace.value) return
  creating.value = true
  modalError.value = ''
  try {
    const repository = await api.addRepository(workspace.value.id, repositorySource.value === 'folder'
      ? { source: 'folder', path: repositoryPath.value.trim(), name: repositoryName.value.trim() || undefined }
      : { source: 'git', url: repositoryUrl.value.trim(), path: repositoryPath.value.trim(), name: repositoryName.value.trim() || undefined })
    repositories.value = [...repositories.value, repository]
    repositoryPath.value = ''; repositoryUrl.value = ''; repositoryName.value = ''
    showAddRepository.value = false
    await refreshDashboard()
  } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false }
}
async function openDemand(demand: Demand): Promise<void> { selectedDemand.value = demand; activePage.value = 'chat'; conversations.value = await api.listConversations(workspace.value!.id, demand.id); if (!conversations.value.length) { const created = await api.createConversation(workspace.value!.id, demand.id); conversations.value = [created] }; await openConversation(conversations.value[0]!) }
async function openConversation(conversation: Conversation): Promise<void> { selectedConversation.value = conversation; permission.value = conversation.permissionMode; events.value = []; lastEventId = 0; error.value = ''; const history = await api.conversationHistory(workspace.value!.id, conversation.id); events.value = history.events; lastEventId = history.events.at(-1)?.id ?? 0; connect(conversation.id); await scrollToBottom() }
function connect(conversationId: string): void { socket?.close(); if (reconnectTimer !== null) window.clearTimeout(reconnectTimer); const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'; const host = window.location.hostname || '127.0.0.1'; socketState.value = 'connecting'; socket = new WebSocket(`${protocol}://${host}:3210/api/workspaces/${encodeURIComponent(workspace.value!.id)}/conversations/${encodeURIComponent(conversationId)}/events?after=${lastEventId}`); socket.onopen = () => { socketState.value = 'open'; socket?.send(JSON.stringify({ type: 'ping' })) }; socket.onmessage = (message) => { try { const payload = JSON.parse(String(message.data)) as { type?: string; event?: ConversationEvent }; const event = payload.event; if (payload.type !== 'event' || !event || event.id <= lastEventId) return; lastEventId = event.id; events.value = [...events.value, event]; conversations.value = conversations.value.map((item) => item.id === conversationId ? { ...item, status: event.type === 'turn.started' ? 'running' : event.type === 'approval.requested' || event.type === 'question.requested' ? 'awaiting_approval' : event.type === 'turn.failed' ? 'failed' : event.type === 'turn.completed' ? 'completed' : item.status, lastEventId: event.id } : item); if (selectedConversation.value?.id === conversationId) selectedConversation.value = conversations.value.find((item) => item.id === conversationId) ?? selectedConversation.value; void scrollToBottom() } catch { error.value = '收到无法识别的 Runtime 事件' } }; socket.onclose = () => { if (selectedConversation.value?.id !== conversationId) return; socketState.value = 'closed'; reconnectTimer = window.setTimeout(() => connect(conversationId), 1_000) }; socket.onerror = () => { socketState.value = 'closed' } }
async function createWorkspace(): Promise<void> { creating.value = true; modalError.value = ''; try { const source: WorkspaceSource = workspaceMode.value === 'folder' ? { type: 'folder', path: workspacePath.value.trim() } : { type: 'git', url: workspaceGitUrl.value.trim(), destination: workspacePath.value.trim() }; const created = await api.createWorkspace(source, workspaceName.value.trim() || undefined); showCreateWorkspace.value = false; workspaceName.value = ''; workspacePath.value = ''; workspaceGitUrl.value = ''; await loadWorkspaces(); await selectWorkspace(created.workspace) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false } }
async function importExistingWorktrees(): Promise<void> { if (!workspace.value || importingWorktrees.value) return; importingWorktrees.value = true; try { const result = await api.importExistingWorktrees(workspace.value.id); demands.value = await api.listDemands(workspace.value.id); await refreshDashboard(); error.value = result.imported.length ? `已导入 ${result.imported.length} 个已有 Demand。` : result.skipped.length ? `没有可导入的 Worktree：${result.skipped[0]!.reason}` : '没有发现尚未导入的 Worktree。' } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { importingWorktrees.value = false } }
async function createDemand(): Promise<void> { if (!workspace.value) return; creating.value = true; modalError.value = ''; try { const created = await api.createDemand(workspace.value.id, { name: demandName.value.trim(), ...(demandBranch.value.trim() ? { branchName: demandBranch.value.trim() } : {}), repositoryIds: selectedRepositoryIds.value }); demands.value = await api.listDemands(workspace.value.id); showCreateDemand.value = false; demandName.value = ''; demandBranch.value = ''; selectedRepositoryIds.value = []; const demand = demands.value.find((item) => item.id === created.demand.id); if (demand) await openDemand(demand) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false } }
async function createConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value) return; const created = await api.createConversation(workspace.value.id, selectedDemand.value.id); conversations.value = [created, ...conversations.value]; await openConversation(created) }
async function sendMessage(): Promise<void> { if (!workspace.value || !selectedConversation.value || !draft.value.trim() || sending.value) return; const content = draft.value.trim(); draft.value = ''; sending.value = true; try { await api.sendMessage(workspace.value.id, selectedConversation.value.id, content, isRunning.value ? 'queue' : 'queue') } catch (cause) { draft.value = content; error.value = cause instanceof Error ? cause.message : String(cause) } finally { sending.value = false } }
async function sendCommand(command: string): Promise<void> { if (!workspace.value || !selectedConversation.value) return; await api.sendMessage(workspace.value.id, selectedConversation.value.id, command) }
async function savePermission(): Promise<void> { if (!workspace.value || !selectedConversation.value) return; try { const updated = await api.setConversationPermission(workspace.value.id, selectedConversation.value.id, permission.value); selectedConversation.value = updated; conversations.value = conversations.value.map((item) => item.id === updated.id ? updated : item) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } }
async function interrupt(): Promise<void> { if (workspace.value && selectedConversation.value) await api.interruptConversation(workspace.value.id, selectedConversation.value.id) }
async function resolveApproval(outcome: 'allowed-once' | 'rejected'): Promise<void> { if (!workspace.value || !selectedConversation.value || !pendingApproval.value) return; await api.resolveApproval(workspace.value.id, selectedConversation.value.id, String(pendingApproval.value.data.approvalId ?? pendingApproval.value.data.requestId ?? ''), outcome) }
async function resolveQuestion(): Promise<void> { if (!workspace.value || !selectedConversation.value || !pendingQuestion.value || !questionAnswer.value.trim()) return; await api.answerQuestion(workspace.value.id, selectedConversation.value.id, String(pendingQuestion.value.data.requestId ?? ''), questionAnswer.value.trim()); questionAnswer.value = '' }
watch(() => events.value.length, () => { void scrollToBottom() })
onMounted(() => { void loadWorkspaces() })
onBeforeUnmount(() => { socket?.close(); if (reconnectTimer !== null) window.clearTimeout(reconnectTimer) })
</script>
