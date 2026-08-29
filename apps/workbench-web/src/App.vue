<template>
  <div class="app-shell codywork-vue" data-testid="codywork-app">
    <WorkbenchSidebar :workspace="workspace" :workspaces="workspaces" :demands="demands" :selected-demand-id="selectedDemand?.id ?? ''" :active-page="activePage" :socket-state="socketState" :workspace-picker-open="showWorkspacePicker" :demand-expanded="demandNavExpanded" @update:workspace-picker-open="showWorkspacePicker = $event" @update:demand-expanded="demandNavExpanded = $event" @select-workspace="selectWorkspace" @remove-workspace="openDeleteWorkspace" @create-workspace="showCreateWorkspace = true" @create-demand="showCreateDemand = true" @navigate="goTo" @open-demand="openDemand" />

    <main class="main">
      <div v-if="error" class="app-error-banner" role="alert"><span>{{ error }}</span><button type="button" aria-label="关闭错误提示" @click="error = ''">×</button></div>
      <div v-if="loading" class="page-loading">正在加载 CodyWork…</div>
      <section v-else-if="!workspace" class="create-page"><div class="create-hero"><div class="eyebrow">CODYWORK / VUE</div><h1>为你的研发工作创建 Workspace</h1><p>Workspace 管理真实目录；每个需求拥有独立 Worktree，Codex 对话始终遵循这个边界。</p></div><button class="btn primary" @click="showCreateWorkspace = true">创建 Workspace</button></section>
      <section v-else-if="activePage === 'dashboard'" class="workspace-page">
        <header class="topbar"><div><div class="eyebrow">{{ workspace.name.toUpperCase() }} / OVERVIEW</div><h1>Workspace 概览</h1></div><div class="topbar-actions"><span v-if="dashboard" :class="['cache-status', dashboard.cache.state]">{{ dashboardCacheLabel }}</span><button class="btn" :disabled="dashboardRefreshing" @click="requestDashboardRefresh">{{ dashboardRefreshing ? '刷新中…' : '刷新状态' }}</button><button class="btn primary" @click="showAddRepository = true">＋ 添加 Repo</button></div></header>
        <div class="workspace-body">
          <div class="workspace-header-card"><span class="workspace-large-mark">{{ workspace.name.slice(0, 1).toUpperCase() }}</span><div class="workspace-header-copy"><h2>{{ workspace.name }}</h2><code>{{ workspace.path }}</code><p>所有会话都从 Workspace → Demand → Worktree 进入受限执行。</p></div><span class="ready-pill"><i />ready</span></div>
          <div class="metric-grid" aria-label="Workspace 统计"><article class="metric-card"><small>REPOSITORIES</small><strong>{{ dashboard?.repositories.total ?? repositories.length }}</strong><span>登记开发仓库</span></article><article class="metric-card"><small>DEMANDS</small><strong>{{ dashboard?.demands.total ?? demands.length }}</strong><span>隔离 Worktree</span></article><article class="metric-card"><small>KNOWLEDGE</small><strong>{{ dashboard?.knowledge.documents ?? 0 }}</strong><span>可读文档</span></article><article class="metric-card"><small>SKILLS</small><strong>{{ dashboard?.skills.available ?? 0 }}</strong><span>可调用能力</span></article></div>
          <div class="workspace-grid"><article class="info-card repository-card"><div class="repository-card-head"><div><div class="card-kicker">REPOSITORIES</div><h3>开发根目录</h3></div><span class="repository-summary">{{ repositories.length }} 个项目</span></div><div v-if="repositories.length" class="repository-list" role="list" aria-label="开发仓库"><div v-for="repo in repositories" :key="repo.id" class="repository-row" role="listitem"><div class="repository-copy"><div class="repository-name"><strong>{{ repo.name }}</strong><code v-if="repo.defaultRef">{{ repo.defaultRef }}</code></div><small>{{ repo.path }}</small></div><div class="repository-statuses"><span v-if="repo.dirty" class="repository-status dirty">dirty</span><span v-else class="repository-status clean">clean</span><span v-if="repo.syncStatus === 'pull_failed'" class="repository-status sync-failed">sync failed</span></div></div></div><p v-else class="muted">先添加一个 Git 仓库或目录，再创建 Demand。</p><div class="repository-card-foot"><span>状态由后台扫描更新</span><button class="btn" @click="showAddRepository = true">管理仓库</button></div></article><article class="info-card next-step-card"><div class="card-kicker">NEXT STEP</div><h3>按需求进入执行</h3><p>Demand 为每个仓库创建独立 Worktree，并将可读写根目录注入 Codex policy。</p><button class="btn primary" @click="goTo('demands')">查看需求</button></article></div>
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
        <header class="topbar chat-topbar"><div><button class="back-link" @click="returnToDemandList">‹ 返回需求</button><div class="eyebrow">DEMAND / {{ selectedDemand.branchName }}</div><h1>{{ selectedDemand.name }}</h1><div class="demand-link-actions"><button class="demand-path-link" type="button" :title="`复制 Worktree 路径：${selectedDemand.path}`" :aria-label="`复制 ${selectedDemand.name} 的 Worktree 路径`" @click="copyDemandPath(selectedDemand)"><span>Worktree</span><code>{{ selectedDemand.path }}</code><span class="demand-path-action">{{ copiedDemandPath === selectedDemand.id ? '已复制' : '复制路径' }}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8.5A2.5 2.5 0 0 1 11.5 6H18a2.5 2.5 0 0 1 2.5 2.5V15a2.5 2.5 0 0 1-2.5 2.5h-6.5A2.5 2.5 0 0 1 9 15V8.5Z" /><path d="M15 6V4.5A2.5 2.5 0 0 0 12.5 2H6A2.5 2.5 0 0 0 3.5 4.5V11A2.5 2.5 0 0 0 6 13.5H9" /></svg></button><button class="demand-deep-link" type="button" :title="`复制需求链接：${demandUrl(selectedDemand)}`" :aria-label="`复制 ${selectedDemand.name} 的需求链接`" @click="copyDemandLink(selectedDemand)">{{ copiedDemandLink === selectedDemand.id ? '已复制链接' : '复制需求链接' }}</button></div></div><div class="topbar-actions"><span :class="['socket-pill', socketState]">{{ socketLabel }}</span><button class="btn" @click="openBindConversation">绑定 Thread</button><button class="btn" :disabled="creatingConversation" @click="createConversation">{{ creatingConversation ? '创建中…' : '＋ 新会话' }}</button></div></header>
        <div class="chat-layout">
          <aside class="conversation-sidebar"><div class="conversation-head"><div><div class="card-kicker">SESSIONS</div><strong>会话</strong></div></div><div class="conversation-demand"><strong>{{ selectedDemand.name }}</strong><small>{{ selectedDemand.repositories.map((repo) => repo.name).join(' · ') || '尚未添加 Repo' }}</small></div><div class="conversation-list" role="list" aria-label="Demand 会话"><div v-for="conversation in conversations" :key="conversation.id" class="conversation-row-wrap" role="listitem"><button :class="['conversation-row', { active: conversation.id === selectedConversation?.id }]" @click="openConversation(conversation)"><span :class="['conversation-status', conversation.status]" /><span><strong>{{ conversation.title }}</strong><small>{{ statusLabel(conversation.status) }}</small></span></button><button class="conversation-delete" type="button" :disabled="!canDeleteConversation(conversation)" :title="deleteConversationTitle(conversation)" :aria-label="`删除会话：${conversation.title}`" @click.stop="requestDeleteConversation(conversation)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" /></svg></button></div></div></aside>
          <section class="chat-main">
            <div ref="scrollArea" class="chat-scroll" @scroll="onScroll">
              <button v-if="hiddenConversationEntryCount > 0" class="chat-history-button" type="button" @click="showEarlierConversationEntries">显示更早的 {{ Math.min(hiddenConversationEntryCount, 80) }} 项</button>
              <CodyConversation variant="embedded" :entries="sharedConversationEntries" @copy="copyConversationText" @resolve-approval="resolveTimelineApproval" @resolve-question="resolveTimelineQuestion"><template #empty><div class="chat-empty"><span class="workspace-large-mark">CW</span><h2>开始这个需求的开发</h2><p>描述目标即可。Codex 会看到当前 Demand 的 Worktree、策略和上下文。</p></div></template></CodyConversation>
            </div>
            <button v-if="conversationScrollState?.isAtBottom === false" class="chat-scroll-bottom" type="button" aria-label="回到最新消息" @click="scrollToBottom(true)">↓</button>
            <div class="composer">
              <div class="composer-hint">{{ selectedCollaborationModeKind === 'plan' ? 'Plan 模式：本次 Turn 先澄清和规划，再确认执行。' : '当前消息只会在该 Demand 的 Worktree 内执行。' }}</div><CodyComposer variant="embedded" :draft="draft" :disabled="sending" :is-running="isRunning" :collaboration-modes="composerCollaborationModes" :selected-collaboration-mode="selectedCollaborationMode" :submit-modes="composerSubmitModes" :selected-submit-mode="selectedSubmitMode" :models="composerModels" :selected-model="selectedModel" :reasoning-options="composerReasoningOptions" :selected-reasoning="selectedReasoning" :permission-options="composerPermissionOptions" :selected-permission="permission" :skills="composerSkills" :selected-skills="selectedSkillsForTurn" :placeholder="isRunning ? (selectedSubmitMode === 'steer' ? '描述引导…（Enter 发送给当前 Turn）' : '描述下一步…（Enter 排队，Shift + Enter 换行）') : '描述你希望完成的事情…（Enter 发送，Shift + Enter 换行）'" @update:draft="updateDraft" @update:collaboration-mode="selectCollaborationMode" @update:submit-mode="selectedSubmitMode = $event === 'steer' ? 'steer' : 'queue'" @update:model="selectedModel = $event" @update:reasoning="selectReasoning" @update:permission="selectPermission" @update:selected-skills="selectedSkillsForTurn = $event" @send="sendMessage" @stop="interrupt" />
            </div>
          </section>
        </div>
      </section>
    </main>

    <WorkspaceSetupDialog :visible="showCreateWorkspace" @close="showCreateWorkspace = false" @completed="workspaceCreated" />
    <div v-if="showCreateDemand" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">NEW DEMAND</div><h2>创建隔离需求</h2></div><button class="icon-button" @click="showCreateDemand = false">×</button></div><label>需求名</label><input v-model="demandName" class="input" placeholder="例如：统一 AI 工作对话" /><label>分支名</label><input v-model="demandBranch" class="input" placeholder="可选，默认按需求名生成" /><label>开发 Repo</label><div class="repo-picker"><label v-for="repo in repositories" :key="repo.id" class="repo-option"><input v-model="selectedRepositoryIds" type="checkbox" :value="repo.id" /><span><strong>{{ repo.name }}</strong><small>{{ repo.path }}</small></span></label></div><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showCreateDemand = false">取消</button><button class="btn primary" :disabled="creating || !demandName.trim() || selectedRepositoryIds.length === 0" @click="createDemand">创建并进入</button></div></section></div>
    <div v-if="showAddRepository" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">REPOSITORY</div><h2>添加开发 Repo</h2></div><button class="icon-button" @click="showAddRepository = false">×</button></div><div class="mode-tabs"><button :class="{ active: repositorySource === 'folder' }" @click="repositorySource = 'folder'">本地目录</button><button :class="{ active: repositorySource === 'git' }" @click="repositorySource = 'git'">Git clone</button></div><label>显示名称</label><input v-model="repositoryName" class="input" placeholder="可选" /><template v-if="repositorySource === 'folder'"><label>仓库目录</label><input v-model="repositoryPath" class="input" placeholder="/Users/you/projects/repository" /><p class="field-help">该 Git 仓库会复制到当前 Workspace 的 <code>services/&lt;名称&gt;</code>。</p></template><template v-else><label>Git URL</label><input v-model="repositoryUrl" class="input" placeholder="git@github.com:org/repository.git" /><p class="field-help">仓库会克隆到当前 Workspace 的 <code>services/&lt;名称&gt;</code>。</p></template><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showAddRepository = false">取消</button><button class="btn primary" :disabled="creating || (repositorySource === 'folder' ? !repositoryPath.trim() : !repositoryUrl.trim())" @click="addRepository">{{ creating ? '正在添加…' : '添加 Repo' }}</button></div></section></div>
    <BindThreadDialog :visible="showBindConversation" :binding="bindingConversation" :loading="threadPickerLoading" :manual-entry="manualThreadEntry" :selected-project="selectedThreadProject" :query="threadQuery" :native-id="boundNativeId" :title="boundConversationTitle" :error="modalError" :can-bind="canBindNativeThread" :all-thread-count="nativeThreads.length" :projects="threadProjects" :threads="filteredNativeThreads" @close="closeBindConversation" @bind="bindConversation" @select="selectNativeThread" @update:manual-entry="manualThreadEntry = $event" @update:selected-project="selectedThreadProject = $event" @update:query="threadQuery = $event" @update:native-id="boundNativeId = $event" @update:title="boundConversationTitle = $event" />
    <div v-if="conversationPendingDelete" class="modal-backdrop"><section class="modal-card delete-conversation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title"><div class="modal-head"><div><div class="eyebrow">REMOVE SESSION</div><h2 id="delete-conversation-title">删除会话？</h2></div><button class="icon-button" aria-label="关闭删除会话弹窗" :disabled="deletingConversation" @click="closeDeleteConversation">×</button></div><p>将从当前 Demand 移除“{{ conversationPendingDelete.title }}”的会话绑定。</p><p class="delete-conversation-note">不会删除原生 Codex Thread 或它的历史；仍可稍后重新绑定并继续。</p><p v-if="deleteConversationError" class="form-error" role="alert">{{ deleteConversationError }}</p><div class="modal-actions"><button class="btn" :disabled="deletingConversation" @click="closeDeleteConversation">取消</button><button class="btn danger" :disabled="deletingConversation" @click="deleteConversation">{{ deletingConversation ? '删除中…' : '删除会话' }}</button></div></section></div>
    <div v-if="workspacePendingDelete" class="modal-backdrop"><section class="modal-card delete-workspace-modal" role="dialog" aria-modal="true" aria-labelledby="delete-workspace-title"><div class="modal-head"><div><div class="eyebrow">REMOVE WORKSPACE</div><h2 id="delete-workspace-title">从 CodyWork 移除 Workspace？</h2></div><button class="icon-button" aria-label="关闭移除 Workspace 弹窗" :disabled="deletingWorkspace" @click="closeDeleteWorkspace">×</button></div><p>将移除“{{ workspacePendingDelete.name }}”在 CodyWork 中的登记，以及关联的 Repo、Demand、会话审计与缓存数据。</p><p class="delete-workspace-note">不会删除 <code>{{ workspacePendingDelete.path }}</code>，也不会删除其中的 Git 仓库、分支或 Worktree。</p><p class="delete-workspace-confirm">这是一次仅作用于 CodyWork 本地记录的操作。确认后可随时重新添加该目录。</p><p v-if="deleteWorkspaceError" class="form-error" role="alert">{{ deleteWorkspaceError }}</p><div class="modal-actions"><button class="btn" :disabled="deletingWorkspace" @click="closeDeleteWorkspace">取消</button><button class="btn danger" :disabled="deletingWorkspace" @click="deleteWorkspace">{{ deletingWorkspace ? '移除中…' : '确认移除' }}</button></div></section></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_VISIBLE_MESSAGE_COUNT,
  buildConversationScrollState,
  hiddenMessageCount,
  nextVisibleMessageCount,
  shouldLockConversationToBottom,
  visibleMessageStartIndex,
  type ConversationScrollState,
} from '@codycodeagent/cody-web-core/conversation'
import { composerHasContent, resolveComposerSubmitMode, type ComposerSubmitMode } from '@codycodeagent/cody-web-core/composer'
import { createReconnectingConversationSocket, type ConversationSubscriptionEvent } from '@codycodeagent/cody-web-core/client'
import { CodyComposer, CodyConversation, conversationEntriesFromState, useConversationController, type CodyComposerOption } from '@codycodeagent/cody-web-core/vue'
import '@codycodeagent/cody-web-core/vue/style.css'
import WorkspaceSetupDialog from './components/WorkspaceSetupDialog.vue'
import WorkbenchSidebar from './components/WorkbenchSidebar.vue'
import BindThreadDialog from './components/BindThreadDialog.vue'
import {
  api,
  type AvailableNativeThread,
  type Conversation,
  type ConversationEvent,
  type ConversationPermissionMode,
  type ComposerOptions,
  type DashboardSnapshot,
  type Demand,
  type KnowledgeDocument,
  type Repository,
  type RuntimeSettings,
  type SkillInstallStatus,
  type Workspace,
  type WorkspaceSkill,
} from './api'
import {
  canDeleteConversation as canDeleteConversationRule,
  collaborationModeOptions,
  conversationStatusAfterEvent,
  conversationStatusLabel as statusLabel,
  dashboardCacheLabel as formatDashboardCacheLabel,
  dashboardNeedsRefresh,
  deleteConversationTitle as deleteConversationTitleRule,
  filterNativeThreads,
  groupThreadProjects,
  matchDemandRoute,
  parseWorkbenchRoute,
  threadTitle,
  workbenchUrl,
  type HistoryMode,
  type ThreadProject,
} from './workbenchUi'
type Page = 'dashboard' | 'demands' | 'knowledge' | 'skills' | 'settings' | 'chat'

const loading = ref(true); const error = ref(''); const modalError = ref(''); const workspaces = ref<Workspace[]>([]); const workspace = ref<Workspace | null>(null); const demands = ref<Demand[]>([]); const repositories = ref<Repository[]>([]); const selectedDemand = ref<Demand | null>(null); const conversations = ref<Conversation[]>([]); const selectedConversation = ref<Conversation | null>(null)
const { state: conversationState, connect: connectConversationState, reset: resetConversationState } = useConversationController()
const draft = ref(''); const sending = ref(false); const permission = ref<ConversationPermissionMode>('workspace-write'); const selectedModel = ref(''); const selectedReasoning = ref('medium'); const selectedSubmitMode = ref<ComposerSubmitMode>('queue'); const selectedCollaborationModeName = ref('default'); const selectedSkillsForTurn = ref<string[]>([]); const runtimeModels = ref<string[]>([]); const runtimeSkills = ref<ComposerOptions['skills']>([]); const runtimeCollaborationModes = ref<Array<{ name: string; mode: 'default' | 'plan'; label: string; model?: string; reasoningEffort?: string }>>([]); const socketState = ref<'open' | 'connecting' | 'closed'>('closed'); const showWorkspacePicker = ref(false); const showCreateWorkspace = ref(false); const showCreateDemand = ref(false); const creating = ref(false); const creatingConversation = ref(false); const importingWorktrees = ref(false); const demandName = ref(''); const demandBranch = ref(''); const selectedRepositoryIds = ref<string[]>([]); const scrollArea = ref<HTMLElement | null>(null); const showBindConversation = ref(false); const bindingConversation = ref(false); const boundNativeId = ref(''); const boundConversationTitle = ref(''); const nativeThreads = ref<AvailableNativeThread[]>([]); const threadPickerLoading = ref(false); const selectedThreadProject = ref(''); const threadQuery = ref(''); const manualThreadEntry = ref(false); const conversationPendingDelete = ref<Conversation | null>(null); const deletingConversation = ref(false); const deleteConversationError = ref(''); const workspacePendingDelete = ref<Workspace | null>(null); const deletingWorkspace = ref(false); const deleteWorkspaceError = ref('')
const lastSubmittedPrompt = ref<string | null>(null)
const activePage = ref<Page>('dashboard'); const dashboard = ref<DashboardSnapshot | null>(null); const dashboardRefreshing = ref(false); const knowledge = ref<KnowledgeDocument[]>([]); const selectedKnowledge = ref<KnowledgeDocument | null>(null); const knowledgeQuery = ref(''); const skills = ref<WorkspaceSkill[]>([]); const selectedSkill = ref<WorkspaceSkill | null>(null); const skillSource = ref(''); const installingSkill = ref(false); const skillJob = ref<SkillInstallStatus | null>(null); const runtime = ref<RuntimeSettings | null>(null); const runtimeCommand = ref(''); const runtimeMessage = ref(''); const testingRuntime = ref(false); const showAddRepository = ref(false); const repositorySource = ref<'folder' | 'git'>('folder'); const repositoryPath = ref(''); const repositoryUrl = ref(''); const repositoryName = ref(''); const demandNavExpanded = ref(true); const copiedDemandPath = ref(''); const copiedDemandLink = ref('')
let copiedDemandPathTimer: number | null = null; let copiedDemandLinkTimer: number | null = null
const conversationScrollState = ref<ConversationScrollState | null>(null)
const visibleConversationEntryCount = ref(DEFAULT_VISIBLE_MESSAGE_COUNT)
const socketLabel = computed(() => socketState.value === 'open' ? '实时连接' : socketState.value === 'connecting' ? '连接中…' : '已断开')
const isRunning = computed(() => Boolean(conversationState.value.activeTurnId))
const allSharedConversationEntries = computed(() => conversationEntriesFromState(conversationState.value))
const hiddenConversationEntryCount = computed(() => hiddenMessageCount(allSharedConversationEntries.value.length, visibleConversationEntryCount.value))
const sharedConversationEntries = computed(() => allSharedConversationEntries.value.slice(
  visibleMessageStartIndex(allSharedConversationEntries.value.length, visibleConversationEntryCount.value),
))
const filteredKnowledge = computed(() => { const query = knowledgeQuery.value.trim().toLowerCase(); return query ? knowledge.value.filter(doc => `${doc.name} ${doc.relativePath}`.toLowerCase().includes(query)) : knowledge.value })
const dashboardCacheLabel = computed(() => formatDashboardCacheLabel(dashboard.value?.cache))
const threadProjects = computed<ThreadProject[]>(() => groupThreadProjects(nativeThreads.value, selectedDemand.value?.repositories.map(repo => repo.worktreePath) ?? []))
const filteredNativeThreads = computed(() => filterNativeThreads(nativeThreads.value, selectedThreadProject.value, threadQuery.value))
const canBindNativeThread = computed(() => manualThreadEntry.value ? Boolean(boundNativeId.value.trim()) : filteredNativeThreads.value.some(thread => thread.nativeId === boundNativeId.value && !thread.bound))
const composerModels = computed<CodyComposerOption[]>(() => runtimeModels.value.map(model => ({ value: model, label: model })))
const composerCollaborationModes = computed<CodyComposerOption[]>(() => collaborationModeOptions(runtimeCollaborationModes.value))
const selectedCollaborationMode = computed(() => {
  return selectedCollaborationModeName.value === 'default' || runtimeCollaborationModes.value.some(mode => mode.name === selectedCollaborationModeName.value)
    ? selectedCollaborationModeName.value
    : 'default'
})
const selectedCollaborationModeKind = computed<'default' | 'plan'>(() => runtimeCollaborationModes.value.find(mode => mode.name === selectedCollaborationMode.value)?.mode ?? (selectedCollaborationMode.value === 'plan' ? 'plan' : 'default'))
const composerSubmitModes = computed<CodyComposerOption[]>(() => [{ value: 'queue', label: '排队', description: '当前 Turn 结束后顺序执行。' }, { value: 'steer', label: '引导', description: '正在执行时发送给当前 Turn。' }])
const composerReasoningOptions = computed<CodyComposerOption[]>(() => [{ value: 'none', label: '无推理' }, { value: 'minimal', label: '极低' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }, { value: 'xhigh', label: '极高' }])
const composerPermissionOptions = computed<CodyComposerOption[]>(() => [{ value: 'read-only', label: '只读', description: '只能读取当前 Demand 的可读根目录。' }, { value: 'workspace-write', label: 'Worktree 写入', description: '仅可写当前 Demand 的 Worktree，危险操作仍须审批。' }, { value: 'yolo', label: 'YOLO', description: '自动批准，但仍不能访问或写入 Worktree 之外。' }])
const composerSkills = computed<CodyComposerOption[]>(() => runtimeSkills.value.map(skill => ({ value: skill.id, label: skill.label, description: skill.description })))

function canDeleteConversation(conversation: Conversation): boolean { return canDeleteConversationRule(conversation, conversations.value.length) }
function deleteConversationTitle(conversation: Conversation): string { return deleteConversationTitleRule(conversation, conversations.value.length) }
function requestDeleteConversation(conversation: Conversation): void { if (!canDeleteConversation(conversation)) { error.value = deleteConversationTitle(conversation); return }; deleteConversationError.value = ''; conversationPendingDelete.value = conversation }
function closeDeleteConversation(): void { if (deletingConversation.value) return; conversationPendingDelete.value = null; deleteConversationError.value = '' }
async function deleteConversation(): Promise<void> {
  const target = conversationPendingDelete.value
  if (!workspace.value || !target || deletingConversation.value) return
  deletingConversation.value = true
  deleteConversationError.value = ''
  try {
    await api.deleteConversation(workspace.value.id, target.id)
    const remaining = conversations.value.filter(conversation => conversation.id !== target.id)
    conversations.value = remaining
    conversationPendingDelete.value = null
    if (selectedConversation.value?.id === target.id) {
      selectedConversation.value = null
      resetConversationState()
      draft.value = ''
      await openConversation(remaining[0]!)
    }
  } catch (cause) { deleteConversationError.value = cause instanceof Error ? cause.message : String(cause) } finally { deletingConversation.value = false }
}
function onScroll(): void {
  const node = scrollArea.value
  if (!node) return
  conversationScrollState.value = buildConversationScrollState({
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    bottomThresholdPx: 16,
  })
}
async function scrollToBottom(force = false): Promise<void> {
  const shouldFollow = force || shouldLockConversationToBottom(conversationScrollState.value)
  if (!shouldFollow) return
  await nextTick()
  const node = scrollArea.value
  if (!node) return
  node.scrollTo({ top: node.scrollHeight, behavior: force ? 'auto' : 'smooth' })
  conversationScrollState.value = { scrollTop: node.scrollHeight, scrollRatio: 1, isAtBottom: true }
}
async function showEarlierConversationEntries(): Promise<void> {
  const node = scrollArea.value
  const previousHeight = node?.scrollHeight ?? 0
  const previousTop = node?.scrollTop ?? 0
  visibleConversationEntryCount.value = nextVisibleMessageCount(
    allSharedConversationEntries.value.length,
    visibleConversationEntryCount.value,
  )
  await nextTick()
  if (node) node.scrollTop = previousTop + Math.max(node.scrollHeight - previousHeight, 0)
}
function routeParams(): { workspaceId: string | null; demandId: string | null } { return parseWorkbenchRoute(window.location.search) }
function demandFromRoute(id: string): Demand | undefined { return matchDemandRoute(demands.value, id) }
function updateRoute(demand: Demand | null, mode: HistoryMode): void {
  if (mode === 'none') return
  const url = workbenchUrl(window.location.href, workspace.value?.id ?? null, demand?.id ?? null)
  const next = `${url.pathname}${url.search}${url.hash}`
  if (mode === 'replace') window.history.replaceState({}, '', next)
  else window.history.pushState({}, '', next)
}
function demandUrl(demand: Demand): string {
  return workbenchUrl(window.location.href, workspace.value?.id ?? null, demand.id).toString()
}
function clearConversationState(): void {
  selectedConversation.value = null
  resetConversationState()
}
let workspaceLoadSequence = 0
async function loadWorkspaces(): Promise<void> {
  const sequence = ++workspaceLoadSequence
  loading.value = true
  error.value = ''
  try {
    const nextWorkspaces = await api.listWorkspaces()
    if (sequence !== workspaceLoadSequence) return
    workspaces.value = nextWorkspaces
    const route = routeParams()
    const active = nextWorkspaces.find((item) => item.id === route.workspaceId)
      ?? nextWorkspaces.find((item) => item.active)
      ?? nextWorkspaces[0]
    if (active) await selectWorkspace(active, { demandId: route.demandId, history: 'replace' })
  } catch (cause) {
    if (sequence === workspaceLoadSequence) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (sequence === workspaceLoadSequence) loading.value = false
  }
}
function goTo(page: Exclude<Page, 'chat'>): void {
  activePage.value = page
  selectedDemand.value = null
  clearConversationState()
  updateRoute(null, 'push')
  if (page === 'dashboard') void refreshDashboard()
  if (page === 'knowledge') void loadKnowledge()
  if (page === 'skills') void loadSkills()
  if (page === 'settings') void loadRuntime()
}
async function selectWorkspace(next: Workspace, options: { demandId?: string | null; history?: HistoryMode } = {}): Promise<void> {
  // The list response is already authoritative enough to restore the shell.  Do
  // this before the optional "open" acknowledgement so a transient POST error
  // can never make an existing Workspace look as if it disappeared.
  workspace.value = next
  workspaces.value = workspaces.value.map((item) => ({ ...item, active: item.id === next.id }))
  showWorkspacePicker.value = false
  activePage.value = 'dashboard'
  selectedDemand.value = null
  clearConversationState()
  try {
    const opened = await api.openWorkspace(next.id)
    workspace.value = opened.workspace
  } catch (cause) {
    error.value = `已恢复 Workspace，但无法同步打开状态：${cause instanceof Error ? cause.message : String(cause)}`
  }
  try {
    const [nextDemands, nextRepositories] = await Promise.all([api.listDemands(next.id), api.listRepositories(next.id)])
    demands.value = nextDemands
    repositories.value = nextRepositories
    await refreshDashboard()
    const requestedDemand = options.demandId ? demandFromRoute(options.demandId) : undefined
    if (requestedDemand) await openDemand(requestedDemand, options.history ?? 'push')
    else {
      activePage.value = 'dashboard'
      updateRoute(null, options.history ?? 'push')
      if (options.demandId) error.value = '链接中的 Demand 不存在，已打开 Workspace 概览。'
    }
  } catch (cause) {
    error.value = `Workspace 已显示，但部分数据加载失败：${cause instanceof Error ? cause.message : String(cause)}`
  }
}
function openDeleteWorkspace(target: Workspace): void {
  if (deletingWorkspace.value) return
  showWorkspacePicker.value = false
  deleteWorkspaceError.value = ''
  workspacePendingDelete.value = target
}
function closeDeleteWorkspace(): void {
  if (deletingWorkspace.value) return
  workspacePendingDelete.value = null
  deleteWorkspaceError.value = ''
}
async function deleteWorkspace(): Promise<void> {
  const target = workspacePendingDelete.value
  if (!target || deletingWorkspace.value) return
  deletingWorkspace.value = true
  deleteWorkspaceError.value = ''
  try {
    await api.deleteWorkspace(target.id)
    const remaining = workspaces.value.filter(item => item.id !== target.id)
    const removedActiveWorkspace = workspace.value?.id === target.id
    workspaces.value = remaining
    workspacePendingDelete.value = null
    if (!removedActiveWorkspace) return
    workspace.value = null
    demands.value = []
    repositories.value = []
    conversations.value = []
    selectedDemand.value = null
    selectedConversation.value = null
    resetConversationState()
    dashboard.value = null
    const next = remaining.find(item => item.active) ?? remaining[0]
    if (next) await selectWorkspace(next)
    else activePage.value = 'dashboard'
  } catch (cause) { deleteWorkspaceError.value = cause instanceof Error ? cause.message : String(cause) } finally { deletingWorkspace.value = false }
}
async function refreshDashboard(): Promise<void> { if (!workspace.value) return; dashboard.value = await api.dashboard(workspace.value.id); if (dashboardNeedsRefresh(dashboard.value.cache)) void requestDashboardRefresh() }
async function requestDashboardRefresh(): Promise<void> {
  if (!workspace.value || dashboardRefreshing.value) return
  const workspaceId = workspace.value.id
  dashboardRefreshing.value = true
  try {
    dashboard.value = await api.refreshDashboard(workspaceId)
    for (let attempt = 0; dashboard.value.cache.state === 'refreshing' && attempt < 120; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 500))
      if (workspace.value?.id !== workspaceId) return
      dashboard.value = await api.dashboard(workspaceId)
    }
    if (workspace.value?.id !== workspaceId) return
    // The dashboard worker is authoritative for repository discovery and
    // automatic existing-worktree adoption. Refresh the shell collections
    // after it settles so the overview cards and demand navigation cannot
    // remain stuck on the pre-scan empty snapshot until a full-page reload.
    const [nextDemands, nextRepositories] = await Promise.all([
      api.listDemands(workspaceId),
      api.listRepositories(workspaceId),
    ])
    if (workspace.value?.id !== workspaceId) return
    demands.value = nextDemands
    repositories.value = nextRepositories
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    dashboardRefreshing.value = false
  }
}
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
  runtimeCommand.value = runtime.value.command
}
async function saveRuntime(): Promise<void> {
  try {
    runtime.value = await api.updateRuntimeSettings({ command: runtimeCommand.value.trim() })
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
      : { source: 'git', url: repositoryUrl.value.trim(), name: repositoryName.value.trim() || undefined })
    repositories.value = [...repositories.value, repository]
    repositoryPath.value = ''; repositoryUrl.value = ''; repositoryName.value = ''
    showAddRepository.value = false
    await refreshDashboard()
  } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false }
}
async function openDemand(demand: Demand, history: HistoryMode = 'push'): Promise<void> { selectedDemand.value = demand; activePage.value = 'chat'; updateRoute(demand, history); await Promise.all([loadComposerOptions(demand.id), loadSkills()]); conversations.value = await api.listConversations(workspace.value!.id, demand.id); if (!conversations.value.length) { const created = await api.createConversation(workspace.value!.id, demand.id); conversations.value = [created] }; await openConversation(conversations.value[0]!) }
function returnToDemandList(): void { selectedDemand.value = null; clearConversationState(); activePage.value = 'demands'; updateRoute(null, 'push') }
async function restoreRoute(): Promise<void> {
  const route = routeParams()
  const nextWorkspace = workspaces.value.find((item) => item.id === route.workspaceId) ?? workspace.value
  if (!nextWorkspace) return
  if (workspace.value?.id !== nextWorkspace.id) { await selectWorkspace(nextWorkspace, { demandId: route.demandId, history: 'none' }); return }
  if (route.demandId) {
    const demand = demandFromRoute(route.demandId)
    if (demand && selectedDemand.value?.id !== demand.id) await openDemand(demand, 'none')
    else if (!demand) error.value = '链接中的 Demand 不存在。'
    return
  }
  selectedDemand.value = null
  clearConversationState()
  activePage.value = 'dashboard'
}
function applyConversationLifecycle(conversationId: string, event: ConversationEvent): void {
  if (event.type === 'turn.failed') {
    const reason = String(event.data.error ?? 'Codex 未能完成本次回复。')
    const sentenceReason = reason.replace(/[。.!！?？]+$/u, '')
    if (lastSubmittedPrompt.value && !draft.value.trim()) {
      draft.value = lastSubmittedPrompt.value
      error.value = `Codex 本次连接中断：${sentenceReason}。原始消息已放回输入框，请确认后重试。`
    } else error.value = `Codex 本次连接中断：${reason}`
    lastSubmittedPrompt.value = null
  } else if (event.type === 'turn.completed' || event.type === 'turn.interrupted') lastSubmittedPrompt.value = null
  conversations.value = conversations.value.map(item => item.id === conversationId ? {
    ...item,
    status: conversationStatusAfterEvent(item.status, event.type),
  } : item)
  if (selectedConversation.value?.id === conversationId) selectedConversation.value = conversations.value.find(item => item.id === conversationId) ?? selectedConversation.value
}
async function connect(conversation: Conversation): Promise<void> {
  visibleConversationEntryCount.value = DEFAULT_VISIBLE_MESSAGE_COUNT
  conversationScrollState.value = null
  const workspaceId = workspace.value!.id
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.host || '127.0.0.1:3211'
  await connectConversationState(conversation.nativeId, {
    read: async () => (await api.conversationHistory(workspaceId, conversation.id)).events,
    subscribe: (_threadId, listener) => {
      const realtime = createReconnectingConversationSocket({
        url: `${protocol}://${host}/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversation.id)}/events`,
        parse(data): ConversationSubscriptionEvent | null {
          try {
            const payload = JSON.parse(String(data)) as { type?: string; event?: ConversationEvent }
            if (payload.type !== 'event' || !payload.event) return null
            applyConversationLifecycle(conversation.id, payload.event)
            return { type: 'event', event: payload.event }
          } catch { error.value = '收到无法识别的 Runtime 事件'; return null }
        },
        listener(value) {
          socketState.value = value.type === 'connected' ? 'open' : value.type === 'disconnected' ? 'closed' : socketState.value
          listener(value)
        },
      })
      socketState.value = 'connecting'
      return () => realtime.close()
    },
  })
}
async function openConversation(conversation: Conversation): Promise<void> { selectedConversation.value = conversation; permission.value = conversation.permissionMode; selectedCollaborationModeName.value = 'default'; lastSubmittedPrompt.value = null; error.value = ''; await connect(conversation); await scrollToBottom(true) }
async function workspaceCreated(created: Workspace): Promise<void> {
  showCreateWorkspace.value = false
  const nextWorkspaces = await api.listWorkspaces()
  workspaces.value = nextWorkspaces
  const target = nextWorkspaces.find(item => item.id === created.id) ?? created
  await selectWorkspace(target, { history: 'push' })
}
async function importExistingWorktrees(): Promise<void> { if (!workspace.value || importingWorktrees.value) return; importingWorktrees.value = true; try { const result = await api.importExistingWorktrees(workspace.value.id); demands.value = await api.listDemands(workspace.value.id); await refreshDashboard(); error.value = result.imported.length ? `已导入 ${result.imported.length} 个已有 Demand。` : result.skipped.length ? `没有可导入的 Worktree：${result.skipped[0]!.reason}` : '没有发现尚未导入的 Worktree。' } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { importingWorktrees.value = false } }
async function createDemand(): Promise<void> { if (!workspace.value) return; creating.value = true; modalError.value = ''; try { const created = await api.createDemand(workspace.value.id, { name: demandName.value.trim(), ...(demandBranch.value.trim() ? { branchName: demandBranch.value.trim() } : {}), repositoryIds: selectedRepositoryIds.value }); demands.value = await api.listDemands(workspace.value.id); showCreateDemand.value = false; demandName.value = ''; demandBranch.value = ''; selectedRepositoryIds.value = []; const demand = demands.value.find((item) => item.id === created.demand.id); if (demand) await openDemand(demand) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false } }
async function createConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value || creatingConversation.value) return; creatingConversation.value = true; error.value = ''; try { const created = await api.createConversation(workspace.value.id, selectedDemand.value.id); conversations.value = [created, ...conversations.value]; await openConversation(created) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { creatingConversation.value = false } }
async function openBindConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value) return; modalError.value = ''; boundNativeId.value = ''; boundConversationTitle.value = ''; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false; showBindConversation.value = true; threadPickerLoading.value = true; try { nativeThreads.value = await api.listAvailableNativeThreads(workspace.value.id, selectedDemand.value.id) } catch (cause) { nativeThreads.value = []; modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { threadPickerLoading.value = false } }
function closeBindConversation(): void { if (bindingConversation.value) return; showBindConversation.value = false; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false }
function selectNativeThread(thread: AvailableNativeThread): void { if (thread.bound) return; boundNativeId.value = thread.nativeId; if (!boundConversationTitle.value.trim()) boundConversationTitle.value = threadTitle(thread) }
async function bindConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value || bindingConversation.value || !canBindNativeThread.value) return; bindingConversation.value = true; modalError.value = ''; try { const created = await api.bindConversation(workspace.value.id, selectedDemand.value.id, { nativeId: boundNativeId.value.trim(), ...(boundConversationTitle.value.trim() ? { title: boundConversationTitle.value.trim() } : {}) }); conversations.value = [created, ...conversations.value]; showBindConversation.value = false; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false; boundNativeId.value = ''; boundConversationTitle.value = ''; await openConversation(created) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { bindingConversation.value = false } }
async function sendMessage(): Promise<void> { if (!workspace.value || !selectedConversation.value || sending.value) return; const content = draft.value.trim(); const turnSkills = [...selectedSkillsForTurn.value]; if (!composerHasContent({ text: content, skills: turnSkills })) return; draft.value = ''; sending.value = true; try { await api.sendMessage(workspace.value.id, selectedConversation.value.id, content, resolveComposerSubmitMode(isRunning.value, selectedSubmitMode.value), { ...(selectedModel.value ? { model: selectedModel.value } : {}), ...(selectedReasoning.value ? { reasoningEffort: selectedReasoning.value } : {}), collaborationMode: selectedCollaborationModeKind.value, ...(turnSkills.length ? { skills: turnSkills } : {}) }); selectedSkillsForTurn.value = []; lastSubmittedPrompt.value = content } catch (cause) { draft.value = content; selectedSkillsForTurn.value = turnSkills; error.value = cause instanceof Error ? cause.message : String(cause) } finally { sending.value = false } }
function updateDraft(value: string): void { draft.value = value }
async function savePermission(): Promise<void> { if (!workspace.value || !selectedConversation.value) return; try { const updated = await api.setConversationPermission(workspace.value.id, selectedConversation.value.id, permission.value); selectedConversation.value = updated; conversations.value = conversations.value.map((item) => item.id === updated.id ? updated : item) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } }
async function loadComposerOptions(demandId: string): Promise<void> { if (!workspace.value) return; try { const options = await api.composerOptions(workspace.value.id, demandId); runtimeModels.value = options.models; runtimeSkills.value = options.skills; runtimeCollaborationModes.value = options.collaborationModes; selectedSkillsForTurn.value = selectedSkillsForTurn.value.filter(id => options.skills.some(skill => skill.id === id)); if (!selectedModel.value && options.models.length) selectedModel.value = options.models[0]! } catch { runtimeModels.value = []; runtimeSkills.value = []; runtimeCollaborationModes.value = []; selectedSkillsForTurn.value = [] } }
function selectCollaborationMode(name: string): void {
  const next = runtimeCollaborationModes.value.find(mode => mode.name === name) ?? (name === 'plan'
    ? { name, mode: 'plan' as const, label: 'Plan' }
    : { name, mode: 'default' as const, label: 'Default' })
  selectedCollaborationModeName.value = next.name
  if (next.model) selectedModel.value = next.model
  if (next.reasoningEffort) selectedReasoning.value = next.reasoningEffort
}
function selectReasoning(value: string): void { if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)) selectedReasoning.value = value }
async function selectPermission(value: string): Promise<void> { if (value !== 'read-only' && value !== 'workspace-write' && value !== 'yolo') return; const previous = permission.value; permission.value = value; await savePermission(); if (error.value) permission.value = previous }
async function interrupt(): Promise<void> { if (workspace.value && selectedConversation.value) await api.interruptConversation(workspace.value.id, selectedConversation.value.id) }
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch { /* HTTP origins can deny the async Clipboard API; fall back below. */ }
  const fallback = document.createElement('textarea')
  fallback.value = text
  fallback.setAttribute('readonly', '')
  fallback.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.append(fallback)
  fallback.select()
  const copied = document.execCommand('copy')
  fallback.remove()
  if (!copied) throw new Error('clipboard unavailable')
}
async function copyConversationText(text: string): Promise<void> { try { await copyText(text) } catch { error.value = '复制失败，请手动选择内容。' } }
async function copyDemandPath(demand: Demand): Promise<void> {
  try {
    await copyText(demand.path)
    copiedDemandPath.value = demand.id
    if (copiedDemandPathTimer !== null) window.clearTimeout(copiedDemandPathTimer)
    copiedDemandPathTimer = window.setTimeout(() => { copiedDemandPath.value = '' }, 1_800)
  } catch { error.value = '复制 Worktree 路径失败，请手动选择路径。' }
}
async function copyDemandLink(demand: Demand): Promise<void> {
  try {
    await copyText(demandUrl(demand))
    copiedDemandLink.value = demand.id
    if (copiedDemandLinkTimer !== null) window.clearTimeout(copiedDemandLinkTimer)
    copiedDemandLinkTimer = window.setTimeout(() => { copiedDemandLink.value = '' }, 1_800)
  } catch { error.value = '复制需求链接失败，请从浏览器地址栏复制。' }
}
async function resolveTimelineApproval(requestId: string, decision: 'accept' | 'decline'): Promise<void> { if (!workspace.value || !selectedConversation.value) return; await api.resolveApproval(workspace.value.id, selectedConversation.value.id, requestId, decision === 'accept' ? 'allowed-once' : 'rejected') }
async function resolveTimelineQuestion(requestId: string, answer: Record<string, { answers: string[] }>): Promise<void> { if (!workspace.value || !selectedConversation.value) return; await api.answerQuestion(workspace.value.id, selectedConversation.value.id, requestId, answer) }
watch(() => conversationState.value.appliedEventIds.length, () => { void scrollToBottom() })
let dashboardTimer: number | null = null
onMounted(() => { void loadWorkspaces(); window.addEventListener('popstate', () => { void restoreRoute() }); dashboardTimer = window.setInterval(() => { if (activePage.value === 'dashboard' && document.visibilityState === 'visible') void requestDashboardRefresh() }, 5 * 60_000) })
onBeforeUnmount(() => { if (copiedDemandPathTimer !== null) window.clearTimeout(copiedDemandPathTimer); if (copiedDemandLinkTimer !== null) window.clearTimeout(copiedDemandLinkTimer); if (dashboardTimer !== null) window.clearInterval(dashboardTimer) })
</script>
