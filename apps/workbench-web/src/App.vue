<template>
  <div class="app-shell codywork-vue" data-testid="codywork-app">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">CW</span><span><strong>CodyWork</strong><small>Codex workbench</small></span></div>
      <div class="sidebar-scroll">
      <template v-if="workspace">
        <div class="switcher-wrap"><button class="switcher" @click="showWorkspacePicker = !showWorkspacePicker"><span class="folder-mark">{{ workspace.name.slice(0, 1).toUpperCase() }}</span><span class="switcher-copy"><strong>{{ workspace.name }}</strong><small>{{ workspace.path }}</small></span><span class="switcher-action">切换</span></button>
        <div v-if="showWorkspacePicker" class="switcher-menu"><div v-for="item in workspaces" :key="item.id" class="workspace-picker-row"><button class="workspace-picker-select" :class="{ selected: item.id === workspace?.id }" @click="selectWorkspace(item)"><span class="folder-mark small">{{ item.name.slice(0, 1).toUpperCase() }}</span><span><strong>{{ item.name }}</strong><small>{{ item.path }}</small></span></button><button class="workspace-picker-remove" type="button" :aria-label="`从 CodyWork 移除 ${item.name}`" @click.stop="openDeleteWorkspace(item)">移除</button></div><button class="menu-create" @click="showCreateWorkspace = true">＋ 创建 Workspace</button></div></div>
        <div class="sidebar-section-label"><span>WORKSPACE</span><small>上下文与资产</small></div>
        <button class="sidebar-item" :class="{ active: activePage === 'dashboard' }" @click="goTo('dashboard')"><span>◫</span><span class="sidebar-label"><strong>概览</strong><small>健康度与进展</small></span></button>
        <button class="sidebar-item" :class="{ active: activePage === 'knowledge' }" @click="goTo('knowledge')"><span>▤</span><span class="sidebar-label"><strong>知识库</strong><small>规范与文档</small></span></button>
        <button class="sidebar-item" :class="{ active: activePage === 'skills' }" @click="goTo('skills')"><span>✦</span><span class="sidebar-label"><strong>Skills</strong><small>Agent 可用能力</small></span></button>
        <section class="sidebar-demand-section" aria-label="需求列表">
          <button class="sidebar-section-label sidebar-accordion-trigger" :class="{ expanded: demandNavExpanded }" type="button" :aria-expanded="demandNavExpanded" aria-controls="sidebar-demand-list" @click="toggleDemandNav"><span>WORK MODE</span><small>Demand / Worktree</small><em>{{ demands.length }}</em><i class="sidebar-accordion-chevron" aria-hidden="true">⌄</i></button>
          <div v-show="demandNavExpanded" id="sidebar-demand-list" class="sidebar-subnav">
            <button class="sidebar-subnav-item all-demands" :class="{ active: activePage === 'demands' }" @click="goTo('demands')"><span class="subnav-rail-icon" aria-hidden="true">▦</span><span><strong>全部需求</strong><small>查看和管理 Worktree</small></span></button>
            <button v-for="demand in demands" :key="demand.id" v-memo="[demand.id, demand.name, demand.branchName, demand.status, selectedDemand?.id, activePage]" class="sidebar-subnav-item" :class="{ active: activePage === 'chat' && demand.id === selectedDemand?.id }" @click="openDemand(demand)"><span :class="['subnav-status', demand.status]" /><span><strong>{{ demand.name }}</strong><small>{{ demand.branchName }}</small></span><em :class="['demand-status-tag', demand.status]">{{ demandStatusLabel(demand.status) }}</em></button>
            <button v-if="demands.length === 0" class="sidebar-subnav-empty" @click="showCreateDemand = true">还没有需求，创建第一个 Worktree</button>
          </div>
          <button v-show="demandNavExpanded" class="sidebar-new-demand" @click="showCreateDemand = true"><span aria-hidden="true">＋</span> 新建需求</button>
        </section>
      </template>
      <template v-else><div class="sidebar-section-label"><span>WORKSPACES</span><small>开始开发</small></div><button class="sidebar-item active" @click="showCreateWorkspace = true"><span>＋</span><span class="sidebar-label"><strong>创建 Workspace</strong><small>目录或 Git 仓库</small></span></button></template>
      </div>
      <div class="sidebar-spacer" />
      <button class="sidebar-item" :class="{ active: activePage === 'settings' }" @click="goTo('settings')"><span>⚙</span><span class="sidebar-label"><strong>Codex Runtime</strong><small>连接与诊断</small></span></button>
      <div class="sidebar-note"><span class="status-dot" :class="socketState" /><span><strong>{{ socketState === 'open' ? 'Realtime connected' : 'Codex ready' }}</strong><small>{{ workspace ? 'Worktree policy enforced' : '选择一个 Workspace 开始' }}</small></span></div>
    </aside>

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
        <header class="topbar chat-topbar"><div><button class="back-link" @click="returnToDemandList">‹ 返回需求</button><div class="eyebrow">DEMAND / {{ selectedDemand.branchName }}</div><h1>{{ selectedDemand.name }}</h1><div class="demand-link-actions"><button class="demand-path-link" type="button" :title="`复制 Worktree 路径：${selectedDemand.path}`" :aria-label="`复制 ${selectedDemand.name} 的 Worktree 路径`" @click="copyDemandPath(selectedDemand)"><span>Worktree</span><code>{{ selectedDemand.path }}</code><span class="demand-path-action">{{ copiedDemandPath === selectedDemand.id ? '已复制' : '复制路径' }}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8.5A2.5 2.5 0 0 1 11.5 6H18a2.5 2.5 0 0 1 2.5 2.5V15a2.5 2.5 0 0 1-2.5 2.5h-6.5A2.5 2.5 0 0 1 9 15V8.5Z" /><path d="M15 6V4.5A2.5 2.5 0 0 0 12.5 2H6A2.5 2.5 0 0 0 3.5 4.5V11A2.5 2.5 0 0 0 6 13.5H9" /></svg></button><button class="demand-deep-link" type="button" :title="`复制需求链接：${demandUrl(selectedDemand)}`" :aria-label="`复制 ${selectedDemand.name} 的需求链接`" @click="copyDemandLink(selectedDemand)">{{ copiedDemandLink === selectedDemand.id ? '已复制链接' : '复制需求链接' }}</button></div></div><div class="topbar-actions"><span :class="['socket-pill', socketState]">{{ socketLabel }}</span><button class="btn" @click="openBindConversation">绑定 Thread</button><button class="btn" @click="createConversation">＋ 新会话</button></div></header>
        <div class="chat-layout">
          <aside class="conversation-sidebar"><div class="conversation-head"><div><div class="card-kicker">SESSIONS</div><strong>会话</strong></div></div><div class="conversation-demand"><strong>{{ selectedDemand.name }}</strong><small>{{ selectedDemand.repositories.map((repo) => repo.name).join(' · ') || '尚未添加 Repo' }}</small></div><div class="conversation-list" role="list" aria-label="Demand 会话"><div v-for="conversation in conversations" :key="conversation.id" class="conversation-row-wrap" role="listitem"><button :class="['conversation-row', { active: conversation.id === selectedConversation?.id }]" @click="openConversation(conversation)"><span :class="['conversation-status', conversation.status]" /><span><strong>{{ conversation.title }}</strong><small>{{ statusLabel(conversation.status) }}</small></span></button><button class="conversation-delete" type="button" :disabled="!canDeleteConversation(conversation)" :title="deleteConversationTitle(conversation)" :aria-label="`删除会话：${conversation.title}`" @click.stop="requestDeleteConversation(conversation)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" /></svg></button></div></div></aside>
          <section class="chat-main">
            <div v-if="selectedConversation?.goal?.objective" class="chat-toolbar"><span class="goal-chip">Goal · {{ selectedConversation.goal.objective }}</span></div>
            <div ref="scrollArea" class="chat-scroll" @scroll="onScroll">
              <CodyConversation variant="embedded" :entries="sharedConversationEntries" @copy="copyConversationText" @resolve-approval="resolveTimelineApproval"><template #empty><div class="chat-empty"><span class="workspace-large-mark">CW</span><h2>开始这个需求的开发</h2><p>描述目标即可。Codex 会看到当前 Demand 的 Worktree、策略和上下文。</p></div></template></CodyConversation>
              <article v-if="liveStatus" class="live-overlay-inline"><strong>{{ liveStatus }}</strong><span>{{ socketState === 'open' ? '实时更新中' : '等待恢复连接' }}</span></article>
            </div>
            <div class="composer">
              <section v-if="pendingApproval" class="approval-takeover"><div class="approval-takeover-head"><strong>需要你的确认</strong><span>Agent 暂停等待</span></div><p>{{ approvalText }}</p><div class="approval-actions"><button class="btn primary" @click="resolveApproval('allowed-once')">允许一次</button><button class="btn" @click="resolveApproval('rejected')">拒绝</button></div></section>
              <section v-else-if="pendingQuestion" class="approval-takeover"><div class="approval-takeover-head"><strong>Agent 需要补充信息</strong><span>回答后继续</span></div><p>{{ questionText }}</p><div class="question-actions"><input v-model="questionAnswer" class="input" placeholder="输入回答…" @keyup.enter="resolveQuestion" /><button class="btn primary" :disabled="!questionAnswer.trim()" @click="resolveQuestion">提交回答</button></div></section>
              <template v-else><div class="composer-hint">{{ selectedConversation?.plan?.active ? 'Plan 模式：先澄清和规划，再确认执行。' : '当前消息只会在该 Demand 的 Worktree 内执行。' }}</div><CodyComposer variant="embedded" :draft="draft" :disabled="sending" :is-running="isRunning" :collaboration-modes="composerCollaborationModes" :selected-collaboration-mode="selectedCollaborationMode" :submit-modes="composerSubmitModes" :selected-submit-mode="selectedSubmitMode" :models="composerModels" :selected-model="selectedModel" :reasoning-options="composerReasoningOptions" :selected-reasoning="selectedReasoning" :permission-options="composerPermissionOptions" :selected-permission="permission" :skills="composerSkills" :selected-skills="selectedSkillsForTurn" :placeholder="isRunning ? (selectedSubmitMode === 'guide' ? '描述引导…（Enter 发送给当前 Turn）' : '描述下一步…（Enter 排队，Shift + Enter 换行）') : '描述你希望完成的事情…（Enter 发送，Shift + Enter 换行）'" @update:draft="updateDraft" @update:collaboration-mode="selectCollaborationMode" @update:submit-mode="selectedSubmitMode = $event === 'guide' ? 'guide' : 'queue'" @update:model="selectedModel = $event" @update:reasoning="selectReasoning" @update:permission="selectPermission" @update:selected-skills="selectedSkillsForTurn = $event" @send="sendMessage" @stop="interrupt" /></template>
            </div>
          </section>
        </div>
      </section>
    </main>

    <div v-if="showCreateWorkspace" class="modal-backdrop"><section class="modal-card workspace-setup-modal"><div class="modal-head"><div><div class="eyebrow">NEW WORKSPACE</div><h2>创建 Workspace</h2></div><button class="icon-button" :disabled="creating" @click="showCreateWorkspace = false">×</button></div><template v-if="!workspaceSetupJob || workspaceSetupJob.status === 'failed'"><div class="mode-tabs"><button :class="{ active: workspaceMode === 'folder' }" @click="workspaceMode = 'folder'">本地目录</button><button :class="{ active: workspaceMode === 'git' }" @click="workspaceMode = 'git'">Git clone</button></div><label>显示名称</label><input v-model="workspaceName" class="input" placeholder="可选" /><template v-if="workspaceMode === 'folder'"><label>目录路径</label><div class="path-field"><input v-model="workspacePath" class="input" placeholder="/data00/home/you/projects/app" /><button class="btn compact" @click="openDirectoryPicker">选择目录</button></div><p class="field-help">浏览 CodyWork 服务所在机器的允许目录。</p></template><template v-else><label>Git URL</label><input v-model="workspaceGitUrl" class="input" placeholder="git@github.com:org/repo.git" /><label>目标目录</label><div class="path-field"><input v-model="workspacePath" class="input" placeholder="/data00/home/you/projects/repo" /><button class="btn compact" @click="openDirectoryPicker">选择目录</button></div><p class="field-help">浏览 CodyWork 服务所在机器的允许目录。</p></template><label class="setup-choice"><input v-model="useAiWorkspaceSetup" type="checkbox" /><span><strong>交给 AI 检查并准备</strong><small>审阅目录/Git，补齐 CSR 目录、`AGENTS.md` 与 `CONSTITUTION.md`；不会改业务代码，也不会自动创建 Demand 分支。</small></span></label></template><section v-if="workspaceSetupJob" class="workspace-setup-progress" aria-live="polite"><div class="setup-progress-head"><div><span class="card-kicker">AI SETUP</span><strong>{{ workspaceSetupJob.title }}</strong></div><b>{{ workspaceSetupJob.progress }}%</b></div><div class="setup-progress-track"><i :style="{ width: `${workspaceSetupJob.progress}%` }" /></div><ol class="setup-steps"><li :class="{ done: workspaceSetupJob.progress >= 5 }">检查目录与 Git</li><li :class="{ done: workspaceSetupJob.progress >= 25 }">AI 审阅与策略优化</li><li :class="{ done: workspaceSetupJob.progress >= 82 }">复检 Workspace 结构</li><li :class="{ done: workspaceSetupJob.status === 'completed' }">登记并打开</li></ol><details open><summary>发送给 AI 的 Prompt</summary><pre>{{ workspaceSetupJob.prompt }}</pre></details><details :open="Boolean(workspaceSetupJob.response)"><summary>AI Response</summary><pre>{{ workspaceSetupJob.response || '正在等待 AI 输出…' }}</pre></details><details v-if="workspaceSetupJob.events.length"><summary>执行事件（{{ workspaceSetupJob.events.length }}）</summary><ul><li v-for="(event, index) in workspaceSetupJob.events" :key="`${event.timestamp}-${index}`"><code>{{ event.type }}</code><span>{{ event.text }}</span></li></ul></details></section><p v-if="modalError || workspaceSetupJob?.error" class="form-error">{{ workspaceSetupJob?.error || modalError }}</p><div class="modal-actions"><button class="btn" :disabled="creating" @click="showCreateWorkspace = false">{{ workspaceSetupJob?.status === 'completed' ? '完成' : '取消' }}</button><button v-if="workspaceSetupJob?.status === 'failed'" class="btn" @click="workspaceSetupJob = null">重新填写</button><button v-else-if="!workspaceSetupJob" class="btn primary" :disabled="creating || !workspacePath.trim() || (workspaceMode === 'git' && !workspaceGitUrl.trim())" @click="createWorkspace">{{ creating ? (useAiWorkspaceSetup ? 'AI 准备中…' : '正在创建…') : (useAiWorkspaceSetup ? '开始 AI 准备' : '创建并进入') }}</button></div></section></div>
    <div v-if="showDirectoryPicker" class="modal-backdrop directory-picker-backdrop"><section class="modal-card directory-picker"><div class="modal-head"><div><div class="eyebrow">SERVER DIRECTORY</div><h2>选择目录</h2></div><button class="icon-button" @click="showDirectoryPicker = false">×</button></div><p class="directory-help">仅显示 CodyWork 服务所在机器允许访问的目录。选中目录后仍会检查它是否是可用 Workspace。</p><div v-if="directoryListing" class="directory-browser"><div class="directory-roots"><button v-for="root in directoryListing.roots" :key="root.path" class="directory-root" :class="{ active: root.path === directoryListing.current }" @click="browseDirectories(root.path)">{{ root.name }}</button></div><div class="directory-current"><code>{{ directoryListing.current }}</code><button class="btn compact" :disabled="!directoryListing.parent || directoryLoading" @click="browseDirectories(directoryListing.parent!)">上级</button></div><p v-if="directoryError" class="form-error">{{ directoryError }}</p><div v-else-if="directoryLoading" class="directory-loading">正在读取目录…</div><div v-else class="directory-list"><button v-for="entry in directoryListing.directories" :key="entry.path" @click="browseDirectories(entry.path)"><span>▸</span><strong>{{ entry.name }}</strong><code>{{ entry.path }}</code></button><p v-if="directoryListing.directories.length === 0" class="muted">当前目录没有可继续浏览的子目录。</p></div></div><div class="modal-actions"><button class="btn" @click="showDirectoryPicker = false">取消</button><button class="btn primary" :disabled="!directoryListing || directoryLoading" @click="useSelectedDirectory">使用此目录</button></div></section></div>
    <div v-if="showCreateDemand" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">NEW DEMAND</div><h2>创建隔离需求</h2></div><button class="icon-button" @click="showCreateDemand = false">×</button></div><label>需求名</label><input v-model="demandName" class="input" placeholder="例如：统一 AI 工作对话" /><label>分支名</label><input v-model="demandBranch" class="input" placeholder="可选，默认按需求名生成" /><label>开发 Repo</label><div class="repo-picker"><label v-for="repo in repositories" :key="repo.id" class="repo-option"><input v-model="selectedRepositoryIds" type="checkbox" :value="repo.id" /><span><strong>{{ repo.name }}</strong><small>{{ repo.path }}</small></span></label></div><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showCreateDemand = false">取消</button><button class="btn primary" :disabled="creating || !demandName.trim() || selectedRepositoryIds.length === 0" @click="createDemand">创建并进入</button></div></section></div>
    <div v-if="showAddRepository" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">REPOSITORY</div><h2>添加开发 Repo</h2></div><button class="icon-button" @click="showAddRepository = false">×</button></div><div class="mode-tabs"><button :class="{ active: repositorySource === 'folder' }" @click="repositorySource = 'folder'">本地目录</button><button :class="{ active: repositorySource === 'git' }" @click="repositorySource = 'git'">Git clone</button></div><label>显示名称</label><input v-model="repositoryName" class="input" placeholder="可选" /><template v-if="repositorySource === 'folder'"><label>仓库目录</label><input v-model="repositoryPath" class="input" placeholder="/Users/you/projects/repository" /></template><template v-else><label>Git URL</label><input v-model="repositoryUrl" class="input" placeholder="git@github.com:org/repository.git" /><label>目标目录</label><input v-model="repositoryPath" class="input" placeholder="/Users/you/projects/repository" /></template><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showAddRepository = false">取消</button><button class="btn primary" :disabled="creating || !repositoryPath.trim() || (repositorySource === 'git' && !repositoryUrl.trim())" @click="addRepository">{{ creating ? '正在添加…' : '添加 Repo' }}</button></div></section></div>
    <div v-if="showBindConversation" class="modal-backdrop"><section class="modal-card bind-thread-modal" role="dialog" aria-modal="true" aria-labelledby="bind-thread-title"><div class="modal-head"><div><div class="eyebrow">EXISTING CONTEXT</div><h2 id="bind-thread-title">绑定已有 Thread</h2></div><button class="icon-button" aria-label="关闭绑定 Thread 弹窗" @click="closeBindConversation">×</button></div><p class="bind-thread-intro">可先选 Codex 项目，再从其 Thread 中选择；不选项目时会展示全部项目。后续执行仍按当前 Demand 的 Worktree 权限运行。</p><template v-if="!manualThreadEntry"><label for="thread-project">Codex 项目 <span class="optional">可选</span></label><div class="thread-project-select"><select id="thread-project" v-model="selectedThreadProject" aria-label="筛选 Codex 项目"><option value="">全部项目 · {{ nativeThreads.length }}</option><option v-for="project in threadProjects" :key="project.cwd" :value="project.cwd">{{ project.name }} · {{ project.count }}</option></select><small v-if="selectedThreadProject">{{ selectedThreadProject }}</small></div><label for="thread-search">搜索 Thread</label><div class="thread-search"><input id="thread-search" v-model="threadQuery" class="input" autocomplete="off" placeholder="按内容、目录或 Thread ID 搜索…" /><span>{{ filteredNativeThreads.length }}</span></div><div class="thread-picker" role="listbox" aria-label="可绑定的 Codex Thread" :aria-busy="threadPickerLoading"><div v-if="threadPickerLoading" class="thread-picker-loading"><span class="loading-dot" />正在读取最近 Thread…</div><template v-else><button v-for="thread in filteredNativeThreads" :key="thread.nativeId" class="thread-option" :class="{ selected: boundNativeId === thread.nativeId, bound: thread.bound }" :disabled="thread.bound" role="option" :aria-selected="boundNativeId === thread.nativeId" @click="selectNativeThread(thread)"><span class="thread-option-indicator" aria-hidden="true" /><span class="thread-option-copy"><strong>{{ threadTitle(thread) }}</strong><small v-if="thread.cwd">{{ thread.cwd }}</small><code>{{ thread.nativeId }}</code></span><span class="thread-option-meta"><span v-if="thread.bound" class="thread-status bound">已绑定</span><span v-else-if="thread.source" class="thread-status">{{ thread.source }}</span><small v-if="thread.updatedAt">{{ formatThreadTime(thread.updatedAt) }}</small></span></button><p v-if="filteredNativeThreads.length === 0" class="thread-picker-empty">该项目下没有匹配的 Thread。可切换到全部项目、修改搜索词，或手动输入。</p></template></div><button class="text-button" @click="manualThreadEntry = true">列表里没有？手动输入 Thread ID</button></template><template v-else><button class="text-button" @click="manualThreadEntry = false">‹ 返回 Thread 列表</button><label for="bind-native-id">Thread / Session ID</label><input id="bind-native-id" v-model="boundNativeId" class="input" autocomplete="off" placeholder="例如：019f92ff-c3f3-7ec0-a67e-4bac046a9f37" @keyup.enter="bindConversation" /></template><label for="bind-title">显示名称 <span class="optional">可选</span></label><input id="bind-title" v-model="boundConversationTitle" class="input" autocomplete="off" placeholder="例如：钱效 V2 继续开发" @keyup.enter="bindConversation" /><p class="field-help">不会复制历史消息到 CodyWork；已绑定到任何 Demand 的 Thread 不能再次选择。</p><p v-if="modalError" class="form-error" role="alert">{{ modalError }}</p><div class="modal-actions"><button class="btn" :disabled="bindingConversation" @click="closeBindConversation">取消</button><button class="btn primary" :disabled="bindingConversation || !canBindNativeThread" @click="bindConversation">{{ bindingConversation ? '正在绑定…' : '绑定并继续' }}</button></div></section></div>
    <div v-if="conversationPendingDelete" class="modal-backdrop"><section class="modal-card delete-conversation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title"><div class="modal-head"><div><div class="eyebrow">REMOVE SESSION</div><h2 id="delete-conversation-title">删除会话？</h2></div><button class="icon-button" aria-label="关闭删除会话弹窗" :disabled="deletingConversation" @click="closeDeleteConversation">×</button></div><p>将从 CodyWork 删除“{{ conversationPendingDelete.title }}”的会话记录、消息和执行事件。</p><p class="delete-conversation-note">不会删除原生 Codex Thread；它仍可在原来的 Codex 项目中继续使用。</p><p v-if="deleteConversationError" class="form-error" role="alert">{{ deleteConversationError }}</p><div class="modal-actions"><button class="btn" :disabled="deletingConversation" @click="closeDeleteConversation">取消</button><button class="btn danger" :disabled="deletingConversation" @click="deleteConversation">{{ deletingConversation ? '删除中…' : '删除会话' }}</button></div></section></div>
    <div v-if="workspacePendingDelete" class="modal-backdrop"><section class="modal-card delete-workspace-modal" role="dialog" aria-modal="true" aria-labelledby="delete-workspace-title"><div class="modal-head"><div><div class="eyebrow">REMOVE WORKSPACE</div><h2 id="delete-workspace-title">从 CodyWork 移除 Workspace？</h2></div><button class="icon-button" aria-label="关闭移除 Workspace 弹窗" :disabled="deletingWorkspace" @click="closeDeleteWorkspace">×</button></div><p>将移除“{{ workspacePendingDelete.name }}”在 CodyWork 中的登记，以及关联的 Repo、Demand、会话审计与缓存数据。</p><p class="delete-workspace-note">不会删除 <code>{{ workspacePendingDelete.path }}</code>，也不会删除其中的 Git 仓库、分支或 Worktree。</p><p class="delete-workspace-confirm">这是一次仅作用于 CodyWork 本地记录的操作。确认后可随时重新添加该目录。</p><p v-if="deleteWorkspaceError" class="form-error" role="alert">{{ deleteWorkspaceError }}</p><div class="modal-actions"><button class="btn" :disabled="deletingWorkspace" @click="closeDeleteWorkspace">取消</button><button class="btn danger" :disabled="deletingWorkspace" @click="deleteWorkspace">{{ deletingWorkspace ? '移除中…' : '确认移除' }}</button></div></section></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createConversationState, type ConversationState } from '@codycodeagent/cody-web-core/conversation'
import { createConversationController, createReconnectingConversationSocket, type ConversationController, type ConversationSubscriptionEvent } from '@codycodeagent/cody-web-core/client'
import { CodyComposer, CodyConversation, conversationEntriesFromState, type CodyComposerOption } from '@codycodeagent/cody-web-core/vue'
import '@codycodeagent/cody-web-core/vue/style.css'
import {
  api,
  type AvailableNativeThread,
  type Conversation,
  type ConversationEvent,
  type ConversationPermissionMode,
  type DashboardSnapshot,
  type DirectoryListing,
  type Demand,
  type KnowledgeDocument,
  type Repository,
  type RuntimeSettings,
  type SkillInstallStatus,
  type Workspace,
  type WorkspaceSetupJob,
  type WorkspaceSkill,
  type WorkspaceSource,
} from './api'
type Page = 'dashboard' | 'demands' | 'knowledge' | 'skills' | 'settings' | 'chat'
type ThreadProject = { cwd: string; name: string; count: number; relatedToDemand: boolean }
type HistoryMode = 'push' | 'replace' | 'none'

const loading = ref(true); const error = ref(''); const modalError = ref(''); const workspaces = ref<Workspace[]>([]); const workspace = ref<Workspace | null>(null); const demands = ref<Demand[]>([]); const repositories = ref<Repository[]>([]); const selectedDemand = ref<Demand | null>(null); const conversations = ref<Conversation[]>([]); const selectedConversation = ref<Conversation | null>(null); const conversationState = ref<ConversationState>(createConversationState())
const draft = ref(''); const sending = ref(false); const permission = ref<ConversationPermissionMode>('workspace-write'); const selectedModel = ref(''); const selectedReasoning = ref('medium'); const selectedSubmitMode = ref<'queue' | 'guide'>('queue'); const selectedSkillsForTurn = ref<string[]>([]); const runtimeModels = ref<string[]>([]); const runtimeCollaborationModes = ref<Array<{ name: string; mode: 'default' | 'plan'; label: string; model?: string; reasoningEffort?: string }>>([]); const socketState = ref<'open' | 'connecting' | 'closed'>('closed'); const showWorkspacePicker = ref(false); const showCreateWorkspace = ref(false); const showDirectoryPicker = ref(false); const directoryListing = ref<DirectoryListing | null>(null); const directoryLoading = ref(false); const directoryError = ref(''); const showCreateDemand = ref(false); const creating = ref(false); const importingWorktrees = ref(false); const workspaceMode = ref<'folder' | 'git'>('folder'); const workspaceName = ref(''); const workspacePath = ref(''); const workspaceGitUrl = ref(''); const useAiWorkspaceSetup = ref(true); const workspaceSetupJob = ref<WorkspaceSetupJob | null>(null); const demandName = ref(''); const demandBranch = ref(''); const selectedRepositoryIds = ref<string[]>([]); const questionAnswer = ref(''); const scrollArea = ref<HTMLElement | null>(null); const showBindConversation = ref(false); const bindingConversation = ref(false); const boundNativeId = ref(''); const boundConversationTitle = ref(''); const nativeThreads = ref<AvailableNativeThread[]>([]); const threadPickerLoading = ref(false); const selectedThreadProject = ref(''); const threadQuery = ref(''); const manualThreadEntry = ref(false); const conversationPendingDelete = ref<Conversation | null>(null); const deletingConversation = ref(false); const deleteConversationError = ref(''); const workspacePendingDelete = ref<Workspace | null>(null); const deletingWorkspace = ref(false); const deleteWorkspaceError = ref('')
const lastSubmittedPrompt = ref<string | null>(null)
const activePage = ref<Page>('dashboard'); const dashboard = ref<DashboardSnapshot | null>(null); const dashboardRefreshing = ref(false); const knowledge = ref<KnowledgeDocument[]>([]); const selectedKnowledge = ref<KnowledgeDocument | null>(null); const knowledgeQuery = ref(''); const skills = ref<WorkspaceSkill[]>([]); const selectedSkill = ref<WorkspaceSkill | null>(null); const skillSource = ref(''); const installingSkill = ref(false); const skillJob = ref<SkillInstallStatus | null>(null); const runtime = ref<RuntimeSettings | null>(null); const runtimeCommand = ref(''); const runtimeMessage = ref(''); const testingRuntime = ref(false); const showAddRepository = ref(false); const repositorySource = ref<'folder' | 'git'>('folder'); const repositoryPath = ref(''); const repositoryUrl = ref(''); const repositoryName = ref(''); const demandNavExpanded = ref(true); const copiedDemandPath = ref(''); const copiedDemandLink = ref('')
let conversationController: ConversationController | null = null; let copiedDemandPathTimer: number | null = null; let copiedDemandLinkTimer: number | null = null; let followBottom = true
const socketLabel = computed(() => socketState.value === 'open' ? '实时连接' : socketState.value === 'connecting' ? '连接中…' : '已断开')
const isRunning = computed(() => Boolean(conversationState.value.activeTurnId))
const pendingApproval = computed(() => conversationState.value.pendingRequests.find(request => request.kind === 'approval') ?? null)
const pendingQuestion = computed(() => conversationState.value.pendingRequests.find(request => request.kind === 'question') ?? null)
const questionText = computed(() => requestText(pendingQuestion.value?.params, '请回答 Agent 的问题。'))
const approvalText = computed(() => requestText(pendingApproval.value?.params, 'Codex 请求执行一项受保护操作。'))
const sharedConversationEntries = computed(() => conversationEntriesFromState(conversationState.value))
const liveStatus = computed(() => isRunning.value ? (pendingApproval.value ? '等待审批' : pendingQuestion.value ? '等待回答' : 'Codex 正在工作') : '')
const filteredKnowledge = computed(() => { const query = knowledgeQuery.value.trim().toLowerCase(); return query ? knowledge.value.filter(doc => `${doc.name} ${doc.relativePath}`.toLowerCase().includes(query)) : knowledge.value })
const dashboardCacheLabel = computed(() => { const cache = dashboard.value?.cache; if (!cache) return ''; if (cache.state === 'refreshing') return cache.generatedAt ? '后台刷新中' : '首次统计中'; if (cache.state === 'empty') return '等待首次统计'; if (cache.state === 'stale') return `更新于 ${cache.ageSeconds ?? 0}s 前`; return `更新于 ${cache.ageSeconds ?? 0}s 前` })
const threadProjects = computed<ThreadProject[]>(() => { const projects = new Map<string, ThreadProject>(); const demandPaths = selectedDemand.value?.repositories.map(repo => repo.worktreePath) ?? []; for (const thread of nativeThreads.value) { const cwd = thread.cwd?.trim() || '未记录项目路径'; const existing = projects.get(cwd); const relatedToDemand = demandPaths.some(path => path === cwd || path.startsWith(`${cwd}/`) || cwd.startsWith(`${path}/`)); projects.set(cwd, existing ? { ...existing, count: existing.count + 1 } : { cwd, name: projectName(cwd), count: 1, relatedToDemand }); } return [...projects.values()].sort((left, right) => Number(right.relatedToDemand) - Number(left.relatedToDemand) || right.count - left.count || left.name.localeCompare(right.name)) })
const projectNativeThreads = computed(() => selectedThreadProject.value ? nativeThreads.value.filter(thread => (thread.cwd?.trim() || '未记录项目路径') === selectedThreadProject.value) : nativeThreads.value)
const filteredNativeThreads = computed(() => { const query = threadQuery.value.trim().toLowerCase(); return query ? projectNativeThreads.value.filter(thread => `${thread.preview} ${thread.cwd ?? ''} ${thread.nativeId}`.toLowerCase().includes(query)) : projectNativeThreads.value })
const canBindNativeThread = computed(() => manualThreadEntry.value ? Boolean(boundNativeId.value.trim()) : filteredNativeThreads.value.some(thread => thread.nativeId === boundNativeId.value && !thread.bound))
const composerModels = computed<CodyComposerOption[]>(() => runtimeModels.value.map(model => ({ value: model, label: model })))
const composerCollaborationModes = computed<CodyComposerOption[]>(() => {
  const providerModes = runtimeCollaborationModes.value.length ? runtimeCollaborationModes.value : [{ name: 'default', mode: 'default' as const, label: 'Default' }, { name: 'plan', mode: 'plan' as const, label: 'Plan' }]
  return providerModes.map(mode => ({ value: mode.name, label: mode.label }))
})
const selectedCollaborationMode = computed(() => {
  const wanted = selectedConversation.value?.plan?.active ? 'plan' : 'default'
  return runtimeCollaborationModes.value.find(mode => mode.mode === wanted)?.name ?? wanted
})
const composerSubmitModes = computed<CodyComposerOption[]>(() => [{ value: 'queue', label: '排队', description: '当前 Turn 结束后顺序执行。' }, { value: 'guide', label: '引导', description: '正在执行时发送给当前 Turn。' }])
const composerReasoningOptions = computed<CodyComposerOption[]>(() => [{ value: 'none', label: '无推理' }, { value: 'minimal', label: '极低' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }, { value: 'xhigh', label: '极高' }])
const composerPermissionOptions = computed<CodyComposerOption[]>(() => [{ value: 'read-only', label: '只读', description: '只能读取当前 Demand 的可读根目录。' }, { value: 'workspace-write', label: 'Worktree 写入', description: '仅可写当前 Demand 的 Worktree，危险操作仍须审批。' }, { value: 'yolo', label: 'YOLO', description: '自动批准，但仍不能访问或写入 Worktree 之外。' }])
const composerSkills = computed<CodyComposerOption[]>(() => skills.value.filter(skill => skill.status === 'available').map(skill => ({ value: skill.name, label: skill.name, description: skill.description })))

function requestText(value: unknown, fallback: string): string { const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}; const direct = row.reason ?? row.question ?? row.command; if (typeof direct === 'string' && direct.trim()) return direct; const questions = Array.isArray(row.questions) ? row.questions : []; const first = questions[0] && typeof questions[0] === 'object' ? questions[0] as Record<string, unknown> : {}; const text = first.question ?? first.detail; return typeof text === 'string' && text.trim() ? text : fallback }
function statusLabel(status: Conversation['status']): string { return status === 'running' ? '执行中' : status === 'awaiting_approval' ? '待确认' : status === 'failed' ? '失败' : status === 'disconnected' ? '已断开' : '已完成' }
function canDeleteConversation(conversation: Conversation): boolean { return conversations.value.length > 1 && conversation.status !== 'running' && conversation.status !== 'awaiting_approval' }
function deleteConversationTitle(conversation: Conversation): string { return conversation.status === 'running' || conversation.status === 'awaiting_approval' ? '执行中或待确认的会话不能删除' : conversations.value.length <= 1 ? '每个 Demand 至少保留一个会话' : '删除会话' }
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
      conversationState.value = createConversationState()
      draft.value = ''
      conversationController?.dispose()
      await openConversation(remaining[0]!)
    }
  } catch (cause) { deleteConversationError.value = cause instanceof Error ? cause.message : String(cause) } finally { deletingConversation.value = false }
}
function demandStatusLabel(status: Demand['status']): string { return status === 'in_progress' ? '进行中' : status === 'blocked' ? '阻塞' : status === 'completed' ? '完成' : '待开始' }
function toggleDemandNav(): void { demandNavExpanded.value = !demandNavExpanded.value }
function projectName(cwd: string): string { if (cwd === '未记录项目路径') return cwd; const segments = cwd.split('/').filter(Boolean); return segments.at(-1) || cwd }
function threadTitle(thread: AvailableNativeThread): string { const title = thread.preview.replace(/\s+/g, ' ').trim(); return title ? title.slice(0, 100) : `未命名 Thread · ${thread.nativeId.slice(0, 8)}` }
function formatThreadTime(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time)) return ''; const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000)); return minutes < 1 ? '刚刚更新' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1_440 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1_440)} 天前` }
function onScroll(): void { const node = scrollArea.value; if (node) followBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160 }
async function scrollToBottom(): Promise<void> { await nextTick(); if (followBottom) scrollArea.value?.scrollTo({ top: scrollArea.value.scrollHeight, behavior: 'smooth' }) }
function routeParams(): { workspaceId: string | null; demandId: string | null } { const params = new URLSearchParams(window.location.search); return { workspaceId: params.get('workspace'), demandId: params.get('demand') } }
function demandFromRoute(id: string): Demand | undefined { return demands.value.find((demand) => demand.id === id || demand.worktreeKey === id || demand.branchName === id) }
function updateRoute(demand: Demand | null, mode: HistoryMode): void {
  if (mode === 'none') return
  const url = new URL(window.location.href)
  if (workspace.value) url.searchParams.set('workspace', workspace.value.id)
  else url.searchParams.delete('workspace')
  if (demand) url.searchParams.set('demand', demand.id)
  else url.searchParams.delete('demand')
  const next = `${url.pathname}${url.search}${url.hash}`
  if (mode === 'replace') window.history.replaceState({}, '', next)
  else window.history.pushState({}, '', next)
}
function demandUrl(demand: Demand): string {
  const url = new URL(window.location.href)
  if (workspace.value) url.searchParams.set('workspace', workspace.value.id)
  url.searchParams.set('demand', demand.id)
  return url.toString()
}
function clearConversationState(): void {
  conversationController?.dispose()
  selectedConversation.value = null
  conversationState.value = createConversationState()
}
async function loadWorkspaces(): Promise<void> { loading.value = true; error.value = ''; try { workspaces.value = await api.listWorkspaces(); const route = routeParams(); const active = workspaces.value.find((item) => item.id === route.workspaceId) ?? workspaces.value.find((item) => item.active) ?? workspaces.value[0]; if (active) await selectWorkspace(active, { demandId: route.demandId, history: 'replace' }) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { loading.value = false } }
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
    conversationController?.dispose()
    workspace.value = null
    demands.value = []
    repositories.value = []
    conversations.value = []
    selectedDemand.value = null
    selectedConversation.value = null
    conversationState.value = createConversationState()
    dashboard.value = null
    const next = remaining.find(item => item.active) ?? remaining[0]
    if (next) await selectWorkspace(next)
    else activePage.value = 'dashboard'
  } catch (cause) { deleteWorkspaceError.value = cause instanceof Error ? cause.message : String(cause) } finally { deletingWorkspace.value = false }
}
async function refreshDashboard(): Promise<void> { if (!workspace.value) return; dashboard.value = await api.dashboard(workspace.value.id); if (dashboard.value.cache.state === 'empty' || dashboard.value.cache.state === 'stale') void requestDashboardRefresh() }
async function requestDashboardRefresh(): Promise<void> { if (!workspace.value || dashboardRefreshing.value) return; dashboardRefreshing.value = true; try { dashboard.value = await api.refreshDashboard(workspace.value.id) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { dashboardRefreshing.value = false } }
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
    if (lastSubmittedPrompt.value && !draft.value.trim()) {
      draft.value = lastSubmittedPrompt.value
      error.value = `Codex 本次连接中断：${reason}。原始消息已放回输入框，请确认后重试。`
    } else error.value = `Codex 本次连接中断：${reason}`
    lastSubmittedPrompt.value = null
  } else if (event.type === 'turn.completed') lastSubmittedPrompt.value = null
  conversations.value = conversations.value.map(item => item.id === conversationId ? {
    ...item,
    status: event.type === 'turn.started' ? 'running'
      : event.type === 'approval.requested' || event.type === 'question.requested' ? 'awaiting_approval'
        : event.type === 'turn.failed' ? 'failed'
          : event.type === 'turn.completed' ? 'completed' : item.status,
  } : item)
  if (selectedConversation.value?.id === conversationId) selectedConversation.value = conversations.value.find(item => item.id === conversationId) ?? selectedConversation.value
}
async function connect(conversation: Conversation): Promise<void> {
  conversationController?.dispose()
  conversationState.value = createConversationState(conversation.nativeId)
  const workspaceId = workspace.value!.id
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.host || '127.0.0.1:3211'
  conversationController = createConversationController(conversation.nativeId, {
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
  conversationController.subscribe(state => { conversationState.value = state })
  await conversationController.start()
}
async function openConversation(conversation: Conversation): Promise<void> { selectedConversation.value = conversation; permission.value = conversation.permissionMode; lastSubmittedPrompt.value = null; error.value = ''; await connect(conversation); await scrollToBottom() }
async function browseDirectories(path?: string): Promise<void> { directoryLoading.value = true; directoryError.value = ''; try { directoryListing.value = await api.listDirectories(path) } catch (cause) { directoryError.value = cause instanceof Error ? cause.message : String(cause) } finally { directoryLoading.value = false } }
async function openDirectoryPicker(): Promise<void> { showDirectoryPicker.value = true; await browseDirectories(workspacePath.value.trim() || undefined) }
function useSelectedDirectory(): void { if (!directoryListing.value) return; workspacePath.value = directoryListing.value.current; showDirectoryPicker.value = false }
async function createWorkspace(): Promise<void> { creating.value = true; modalError.value = ''; try { const source: WorkspaceSource = workspaceMode.value === 'folder' ? { type: 'folder', path: workspacePath.value.trim() } : { type: 'git', url: workspaceGitUrl.value.trim(), destination: workspacePath.value.trim() }; if (useAiWorkspaceSetup.value) { let job = await api.startWorkspaceSetup(source, workspaceName.value.trim() || undefined); workspaceSetupJob.value = job; while (job.status === 'running') { await new Promise(resolve => window.setTimeout(resolve, 450)); job = await api.workspaceSetupStatus(job.id); workspaceSetupJob.value = job } if (job.status === 'failed' || !job.workspace) throw new Error(job.error || 'AI Workspace 初始化未完成'); await loadWorkspaces(); await selectWorkspace(job.workspace); return } const created = await api.createWorkspace(source, workspaceName.value.trim() || undefined); showCreateWorkspace.value = false; workspaceName.value = ''; workspacePath.value = ''; workspaceGitUrl.value = ''; await loadWorkspaces(); await selectWorkspace(created.workspace) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false } }
async function importExistingWorktrees(): Promise<void> { if (!workspace.value || importingWorktrees.value) return; importingWorktrees.value = true; try { const result = await api.importExistingWorktrees(workspace.value.id); demands.value = await api.listDemands(workspace.value.id); await refreshDashboard(); error.value = result.imported.length ? `已导入 ${result.imported.length} 个已有 Demand。` : result.skipped.length ? `没有可导入的 Worktree：${result.skipped[0]!.reason}` : '没有发现尚未导入的 Worktree。' } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { importingWorktrees.value = false } }
async function createDemand(): Promise<void> { if (!workspace.value) return; creating.value = true; modalError.value = ''; try { const created = await api.createDemand(workspace.value.id, { name: demandName.value.trim(), ...(demandBranch.value.trim() ? { branchName: demandBranch.value.trim() } : {}), repositoryIds: selectedRepositoryIds.value }); demands.value = await api.listDemands(workspace.value.id); showCreateDemand.value = false; demandName.value = ''; demandBranch.value = ''; selectedRepositoryIds.value = []; const demand = demands.value.find((item) => item.id === created.demand.id); if (demand) await openDemand(demand) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false } }
async function createConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value) return; const created = await api.createConversation(workspace.value.id, selectedDemand.value.id); conversations.value = [created, ...conversations.value]; await openConversation(created) }
async function openBindConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value) return; modalError.value = ''; boundNativeId.value = ''; boundConversationTitle.value = ''; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false; showBindConversation.value = true; threadPickerLoading.value = true; try { nativeThreads.value = await api.listAvailableNativeThreads(workspace.value.id, selectedDemand.value.id) } catch (cause) { nativeThreads.value = []; modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { threadPickerLoading.value = false } }
function closeBindConversation(): void { if (bindingConversation.value) return; showBindConversation.value = false; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false }
function selectNativeThread(thread: AvailableNativeThread): void { if (thread.bound) return; boundNativeId.value = thread.nativeId; if (!boundConversationTitle.value.trim()) boundConversationTitle.value = threadTitle(thread) }
async function bindConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value || bindingConversation.value || !canBindNativeThread.value) return; bindingConversation.value = true; modalError.value = ''; try { const created = await api.bindConversation(workspace.value.id, selectedDemand.value.id, { nativeId: boundNativeId.value.trim(), ...(boundConversationTitle.value.trim() ? { title: boundConversationTitle.value.trim() } : {}) }); conversations.value = [created, ...conversations.value]; showBindConversation.value = false; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false; boundNativeId.value = ''; boundConversationTitle.value = ''; await openConversation(created) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { bindingConversation.value = false } }
async function sendMessage(): Promise<void> { if (!workspace.value || !selectedConversation.value || !draft.value.trim() || sending.value) return; const content = draft.value.trim(); draft.value = ''; sending.value = true; try { await api.sendMessage(workspace.value.id, selectedConversation.value.id, content, isRunning.value && selectedSubmitMode.value === 'guide' ? 'steer' : 'queue', { ...(selectedModel.value ? { model: selectedModel.value } : {}), ...(selectedReasoning.value ? { reasoningEffort: selectedReasoning.value } : {}), ...(selectedSkillsForTurn.value.length ? { skills: selectedSkillsForTurn.value } : {}) }); lastSubmittedPrompt.value = content } catch (cause) { draft.value = content; error.value = cause instanceof Error ? cause.message : String(cause) } finally { sending.value = false } }
function updateDraft(value: string): void { draft.value = value }
async function sendCommand(command: string): Promise<void> { if (!workspace.value || !selectedConversation.value) return; await api.sendMessage(workspace.value.id, selectedConversation.value.id, command) }
async function savePermission(): Promise<void> { if (!workspace.value || !selectedConversation.value) return; try { const updated = await api.setConversationPermission(workspace.value.id, selectedConversation.value.id, permission.value); selectedConversation.value = updated; conversations.value = conversations.value.map((item) => item.id === updated.id ? updated : item) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } }
async function loadComposerOptions(demandId: string): Promise<void> { if (!workspace.value) return; try { const options = await api.composerOptions(workspace.value.id, demandId); runtimeModels.value = options.models; runtimeCollaborationModes.value = options.collaborationModes; if (!selectedModel.value && options.models.length) selectedModel.value = options.models[0]! } catch { runtimeModels.value = []; runtimeCollaborationModes.value = [] } }
async function selectCollaborationMode(name: string): Promise<void> { const next = runtimeCollaborationModes.value.find(mode => mode.name === name) ?? (name === 'plan' ? { name, mode: 'plan' as const, label: 'Plan' } : { name, mode: 'default' as const, label: 'Default' }); if (next.model) selectedModel.value = next.model; if (next.reasoningEffort) selectedReasoning.value = next.reasoningEffort; const isPlan = next.mode === 'plan'; if (Boolean(selectedConversation.value?.plan?.active) === isPlan) return; try { await sendCommand(isPlan ? '/plan on' : '/plan off'); if (selectedConversation.value) { const updated = { ...selectedConversation.value, plan: { active: isPlan, status: isPlan ? 'planning' : 'inactive' } }; selectedConversation.value = updated; conversations.value = conversations.value.map(conversation => conversation.id === updated.id ? updated : conversation) } } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } }
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
async function resolveApproval(outcome: 'allowed-once' | 'rejected'): Promise<void> { if (!workspace.value || !selectedConversation.value || !pendingApproval.value) return; await api.resolveApproval(workspace.value.id, selectedConversation.value.id, pendingApproval.value.id, outcome) }
async function resolveTimelineApproval(requestId: string, decision: 'accept' | 'decline'): Promise<void> { if (!workspace.value || !selectedConversation.value) return; await api.resolveApproval(workspace.value.id, selectedConversation.value.id, requestId, decision === 'accept' ? 'allowed-once' : 'rejected') }
async function resolveQuestion(): Promise<void> { if (!workspace.value || !selectedConversation.value || !pendingQuestion.value || !questionAnswer.value.trim()) return; await api.answerQuestion(workspace.value.id, selectedConversation.value.id, pendingQuestion.value.id, questionAnswer.value.trim()); questionAnswer.value = '' }
watch(() => conversationState.value.appliedEventIds.length, () => { void scrollToBottom() })
let dashboardTimer: number | null = null
onMounted(() => { void loadWorkspaces(); window.addEventListener('popstate', () => { void restoreRoute() }); dashboardTimer = window.setInterval(() => { if (activePage.value === 'dashboard' && document.visibilityState === 'visible') void requestDashboardRefresh() }, 5 * 60_000) })
onBeforeUnmount(() => { conversationController?.dispose(); if (copiedDemandPathTimer !== null) window.clearTimeout(copiedDemandPathTimer); if (copiedDemandLinkTimer !== null) window.clearTimeout(copiedDemandLinkTimer); if (dashboardTimer !== null) window.clearInterval(dashboardTimer) })
</script>
