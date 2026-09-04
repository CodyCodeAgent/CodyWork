<template>
  <div class="app-shell codywork-vue" data-testid="codywork-app">
    <WorkbenchSidebar :workspace="workspace" :workspaces="workspaces" :demands="demands" :selected-demand-id="selectedDemand?.id ?? ''" :active-page="activePage" :realtime-active="Boolean(selectedConversation)" :socket-state="socketState" :workspace-picker-open="showWorkspacePicker" :demand-expanded="demandNavExpanded" :collapsed="workspaceSidebarCollapsed" @update:workspace-picker-open="showWorkspacePicker = $event" @update:demand-expanded="demandNavExpanded = $event" @update:collapsed="setWorkspaceSidebarCollapsed" @select-workspace="selectWorkspace" @remove-workspace="openDeleteWorkspace" @create-workspace="showCreateWorkspace = true" @create-demand="showCreateDemand = true" @navigate="goTo" @open-demand="openDemand" />

    <main class="main">
      <div v-if="error" class="app-error-banner" role="alert"><span>{{ error }}</span><button type="button" aria-label="关闭错误提示" @click="error = ''">×</button></div>
      <div v-if="loading" class="page-loading">正在加载 CodyWork…</div>
      <section v-else-if="!workspace" class="create-page"><div class="create-hero"><div class="eyebrow">CODYWORK / VUE</div><h1>为你的研发工作创建 Workspace</h1><p>Workspace 管理真实目录；每个需求拥有独立 Worktree，Codex 对话始终遵循这个边界。</p></div><button class="btn primary" @click="showCreateWorkspace = true">创建 Workspace</button></section>
      <section v-else-if="activePage === 'dashboard'" class="workspace-page">
        <header class="topbar"><div><div class="eyebrow">{{ workspace.name.toUpperCase() }} / OVERVIEW</div><h1>Workspace 概览</h1></div><div class="topbar-actions"><span v-if="dashboard" :class="['cache-status', dashboard.cache.state]">{{ dashboardCacheLabel }}</span><button class="btn" :disabled="dashboardRefreshing" @click="requestDashboardRefresh">{{ dashboardRefreshing ? '刷新中…' : '刷新状态' }}</button><button class="btn primary" @click="showAddRepository = true">＋ 添加 Repo</button></div></header>
        <div class="workspace-body">
          <div class="workspace-header-card"><span class="workspace-large-mark">{{ workspace.name.slice(0, 1).toUpperCase() }}</span><div class="workspace-header-copy"><h2>{{ workspace.name }}</h2><code>{{ workspace.path }}</code><p>所有会话都从 Workspace → Demand → Worktree 进入受限执行。</p></div><span class="ready-pill"><i />ready</span></div>
          <div class="metric-grid" aria-label="Workspace 统计"><article class="metric-card"><small>REPOSITORIES</small><strong>{{ dashboard?.repositories.total ?? repositories.length }}</strong><span>登记开发仓库</span></article><article class="metric-card"><small>DEMANDS</small><strong>{{ dashboard?.demands.total ?? demands.length }}</strong><span>隔离 Worktree</span></article><article class="metric-card"><small>KNOWLEDGE</small><strong>{{ dashboard?.knowledge.documents ?? 0 }}</strong><span>可读文档</span></article><article class="metric-card"><small>SKILLS</small><strong>{{ dashboard?.skills.available ?? 0 }}</strong><span>可调用能力</span></article></div>
          <div class="workspace-grid"><article class="info-card repository-card"><div class="repository-card-head"><div><div class="card-kicker">REPOSITORIES</div><h3>开发根目录</h3></div><span class="repository-summary">{{ repositories.length }} 个项目</span></div><div v-if="repositories.length" class="repository-list" role="list" aria-label="开发仓库"><div v-for="repo in repositories" :key="repo.id" class="repository-row" role="listitem"><div class="repository-copy"><div class="repository-name"><strong>{{ repo.name }}</strong><code v-if="repo.defaultRef">{{ repo.defaultRef }}</code></div><small>{{ repo.path }}</small></div><div class="repository-statuses"><span v-if="repo.dirty" class="repository-status dirty">dirty</span><span v-else class="repository-status clean">clean</span><span v-if="repo.syncStatus === 'pull_failed'" class="repository-status sync-failed">sync failed</span><button v-if="repo.dirty" class="repository-clear-button" type="button" :disabled="Boolean(clearingRepositoryId)" :title="`丢弃 ${repo.name} 基线中的未提交改动`" @click="requestBaselineCleanup(repo)">清理</button></div></div></div><p v-else class="muted">先添加一个 Git 仓库或目录，再创建 Demand。</p><div class="repository-card-foot"><span>状态由后台扫描更新</span><button class="btn" @click="showAddRepository = true">管理仓库</button></div></article><article class="info-card next-step-card"><div class="card-kicker">NEXT STEP</div><h3>按需求进入执行</h3><p>Demand 为每个仓库创建独立 Worktree，并将可读写根目录注入 Codex policy。</p><button class="btn primary" @click="goTo('demands')">查看需求</button></article></div>
        </div>
      </section>
      <section v-else-if="activePage === 'knowledge'" class="knowledge-page"><header class="topbar"><div><div class="eyebrow">WORKSPACE / KNOWLEDGE</div><h1>知识库</h1></div><button class="btn" @click="loadKnowledge">刷新</button></header><div class="knowledge-body"><div class="knowledge-layout"><article class="knowledge-list-card"><div class="knowledge-list-head"><strong>文档</strong><span>{{ filteredKnowledge.length }}</span></div><div class="knowledge-search"><input v-model="knowledgeQuery" class="input" placeholder="搜索文档…" /></div><button v-for="doc in filteredKnowledge" :key="doc.id" :class="['knowledge-row', { active: selectedKnowledge?.id === doc.id }]" @click="openKnowledge(doc)"><span class="knowledge-file-icon">{{ doc.extension.replace('.', '').slice(0, 4) || 'doc' }}</span><span class="knowledge-row-copy"><strong>{{ doc.name }}</strong><small>{{ doc.relativePath }}</small></span></button><p v-if="!filteredKnowledge.length" class="knowledge-empty">Workspace 中还没有可展示的知识文档。</p></article><article class="knowledge-detail-card"><template v-if="selectedKnowledge"><div class="knowledge-detail-head"><div><div class="card-kicker">{{ selectedKnowledge.extension || 'DOCUMENT' }}</div><h2>{{ selectedKnowledge.name }}</h2><p>{{ selectedKnowledge.path }}</p></div><span class="knowledge-extension">{{ selectedKnowledge.size }} bytes</span></div><pre class="knowledge-content">{{ selectedKnowledge.content ?? '正在读取文档…' }}</pre></template><p v-else class="knowledge-detail-empty">从左侧选择一个文档查看其内容。</p></article></div></div></section>
      <section v-else-if="activePage === 'skills'" class="skills-page">
        <header class="topbar"><div><div class="eyebrow">WORKSPACE / SKILLS</div><h1>Skills</h1></div><button class="btn" @click="loadSkills(true)">刷新</button></header>
        <div class="skills-body">
          <div class="skill-install-card"><div><div class="card-kicker">ADD CAPABILITY</div><h2>为当前 Workspace 安装 Skill</h2><p>Skill 会被安装到 Workspace 的 <code>.agents/skills</code>，并且仍受当前 Workspace 写入策略约束。</p></div><div class="skill-install-form"><input v-model="skillSource" class="input" placeholder="Git URL 或 Skill 来源" /><button class="btn primary" :disabled="installingSkill || !skillSource.trim()" @click="installSkill">{{ installingSkill ? '安装中…' : '安装' }}</button></div></div>
          <div v-if="skillJob" class="skill-run-result" :class="skillJob.status">{{ skillJob.message ?? skillJob.status }}<template v-if="skillJob.events.length"> · {{ skillJob.events.length }} 个运行事件</template></div>
          <div class="skills-layout">
            <article class="skills-list-card">
              <div class="skills-list-head"><strong>全部 Skills</strong><span>{{ skillSearchSummary(skills.length, filteredSkills.length, skillQuery) }}</span></div>
              <label class="skills-search"><span class="sr-only">搜索 Skills</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg><input v-model.trim="skillQuery" type="search" placeholder="搜索名称、描述、路径或来源…" aria-label="搜索 Skills" /></label>
              <div class="skills-results">
                <button v-for="skill in filteredSkills" :key="skill.id" :class="['skill-row', { active: selectedSkill?.id === skill.id }]" @click="openSkill(skill)"><span class="skill-row-copy"><strong>{{ skill.displayName || skill.name }}</strong><small>{{ skill.description || skill.path }}</small></span><span class="skill-row-badges"><span v-if="sameNameSkills(skills, skill).length" class="skill-identity-pill">同名 {{ sameNameSkills(skills, skill).length + 1 }}</span><span class="skill-source-pill">{{ skillSourceLabel(skill.source) }}</span><span :class="['skill-status-pill', skill.status]">{{ skill.status }}</span></span></button>
                <p v-if="skills.length && !filteredSkills.length" class="skills-empty"><strong>没有匹配的 Skill</strong><span>换个名称、描述、路径或来源试试。</span></p>
                <p v-else-if="!skills.length" class="skills-empty">Runtime 还没有发现可用 Skill。</p>
              </div>
            </article>
            <article class="skill-detail-card"><template v-if="selectedSkill"><div class="skill-detail-head"><div><div class="card-kicker">{{ skillSourceLabel(selectedSkill.source) }} · {{ selectedSkill.scope }}</div><h2>{{ selectedSkill.displayName || selectedSkill.name }}</h2><p>{{ selectedSkill.description }}</p></div><span :class="['skill-status-pill', selectedSkill.status]">{{ selectedSkill.status }}</span></div><div class="skill-meta"><span>{{ selectedSkill.modelInvocable ? 'Agent 可调用' : '仅供参考' }}</span><code>{{ selectedSkill.path }}</code></div><div v-if="sameNameSkills(skills, selectedSkill).length" class="skill-identity-note"><strong>同名 Skill 已按路径消歧</strong><p>当前引用固定绑定上方完整路径，不会被其他来源静默替换。</p><ul><li v-for="peer in sameNameSkills(skills, selectedSkill)" :key="peer.id"><span>{{ skillSourceLabel(peer.source) }}</span><code>{{ peer.path }}</code></li></ul></div><pre v-if="selectedSkill.content" class="skill-content">{{ selectedSkill.content }}</pre><p v-else class="skill-content-empty">该 Runtime Skill 没有可读取的本地文档，仍可按 Runtime 元数据调用。</p></template><p v-else class="skill-detail-empty">从左侧选择一个 Skill 查看详情。</p></article>
          </div>
        </div>
      </section>
      <section v-else-if="activePage === 'settings'" class="workspace-page">
        <header class="topbar"><div><button v-if="settingsSection !== 'overview'" class="back-link" type="button" @click="openSettingsSection('overview')">‹ 返回设置</button><div class="eyebrow">WORKSPACE / SETTINGS</div><h1>{{ settingsTitle }}</h1></div><button v-if="settingsSection === 'runtime'" class="btn" :disabled="testingRuntime" @click="testRuntime">{{ testingRuntime ? '检查中…' : '测试连接' }}</button></header>
        <SettingsOverview v-if="settingsSection === 'overview'" :action-count="quickActions.length" @open="openSettingsSection" />
        <QuickActionSettings v-else-if="settingsSection === 'quick-actions'" :actions="quickActions" :skills="skills" :selected-id="selectedQuickActionId" :saving="savingQuickAction" :message="quickActionMessage" @update:selected-id="selectedQuickActionId = $event" @save="saveQuickAction" @delete="deleteQuickAction" />
        <FeishuChannelSettings v-else-if="settingsSection === 'feishu'" />
        <div v-else class="workspace-body"><article class="settings-card"><div class="card-kicker">APP SERVER</div><h2>Codex App Server</h2><p>服务级共享进程；每个会话仍通过 Demand Worktree policy 隔离。</p><label>启动命令</label><input v-model="runtimeCommand" class="input" placeholder="codex app-server --stdio" /><p v-if="runtimeMessage" class="runtime-result">{{ runtimeMessage }}</p><button class="btn primary" @click="saveRuntime">保存 Runtime 设置</button></article></div>
      </section>
      <section v-else-if="activePage === 'demands' && !selectedDemand" class="demands-body">
        <header class="topbar"><div><div class="eyebrow">{{ workspace.name.toUpperCase() }} / WORK MODE</div><h1>需求工作台</h1></div><div class="topbar-actions"><button class="btn" :disabled="importingWorktrees" @click="importExistingWorktrees">{{ importingWorktrees ? '扫描中…' : '扫描已有 Worktree' }}</button><button class="btn primary" @click="showCreateDemand = true">＋ 新建需求</button></div></header>
        <div class="dashboard-note"><div><strong>每个需求都是一个独立执行上下文</strong><p>Codex 可以跨 Repo 协作，但只会读写当前需求登记的 Worktree 根目录。</p></div><code>{{ workspace.path }}</code></div>
        <div class="demand-grid"><button v-for="demand in demands" :key="demand.id" class="demand-card" @click="openDemand(demand)"><span :class="['demand-dot', demand.status]" /><div><strong>{{ demand.name }}</strong><small>{{ demand.branchName }}</small><p>{{ demand.repositories.length }} 个 Repo · {{ demand.status === 'in_progress' ? '开发中' : demand.status }}</p></div><span>→</span></button><div v-if="demands.length === 0" class="empty-list"><strong>还没有需求</strong><span>先选择开发 Repo，再创建一个隔离的 Demand Worktree。</span><button class="btn primary" @click="showCreateDemand = true">创建需求</button></div></div>
      </section>
      <section v-else-if="activePage === 'chat' && selectedDemand" class="demand-chat-page">
        <header class="topbar chat-topbar"><div><button class="back-link" @click="returnToDemandList">‹ 返回需求</button><div class="eyebrow">DEMAND / {{ selectedDemand.branchName }}</div><h1>{{ selectedDemand.name }}</h1><div class="demand-link-actions"><button class="demand-path-link" type="button" :title="`复制 Worktree 路径：${selectedDemand.path}`" :aria-label="`复制 ${selectedDemand.name} 的 Worktree 路径`" @click="copyDemandPath(selectedDemand)"><span>Worktree</span><code>{{ selectedDemand.path }}</code><span class="demand-path-action">{{ copiedDemandPath === selectedDemand.id ? '已复制' : '复制路径' }}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8.5A2.5 2.5 0 0 1 11.5 6H18a2.5 2.5 0 0 1 2.5 2.5V15a2.5 2.5 0 0 1-2.5 2.5h-6.5A2.5 2.5 0 0 1 9 15V8.5Z" /><path d="M15 6V4.5A2.5 2.5 0 0 0 12.5 2H6A2.5 2.5 0 0 0 3.5 4.5V11A2.5 2.5 0 0 0 6 13.5H9" /></svg></button><button class="demand-deep-link" type="button" :title="`复制需求链接：${demandUrl(selectedDemand)}`" :aria-label="`复制 ${selectedDemand.name} 的需求链接`" @click="copyDemandLink(selectedDemand)">{{ copiedDemandLink === selectedDemand.id ? '已复制链接' : '复制需求链接' }}</button></div></div><div class="topbar-actions"><span :class="['socket-pill', socketState]" :title="socketDetail">{{ socketLabel }}</span><DemandToolbox :demand="selectedDemand" :repositories="demandBaselineRepositories" :usage="threadContextUsage" :can-settle="canSettleConversation" :settle-title="settleConversationTitle" :can-add-repository="canAddDemandRepository" :syncing-repository-id="syncingRepositoryId" :clearing-repository-id="clearingRepositoryId" :sync-results="repositorySyncResults" @settle="settleConversation" @add-repository="openAddDemandRepository" @sync="syncRepositoryBaseline" @cleanup="requestBaselineCleanup" /><button class="btn" @click="openBindConversation">绑定 Thread</button><button class="btn" :disabled="creatingConversation" @click="createConversation">{{ creatingConversation ? '创建中…' : '＋ 新会话' }}</button></div></header>
        <div class="chat-layout">
          <aside :class="['conversation-sidebar', { collapsed: conversationSidebarCollapsed }]">
            <button v-if="conversationSidebarCollapsed" class="conversation-panel-toggle rail" type="button" :aria-label="'展开会话列表'" aria-expanded="false" title="展开会话列表" @click="setConversationSidebarCollapsed(false)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg><span>会话</span></button>
            <template v-else>
            <div class="conversation-head"><div><div class="card-kicker">SESSIONS</div><strong>会话</strong></div><button class="conversation-panel-toggle" type="button" :aria-label="'收起会话列表'" aria-expanded="true" title="收起会话列表" @click="setConversationSidebarCollapsed(true)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button></div>
            <div class="conversation-demand"><strong>{{ selectedDemand.name }}</strong><small>{{ selectedDemand.repositories.map((repo) => repo.name).join(' · ') || '尚未添加 Repo' }}</small></div>
            <div class="conversation-list" role="list" aria-label="Demand 会话">
              <div v-for="conversation in conversations" :key="conversation.id" :class="['conversation-row-wrap', { active: conversation.id === selectedConversation?.id, editing: renamingConversationId === conversation.id }]" role="listitem">
                <form v-if="renamingConversationId === conversation.id" class="conversation-rename-editor" @submit.prevent="saveConversationRename(conversation)">
                  <span :class="['conversation-status', displayConversationStatus(conversation)]" />
                  <div class="conversation-rename-field">
                    <input v-model="conversationRenameDraft" :data-conversation-rename="conversation.id" maxlength="120" :aria-label="`重命名会话：${conversation.title}`" @keydown.enter.prevent="saveConversationRename(conversation)" @keydown.esc.prevent="cancelConversationRename" />
                    <small v-if="conversationRenameError" role="alert">{{ conversationRenameError }}</small>
                  </div>
                  <button class="conversation-edit-action save" type="submit" :disabled="savingConversationRename" aria-label="保存会话名称" title="保存（Enter）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg></button>
                  <button class="conversation-edit-action cancel" type="button" :disabled="savingConversationRename" aria-label="取消重命名" title="取消（Esc）" @click="cancelConversationRename"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
                </form>
                <template v-else>
                  <button :class="['conversation-row', { active: conversation.id === selectedConversation?.id }]" @click="openConversation(conversation)" @dblclick.stop="startConversationRename(conversation)"><span :class="['conversation-status', displayConversationStatus(conversation)]" /><span><strong>{{ conversation.title }}</strong><small>{{ statusLabel(displayConversationStatus(conversation)) }}</small></span></button>
                  <button class="conversation-edit-action rename" type="button" :aria-label="`重命名会话：${conversation.title}`" title="重命名会话" @click.stop="startConversationRename(conversation)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1 9.8-9.8a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L5 15.5 4 20Z" /></svg></button>
                  <button class="conversation-delete" type="button" :disabled="!canDeleteConversation(conversation)" :title="deleteConversationTitle(conversation)" :aria-label="`删除会话：${conversation.title}`" @click.stop="requestDeleteConversation(conversation)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" /></svg></button>
                </template>
              </div>
            </div>
            </template>
          </aside>
          <section class="chat-main">
            <div ref="scrollArea" class="chat-scroll" @scroll="onScroll">
              <button v-if="hiddenConversationEntryCount > 0" class="chat-history-button" type="button" @click="showEarlierConversationEntries">显示更早的 {{ Math.min(hiddenConversationEntryCount, 80) }} 项</button>
              <CodyConversation variant="embedded" :entries="sharedConversationEntries" @copy="copyConversationText" @retry-message="retryFailedMessage" @resolve-approval="resolveTimelineApproval" @resolve-question="resolveTimelineQuestion"><template #empty><div class="chat-empty"><span class="workspace-large-mark">CW</span><h2>开始这个需求的开发</h2><p>描述目标即可。Codex 会看到当前 Demand 的 Worktree、策略和上下文。</p></div></template></CodyConversation>
            </div>
            <button v-if="conversationScrollState?.isAtBottom === false" class="chat-scroll-bottom" type="button" aria-label="回到最新消息" @click="scrollToBottom(true)">↓</button>
            <div class="composer">
              <QuickActionBar :actions="demandQuickActions" :disabled="sending || uploadingImages || !selectedConversation" :feedback="quickActionFeedback" @execute="executeQuickAction" />
              <div class="composer-hint">{{ selectedCollaborationModeKind === 'plan' ? 'Plan 模式：本次 Turn 先澄清和规划，再确认执行。' : '当前消息只会在该 Demand 的 Worktree 内执行。输入 $ 可引用多个 Skill。' }}</div><CodyComposer variant="embedded" :draft="draft" :disabled="sending" :is-running="isRunning" :collaboration-modes="composerCollaborationModes" :selected-collaboration-mode="selectedCollaborationMode" :submit-modes="composerSubmitModes" :selected-submit-mode="selectedSubmitMode" :models="composerModels" :selected-model="selectedModel" :reasoning-options="composerReasoningOptions" :selected-reasoning="selectedReasoning" :permission-options="composerPermissionOptions" :selected-permission="permission" :skills="composerSkills" :selected-skills="selectedSkillsForTurn" :images="composerImages" :image-upload-enabled="true" :is-uploading-images="uploadingImages" :image-error="composerImageError" :placeholder="isRunning ? (selectedSubmitMode === 'steer' ? '描述引导…（可粘贴或拖入图片；输入 $ 引用 Skill；Enter 换行，Control + Enter 发送）' : '描述下一步…（可粘贴或拖入图片；输入 $ 引用 Skill；Enter 换行，Control + Enter 排队）') : '描述你希望完成的事情…（可粘贴或拖入图片；输入 $ 引用 Skill；Enter 换行，Control + Enter 发送）'" @update:draft="updateDraft" @update:collaboration-mode="selectCollaborationMode" @update:submit-mode="selectedSubmitMode = $event === 'steer' ? 'steer' : 'queue'" @update:model="selectedModel = $event" @update:reasoning="selectReasoning" @update:permission="selectPermission" @update:selected-skills="selectedSkillsForTurn = $event" @attach-images="uploadImages" @remove-image="removeComposerImage" @send="sendMessage" @stop="interrupt" />
            </div>
          </section>
        </div>
      </section>
    </main>

    <WorkspaceSetupDialog :visible="showCreateWorkspace" @close="showCreateWorkspace = false" @completed="workspaceCreated" />
    <div v-if="showCreateDemand" class="modal-backdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-demand-title"><div class="modal-head"><div><div class="eyebrow">NEW DEMAND</div><h2 id="create-demand-title">创建隔离需求</h2></div><button class="icon-button" aria-label="关闭创建需求弹窗" @click="showCreateDemand = false">×</button></div><label>需求名</label><input v-model="demandName" class="input" placeholder="例如：统一 AI 工作对话" /><label>分支名</label><input v-model="demandBranch" class="input" placeholder="可选，默认按需求名生成" /><fieldset class="demand-repository-fieldset"><legend>开发 Repo</legend><label class="sr-only" for="demand-repository-search">搜索开发 Repo</label><div class="demand-repository-search"><input id="demand-repository-search" v-model="demandRepositoryQuery" class="input" type="search" autocomplete="off" placeholder="按名称、路径或分支搜索…" aria-describedby="demand-repository-search-summary" /><button v-if="demandRepositoryQuery" class="repo-search-clear" type="button" aria-label="清除 Repo 搜索" @click="demandRepositoryQuery = ''">清除</button></div><p id="demand-repository-search-summary" class="demand-repository-summary" role="status">{{ demandRepositorySearchSummary }}</p><div class="repo-picker"><label v-for="repo in filteredDemandCreationRepositories" :key="repo.id" class="repo-option"><input v-model="selectedRepositoryIds" type="checkbox" :value="repo.id" /><span><strong>{{ repo.name }}</strong><small>{{ repo.path }}</small></span><code v-if="repo.defaultRef" class="demand-repository-ref">{{ repo.defaultRef }}</code></label><p v-if="filteredDemandCreationRepositories.length === 0" class="repo-picker-empty">没有匹配的 Repo。可尝试名称、目录路径或分支名。</p></div></fieldset><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showCreateDemand = false">取消</button><button class="btn primary" :disabled="creating || !demandName.trim() || selectedRepositoryIds.length === 0" @click="createDemand">创建并进入</button></div></section></div>
    <div v-if="showAddRepository" class="modal-backdrop"><section class="modal-card"><div class="modal-head"><div><div class="eyebrow">REPOSITORY</div><h2>添加开发 Repo</h2></div><button class="icon-button" @click="showAddRepository = false">×</button></div><div class="mode-tabs"><button :class="{ active: repositorySource === 'folder' }" @click="repositorySource = 'folder'">本地目录</button><button :class="{ active: repositorySource === 'git' }" @click="repositorySource = 'git'">Git clone</button></div><label>显示名称</label><input v-model="repositoryName" class="input" placeholder="可选" /><template v-if="repositorySource === 'folder'"><label>仓库目录</label><input v-model="repositoryPath" class="input" placeholder="/Users/you/projects/repository" /><p class="field-help">该 Git 仓库会复制到当前 Workspace 的 <code>services/&lt;名称&gt;</code>。</p></template><template v-else><label>Git URL</label><input v-model="repositoryUrl" class="input" placeholder="git@github.com:org/repository.git" /><p class="field-help">仓库会克隆到当前 Workspace 的 <code>services/&lt;名称&gt;</code>。</p></template><p v-if="modalError" class="form-error">{{ modalError }}</p><div class="modal-actions"><button class="btn" @click="showAddRepository = false">取消</button><button class="btn primary" :disabled="creating || (repositorySource === 'folder' ? !repositoryPath.trim() : !repositoryUrl.trim())" @click="addRepository">{{ creating ? '正在添加…' : '添加 Repo' }}</button></div></section></div>
    <AddDemandRepositoryDialog v-if="selectedDemand" :visible="showAddDemandRepository" :demand="selectedDemand" :repositories="availableDemandRepositories" :selected-repository-id="selectedDemandRepositoryId" :adding="addingDemandRepository" :error="demandRepositoryError" @close="closeAddDemandRepository" @add="addDemandRepository" @update:selected-repository-id="selectedDemandRepositoryId = $event" />
    <BindThreadDialog :visible="showBindConversation" :binding="bindingConversation" :loading="threadPickerLoading" :manual-entry="manualThreadEntry" :selected-project="selectedThreadProject" :query="threadQuery" :native-id="boundNativeId" :title="boundConversationTitle" :error="modalError" :can-bind="canBindNativeThread" :all-thread-count="nativeThreads.length" :projects="threadProjects" :threads="filteredNativeThreads" @close="closeBindConversation" @bind="bindConversation" @select="selectNativeThread" @update:manual-entry="manualThreadEntry = $event" @update:selected-project="selectedThreadProject = $event" @update:query="threadQuery = $event" @update:native-id="boundNativeId = $event" @update:title="boundConversationTitle = $event" />
    <div v-if="conversationPendingDelete" class="modal-backdrop"><section class="modal-card delete-conversation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title"><div class="modal-head"><div><div class="eyebrow">REMOVE SESSION</div><h2 id="delete-conversation-title">删除会话？</h2></div><button class="icon-button" aria-label="关闭删除会话弹窗" :disabled="deletingConversation" @click="closeDeleteConversation">×</button></div><p>将从当前 Demand 移除“{{ conversationPendingDelete.title }}”的会话绑定。</p><p class="delete-conversation-note">不会删除原生 Codex Thread 或它的历史；仍可稍后重新绑定并继续。</p><p v-if="deleteConversationError" class="form-error" role="alert">{{ deleteConversationError }}</p><div class="modal-actions"><button class="btn" :disabled="deletingConversation" @click="closeDeleteConversation">取消</button><button class="btn danger" :disabled="deletingConversation" @click="deleteConversation">{{ deletingConversation ? '删除中…' : '删除会话' }}</button></div></section></div>
    <div v-if="workspacePendingDelete" class="modal-backdrop"><section class="modal-card delete-workspace-modal" role="dialog" aria-modal="true" aria-labelledby="delete-workspace-title"><div class="modal-head"><div><div class="eyebrow">REMOVE WORKSPACE</div><h2 id="delete-workspace-title">从 CodyWork 移除 Workspace？</h2></div><button class="icon-button" aria-label="关闭移除 Workspace 弹窗" :disabled="deletingWorkspace" @click="closeDeleteWorkspace">×</button></div><p>将移除“{{ workspacePendingDelete.name }}”在 CodyWork 中的登记，以及关联的 Repo、Demand、会话审计与缓存数据。</p><p class="delete-workspace-note">不会删除 <code>{{ workspacePendingDelete.path }}</code>，也不会删除其中的 Git 仓库、分支或 Worktree。</p><p class="delete-workspace-confirm">这是一次仅作用于 CodyWork 本地记录的操作。确认后可随时重新添加该目录。</p><p v-if="deleteWorkspaceError" class="form-error" role="alert">{{ deleteWorkspaceError }}</p><div class="modal-actions"><button class="btn" :disabled="deletingWorkspace" @click="closeDeleteWorkspace">取消</button><button class="btn danger" :disabled="deletingWorkspace" @click="deleteWorkspace">{{ deletingWorkspace ? '移除中…' : '确认移除' }}</button></div></section></div>
    <div v-if="baselineCleanupPending" class="modal-backdrop"><section class="modal-card baseline-cleanup-modal" role="dialog" aria-modal="true" aria-labelledby="baseline-cleanup-title" aria-describedby="baseline-cleanup-description"><div class="modal-head"><div><div class="eyebrow">DISCARD BASELINE CHANGES</div><h2 id="baseline-cleanup-title">清理基线变更？</h2></div><button class="icon-button" aria-label="关闭清理基线变更弹窗" :disabled="Boolean(clearingRepositoryId)" @click="closeBaselineCleanup">×</button></div><p id="baseline-cleanup-description">将丢弃 <strong>{{ baselineCleanupPending.name }}</strong> 基线仓库中的全部未提交修改和未跟踪文件。</p><p class="baseline-cleanup-note">不会切换分支、不会回退已提交代码、不会同步远端；<strong>不会修改任何 Demand Worktree。</strong></p><p class="baseline-cleanup-path"><code>{{ baselineCleanupPending.path }}</code></p><p v-if="baselineCleanupError" class="form-error" role="alert">{{ baselineCleanupError }}</p><div class="modal-actions"><button class="btn" :disabled="Boolean(clearingRepositoryId)" @click="closeBaselineCleanup">取消</button><button class="btn danger" :disabled="Boolean(clearingRepositoryId)" @click="confirmBaselineCleanup">{{ clearingRepositoryId ? '清理中…' : '确认丢弃基线变更' }}</button></div></section></div>
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
import {
  composerHasContent,
  isKnownReasoningEffort,
  mergeCollaborationModeOptions,
  reconcileSelectedCollaborationModeName,
  resolveComposerSubmitMode,
  type ComposerCollaborationModeOption,
  type ComposerSubmitMode,
  type ComposerImage,
} from '@codycodeagent/cody-web-core/composer'
import type { ConversationSubscriptionEvent } from '@codycodeagent/cody-web-core/client'
import { CodyComposer, CodyConversation, conversationEntriesFromState, useConversationController, type CodyComposerOption, type CodyMessage } from '@codycodeagent/cody-web-core/vue'
import '@codycodeagent/cody-web-core/vue/style.css'
import WorkspaceSetupDialog from './components/WorkspaceSetupDialog.vue'
import WorkbenchSidebar from './components/WorkbenchSidebar.vue'
import AddDemandRepositoryDialog from './components/AddDemandRepositoryDialog.vue'
import BindThreadDialog from './components/BindThreadDialog.vue'
import DemandToolbox from './components/DemandToolbox.vue'
import QuickActionBar from './components/QuickActionBar.vue'
import QuickActionSettings from './components/QuickActionSettings.vue'
import SettingsOverview from './components/SettingsOverview.vue'
import FeishuChannelSettings from './components/FeishuChannelSettings.vue'
import { filterDemandRepositories, repositoriesNotInDemand } from './demandRepositories'
import { buildDocumentationMaintenancePrompt } from './documentationMaintenance'
import { createConversationEventSocket, initialConversationSocketSnapshot, type ConversationSocketSnapshot } from './conversationSocket'
import { readPanelCollapsed, writePanelCollapsed } from './panelState'
import { quickActionsForScene, resolveQuickActionSkills } from './quickActions'
import {
  api,
  type AvailableNativeThread,
  type Conversation,
  type ConversationImageUpload,
  type ConversationEvent,
  type ConversationPermissionMode,
  type ComposerOptions,
  type DashboardSnapshot,
  type Demand,
  type KnowledgeDocument,
  type QuickAction,
  type QuickActionInput,
  type Repository,
  type RepositorySyncResult,
  type RuntimeSettings,
  type SkillInstallStatus,
  type Workspace,
  type WorkspaceSkill,
} from './api'
import {
  canDeleteConversation as canDeleteConversationRule,
  conversationStatusFromState,
  conversationStatusLabel as statusLabel,
  dashboardCacheLabel as formatDashboardCacheLabel,
  dashboardNeedsRefresh,
  deleteConversationTitle as deleteConversationTitleRule,
  filterNativeThreads,
  filterSkills,
  groupThreadProjects,
  matchDemandRoute,
  parseWorkbenchRoute,
  threadTitle,
  skillSearchSummary,
  sameNameSkills,
  skillIdentityDescription,
  skillSourceLabel,
  workbenchUrl,
  type HistoryMode,
  type ThreadProject,
  type WorkbenchSettingsSection,
} from './workbenchUi'
type Page = 'dashboard' | 'demands' | 'knowledge' | 'skills' | 'settings' | 'chat'

const loading = ref(true); const error = ref(''); const modalError = ref(''); const workspaces = ref<Workspace[]>([]); const workspace = ref<Workspace | null>(null); const demands = ref<Demand[]>([]); const repositories = ref<Repository[]>([]); const selectedDemand = ref<Demand | null>(null); const conversations = ref<Conversation[]>([]); const selectedConversation = ref<Conversation | null>(null)
const { state: conversationState, connect: connectConversationState, reset: resetConversationState, submitUserMessage, retryFailedUserMessage, interrupt: interruptConversationState } = useConversationController()
const draft = ref(''); const sending = ref(false); const permission = ref<ConversationPermissionMode>('workspace-write'); const selectedModel = ref(''); const selectedReasoning = ref('medium'); const selectedSubmitMode = ref<ComposerSubmitMode>('queue'); const selectedCollaborationModeName = ref('default'); const selectedSkillsForTurn = ref<string[]>([]); const composerImages = ref<ComposerImage[]>([]); const composerImageError = ref(''); const uploadingImages = ref(false); const runtimeModels = ref<string[]>([]); const runtimeSkills = ref<ComposerOptions['skills']>([]); const runtimeCollaborationModes = ref<Array<{ name: string; mode: 'default' | 'plan'; label: string; model?: string; reasoningEffort?: string }>>([]); const socketConnection = ref<ConversationSocketSnapshot>(initialConversationSocketSnapshot()); const showWorkspacePicker = ref(false); const showCreateWorkspace = ref(false); const showCreateDemand = ref(false); const creating = ref(false); const creatingConversation = ref(false); const importingWorktrees = ref(false); const demandName = ref(''); const demandBranch = ref(''); const selectedRepositoryIds = ref<string[]>([]); const demandRepositoryQuery = ref(''); const scrollArea = ref<HTMLElement | null>(null); const showBindConversation = ref(false); const bindingConversation = ref(false); const boundNativeId = ref(''); const boundConversationTitle = ref(''); const nativeThreads = ref<AvailableNativeThread[]>([]); const threadPickerLoading = ref(false); const selectedThreadProject = ref(''); const threadQuery = ref(''); const manualThreadEntry = ref(false); const conversationPendingDelete = ref<Conversation | null>(null); const deletingConversation = ref(false); const deleteConversationError = ref(''); const renamingConversationId = ref(''); const conversationRenameDraft = ref(''); const conversationRenameError = ref(''); const savingConversationRename = ref(false); const workspacePendingDelete = ref<Workspace | null>(null); const deletingWorkspace = ref(false); const deleteWorkspaceError = ref('')
// Composer state belongs to a conversation. Keeping a single global draft made
// a failed message from one session appear in a newly-created session.
const draftByConversationId = new Map<string, string>()
const composerImagesByConversationId = new Map<string, ComposerImage[]>()
const activePage = ref<Page>('dashboard'); const dashboard = ref<DashboardSnapshot | null>(null); const dashboardRefreshing = ref(false); const knowledge = ref<KnowledgeDocument[]>([]); const selectedKnowledge = ref<KnowledgeDocument | null>(null); const knowledgeQuery = ref(''); const skills = ref<WorkspaceSkill[]>([]); const selectedSkill = ref<WorkspaceSkill | null>(null); const skillQuery = ref(''); const skillSource = ref(''); const installingSkill = ref(false); const skillJob = ref<SkillInstallStatus | null>(null); const runtime = ref<RuntimeSettings | null>(null); const runtimeCommand = ref(''); const runtimeMessage = ref(''); const testingRuntime = ref(false); const showAddRepository = ref(false); const repositorySource = ref<'folder' | 'git'>('folder'); const repositoryPath = ref(''); const repositoryUrl = ref(''); const repositoryName = ref(''); const demandNavExpanded = ref(true); const workspaceSidebarCollapsed = ref(readPanelCollapsed(typeof window === 'undefined' ? null : window.localStorage, 'workspace-sidebar')); const conversationSidebarCollapsed = ref(readPanelCollapsed(typeof window === 'undefined' ? null : window.localStorage, 'conversation-sidebar')); const copiedDemandPath = ref(''); const copiedDemandLink = ref('')
const settingsSection = ref<WorkbenchSettingsSection>('overview')
const quickActions = ref<QuickAction[]>([])
const selectedQuickActionId = ref('')
const savingQuickAction = ref(false)
const quickActionMessage = ref('')
const quickActionFeedback = ref('')
const showAddDemandRepository = ref(false)
const addingDemandRepository = ref(false)
const selectedDemandRepositoryId = ref('')
const demandRepositoryError = ref('')
const syncingRepositoryId = ref('')
const repositorySyncResults = ref<Record<string, RepositorySyncResult>>({})
const baselineCleanupPending = ref<Repository | null>(null)
const clearingRepositoryId = ref('')
const baselineCleanupError = ref('')
let copiedDemandPathTimer: number | null = null; let copiedDemandLinkTimer: number | null = null
let quickActionFeedbackTimer: number | null = null
const conversationScrollState = ref<ConversationScrollState | null>(null)
const visibleConversationEntryCount = ref(DEFAULT_VISIBLE_MESSAGE_COUNT)
const socketState = computed(() => socketConnection.value.status)
const socketLabel = computed(() => {
  const state = socketConnection.value
  if (state.status === 'connected') return '实时连接'
  if (state.status === 'connecting') return '连接中…'
  if (state.status === 'reconnecting') return `重连中 · 第 ${state.reconnectAttempt} 次`
  const code = state.closeCode === null ? '' : ` · ${state.closeCode}`
  return `连接已关闭${code}`
})
const socketDetail = computed(() => {
  const state = socketConnection.value
  if (state.status !== 'disconnected') return socketLabel.value
  return `WebSocket 已关闭（${state.closeCode ?? '无关闭码'}）：${state.closeReason || '未提供原因'}`
})
const isRunning = computed(() => Boolean(conversationState.value.activeTurnId))
const canSettleConversation = computed(() => Boolean(selectedConversation.value && selectedConversation.value.permissionMode !== 'read-only' && !sending.value && !isRunning.value))
const settleConversationTitle = computed(() => {
  if (!selectedConversation.value) return '请先选择会话'
  if (selectedConversation.value.permissionMode === 'read-only') return '只读会话不能更新 Demand 文档'
  if (isRunning.value || sending.value) return '请等待当前回复结束'
  return '让 AI 将当前会话沉淀到最合适的 Demand 文档'
})
const availableDemandRepositories = computed(() => repositoriesNotInDemand(repositories.value, selectedDemand.value))
const canAddDemandRepository = computed(() => Boolean(selectedDemand.value && availableDemandRepositories.value.length > 0 && !addingDemandRepository.value))
const filteredDemandCreationRepositories = computed(() => filterDemandRepositories(repositories.value, demandRepositoryQuery.value))
const demandRepositorySearchSummary = computed(() => {
  const displayed = filteredDemandCreationRepositories.value.length
  const total = repositories.value.length
  const selected = selectedRepositoryIds.value.length
  const matched = demandRepositoryQuery.value.trim() ? `匹配 ${displayed} / ${total} 个 Repo` : `共 ${total} 个 Repo`
  return selected ? `${matched}；已选择 ${selected} 个` : matched
})
const demandBaselineRepositories = computed(() => {
  const included = new Set(selectedDemand.value?.repositories.map(repository => repository.id) ?? [])
  return repositories.value.filter(repository => included.has(repository.id))
})
const threadContextUsage = computed(() => conversationState.value.contextUsage)
const allSharedConversationEntries = computed(() => conversationEntriesFromState(conversationState.value))
const hiddenConversationEntryCount = computed(() => hiddenMessageCount(allSharedConversationEntries.value.length, visibleConversationEntryCount.value))
const sharedConversationEntries = computed(() => allSharedConversationEntries.value.slice(
  visibleMessageStartIndex(allSharedConversationEntries.value.length, visibleConversationEntryCount.value),
))
const filteredKnowledge = computed(() => { const query = knowledgeQuery.value.trim().toLowerCase(); return query ? knowledge.value.filter(doc => `${doc.name} ${doc.relativePath}`.toLowerCase().includes(query)) : knowledge.value })
const filteredSkills = computed(() => filterSkills(skills.value, skillQuery.value))
const dashboardCacheLabel = computed(() => formatDashboardCacheLabel(dashboard.value?.cache))
const demandQuickActions = computed(() => quickActionsForScene(quickActions.value, 'demand-development'))
const settingsTitle = computed(() => settingsSection.value === 'quick-actions' ? '快捷指令' : settingsSection.value === 'runtime' ? 'Codex Runtime' : settingsSection.value === 'feishu' ? '飞书机器人' : '设置')
const threadProjects = computed<ThreadProject[]>(() => groupThreadProjects(nativeThreads.value, selectedDemand.value?.repositories.map(repo => repo.worktreePath) ?? []))
const filteredNativeThreads = computed(() => filterNativeThreads(nativeThreads.value, selectedThreadProject.value, threadQuery.value))
const canBindNativeThread = computed(() => manualThreadEntry.value ? Boolean(boundNativeId.value.trim()) : filteredNativeThreads.value.some(thread => thread.nativeId === boundNativeId.value && !thread.bound))
const composerModels = computed<CodyComposerOption[]>(() => runtimeModels.value.map(model => ({ value: model, label: model })))
const coreCollaborationModes = computed<ComposerCollaborationModeOption[]>(() => {
  return mergeCollaborationModeOptions(runtimeCollaborationModes.value.map((mode) => {
    const reasoningEffort = mode.reasoningEffort ?? ''
    return {
      name: mode.name,
      mode: mode.mode,
      label: mode.label,
      model: mode.model ?? '',
      reasoningEffort: isKnownReasoningEffort(reasoningEffort) ? reasoningEffort : '',
      developerInstructions: null,
    }
  }))
})
const composerCollaborationModes = computed<CodyComposerOption[]>(() => coreCollaborationModes.value.map(mode => ({ value: mode.name, label: mode.label })))
const selectedCollaborationMode = computed(() => reconcileSelectedCollaborationModeName(selectedCollaborationModeName.value, coreCollaborationModes.value))
const selectedCollaborationModeKind = computed<'default' | 'plan'>(() => coreCollaborationModes.value.find(mode => mode.name === selectedCollaborationMode.value)?.mode ?? 'default')
const composerSubmitModes = computed<CodyComposerOption[]>(() => [{ value: 'queue', label: '排队', description: '当前 Turn 结束后顺序执行。' }, { value: 'steer', label: '引导', description: '正在执行时发送给当前 Turn。' }])
const composerReasoningOptions = computed<CodyComposerOption[]>(() => [{ value: 'none', label: '无推理' }, { value: 'minimal', label: '极低' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }, { value: 'xhigh', label: '极高' }])
const composerPermissionOptions = computed<CodyComposerOption[]>(() => [{ value: 'read-only', label: '只读', description: '只能读取当前 Demand 的可读根目录。' }, { value: 'workspace-write', label: 'Worktree 写入', description: '仅可写当前 Demand 的 Worktree，危险操作仍须审批。' }, { value: 'yolo', label: 'YOLO', description: '自动批准，但仍不能访问或写入 Worktree 之外。' }])
const composerSkills = computed<CodyComposerOption[]>(() => runtimeSkills.value.map(skill => ({
  value: skill.id,
  label: skill.label,
  description: [skillSourceLabel(skill.scope), skill.description, skillIdentityDescription(runtimeSkills.value, skill), sameNameSkills(runtimeSkills.value, skill).length ? skill.path : ''].filter(Boolean).join(' · '),
})))

function displayConversationStatus(conversation: Conversation): Conversation['status'] {
  const state = selectedConversation.value?.id === conversation.id && conversationState.value.threadId === conversation.nativeId
    ? conversationState.value
    : null
  return conversationStatusFromState(conversation.status, state)
}
function setWorkspaceSidebarCollapsed(collapsed: boolean): void {
  workspaceSidebarCollapsed.value = collapsed
  writePanelCollapsed(window.localStorage, 'workspace-sidebar', collapsed)
}
function setConversationSidebarCollapsed(collapsed: boolean): void {
  conversationSidebarCollapsed.value = collapsed
  writePanelCollapsed(window.localStorage, 'conversation-sidebar', collapsed)
}
function conversationWithDisplayStatus(conversation: Conversation): Conversation {
  return { ...conversation, status: displayConversationStatus(conversation) }
}
function canDeleteConversation(conversation: Conversation): boolean { return canDeleteConversationRule(conversationWithDisplayStatus(conversation), conversations.value.length) }
function deleteConversationTitle(conversation: Conversation): string { return deleteConversationTitleRule(conversationWithDisplayStatus(conversation), conversations.value.length) }
async function startConversationRename(conversation: Conversation): Promise<void> {
  renamingConversationId.value = conversation.id
  conversationRenameDraft.value = conversation.title
  conversationRenameError.value = ''
  await nextTick()
  const input = document.querySelector<HTMLInputElement>(`[data-conversation-rename="${conversation.id}"]`)
  input?.focus()
  input?.select()
}
function cancelConversationRename(): void {
  if (savingConversationRename.value) return
  renamingConversationId.value = ''
  conversationRenameDraft.value = ''
  conversationRenameError.value = ''
}
async function saveConversationRename(conversation: Conversation): Promise<void> {
  if (!workspace.value || savingConversationRename.value) return
  const title = conversationRenameDraft.value.trim()
  if (!title) { conversationRenameError.value = '会话名称不能为空'; return }
  if (title === conversation.title) { cancelConversationRename(); return }
  savingConversationRename.value = true
  conversationRenameError.value = ''
  try {
    const renamed = await api.renameConversation(workspace.value.id, conversation.id, title)
    conversations.value = conversations.value.map(item => item.id === renamed.id ? renamed : item)
    if (selectedConversation.value?.id === renamed.id) selectedConversation.value = renamed
    renamingConversationId.value = ''
    conversationRenameDraft.value = ''
  } catch (cause) {
    conversationRenameError.value = cause instanceof Error ? cause.message : String(cause)
  } finally { savingConversationRename.value = false }
}
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
      draftByConversationId.delete(target.id)
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
function routeParams() { return parseWorkbenchRoute(window.location.search) }
function demandFromRoute(id: string): Demand | undefined { return matchDemandRoute(demands.value, id) }
function updateRoute(demand: Demand | null, mode: HistoryMode): void {
  if (mode === 'none') return
  const page = activePage.value === 'chat' ? 'dashboard' : activePage.value
  const url = workbenchUrl(window.location.href, workspace.value?.id ?? null, demand?.id ?? null, { page, settingsSection: settingsSection.value })
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
  socketConnection.value = initialConversationSocketSnapshot()
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
    if (active) await selectWorkspace(active, { demandId: route.demandId, page: route.page, settingsSection: route.settingsSection, history: 'replace' })
  } catch (cause) {
    if (sequence === workspaceLoadSequence) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (sequence === workspaceLoadSequence) loading.value = false
  }
}
function goTo(page: Exclude<Page, 'chat'>): void {
  if (page === 'settings') settingsSection.value = 'overview'
  activePage.value = page
  selectedDemand.value = null
  clearConversationState()
  updateRoute(null, 'push')
  if (page === 'dashboard') void refreshDashboard()
  if (page === 'knowledge') void loadKnowledge()
  if (page === 'skills') void loadSkills()
  if (page === 'settings') void loadQuickActions()
}
async function openSettingsSection(section: WorkbenchSettingsSection): Promise<void> {
  settingsSection.value = section
  activePage.value = 'settings'
  updateRoute(null, 'push')
  if (section === 'runtime') await loadRuntime()
  if (section === 'quick-actions') await Promise.all([loadQuickActions(), loadSkills()])
}
async function selectWorkspace(next: Workspace, options: { demandId?: string | null; page?: Exclude<Page, 'chat'>; settingsSection?: WorkbenchSettingsSection; history?: HistoryMode } = {}): Promise<void> {
  // The list response is already authoritative enough to restore the shell.  Do
  // this before the optional "open" acknowledgement so a transient POST error
  // can never make an existing Workspace look as if it disappeared.
  workspace.value = next
  workspaces.value = workspaces.value.map((item) => ({ ...item, active: item.id === next.id }))
  repositorySyncResults.value = {}
  syncingRepositoryId.value = ''
  skillQuery.value = ''
  selectedSkill.value = null
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
      activePage.value = options.page ?? 'dashboard'
      settingsSection.value = options.settingsSection ?? 'overview'
      updateRoute(null, options.history ?? 'push')
      if (activePage.value === 'knowledge') await loadKnowledge()
      if (activePage.value === 'skills') await loadSkills()
      if (activePage.value === 'settings') {
        await loadQuickActions()
        if (settingsSection.value === 'runtime') await loadRuntime()
        if (settingsSection.value === 'quick-actions') await loadSkills()
      }
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
async function loadSkills(forceReload = false): Promise<void> {
  if (!workspace.value) return
  const nextSkills = await api.listSkills(workspace.value.id, forceReload)
  skills.value = nextSkills
  if (selectedSkill.value) selectedSkill.value = nextSkills.find(skill => skill.id === selectedSkill.value?.id) ?? null
}
async function loadQuickActions(): Promise<void> {
  if (!workspace.value) return
  try {
    quickActions.value = await api.listQuickActions(workspace.value.id)
    if (selectedQuickActionId.value && !quickActions.value.some(action => action.id === selectedQuickActionId.value)) selectedQuickActionId.value = ''
  } catch (cause) {
    quickActions.value = []
    error.value = `快捷指令加载失败：${cause instanceof Error ? cause.message : String(cause)}`
  }
}
async function saveQuickAction(input: QuickActionInput & { id?: string }): Promise<void> {
  if (!workspace.value || savingQuickAction.value) return
  savingQuickAction.value = true
  quickActionMessage.value = ''
  try {
    const { id, ...payload } = input
    const saved = id
      ? await api.updateQuickAction(workspace.value.id, id, payload)
      : await api.createQuickAction(workspace.value.id, payload)
    const existing = quickActions.value.some(action => action.id === saved.id)
    quickActions.value = existing
      ? quickActions.value.map(action => action.id === saved.id ? saved : action)
      : [...quickActions.value, saved]
    selectedQuickActionId.value = saved.id
    quickActionMessage.value = id ? '修改已保存。' : '快捷指令已创建。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    savingQuickAction.value = false
  }
}
async function deleteQuickAction(id: string): Promise<void> {
  if (!workspace.value || savingQuickAction.value) return
  savingQuickAction.value = true
  quickActionMessage.value = ''
  try {
    await api.deleteQuickAction(workspace.value.id, id)
    quickActions.value = quickActions.value.filter(action => action.id !== id)
    selectedQuickActionId.value = quickActions.value[0]?.id ?? ''
    quickActionMessage.value = '快捷指令已删除。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    savingQuickAction.value = false
  }
}
function openSkill(skill: WorkspaceSkill): void { selectedSkill.value = skill }
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
    await loadSkills(true)
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
function openAddDemandRepository(): void {
  if (!canAddDemandRepository.value) return
  selectedDemandRepositoryId.value = ''
  demandRepositoryError.value = ''
  showAddDemandRepository.value = true
}
function closeAddDemandRepository(): void {
  if (addingDemandRepository.value) return
  showAddDemandRepository.value = false
}
async function addDemandRepository(): Promise<void> {
  const currentWorkspace = workspace.value
  const demand = selectedDemand.value
  const repositoryId = selectedDemandRepositoryId.value
  if (!currentWorkspace || !demand || !repositoryId || addingDemandRepository.value) return
  addingDemandRepository.value = true
  demandRepositoryError.value = ''
  try {
    const updatedDemand = await api.addRepositoryToDemand(currentWorkspace.id, demand.id, repositoryId)
    demands.value = demands.value.map(item => item.id === updatedDemand.id ? updatedDemand : item)
    selectedDemand.value = updatedDemand
    showAddDemandRepository.value = false
    selectedDemandRepositoryId.value = ''
    await refreshDashboard()
  } catch (cause) {
    demandRepositoryError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    addingDemandRepository.value = false
  }
}
async function syncRepositoryBaseline(repositoryId: string): Promise<void> {
  if (!workspace.value || syncingRepositoryId.value) return
  syncingRepositoryId.value = repositoryId
  try {
    const result = await api.syncRepository(workspace.value.id, repositoryId)
    repositorySyncResults.value = { ...repositorySyncResults.value, [repositoryId]: result }
    repositories.value = repositories.value.map(repository => repository.id === repositoryId ? result.repository : repository)
    await refreshDashboard()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    syncingRepositoryId.value = ''
  }
}
function requestBaselineCleanup(repository: Repository): void {
  if (!repository.dirty || clearingRepositoryId.value || syncingRepositoryId.value) return
  baselineCleanupError.value = ''
  baselineCleanupPending.value = repository
}
function closeBaselineCleanup(): void {
  if (clearingRepositoryId.value) return
  baselineCleanupPending.value = null
  baselineCleanupError.value = ''
}
async function confirmBaselineCleanup(): Promise<void> {
  const currentWorkspace = workspace.value
  const repository = baselineCleanupPending.value
  if (!currentWorkspace || !repository || clearingRepositoryId.value) return
  clearingRepositoryId.value = repository.id
  baselineCleanupError.value = ''
  try {
    const result = await api.clearRepositoryBaseline(currentWorkspace.id, repository.id)
    repositories.value = repositories.value.map(item => item.id === repository.id ? result.repository : item)
    baselineCleanupPending.value = null
    await refreshDashboard()
  } catch (cause) {
    baselineCleanupError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    clearingRepositoryId.value = ''
  }
}
async function openDemand(demand: Demand, history: HistoryMode = 'push'): Promise<void> { selectedDemand.value = demand; activePage.value = 'chat'; updateRoute(demand, history); await Promise.all([loadComposerOptions(demand.id), loadSkills(), loadQuickActions()]); conversations.value = await api.listConversations(workspace.value!.id, demand.id); if (!conversations.value.length) { const created = await api.createConversation(workspace.value!.id, demand.id); conversations.value = [created] }; await openConversation(conversations.value[0]!) }
function returnToDemandList(): void { selectedDemand.value = null; clearConversationState(); activePage.value = 'demands'; updateRoute(null, 'push') }
async function restoreRoute(): Promise<void> {
  const route = routeParams()
  const nextWorkspace = workspaces.value.find((item) => item.id === route.workspaceId) ?? workspace.value
  if (!nextWorkspace) return
  if (workspace.value?.id !== nextWorkspace.id) { await selectWorkspace(nextWorkspace, { demandId: route.demandId, page: route.page, settingsSection: route.settingsSection, history: 'none' }); return }
  if (route.demandId) {
    const demand = demandFromRoute(route.demandId)
    if (demand && selectedDemand.value?.id !== demand.id) await openDemand(demand, 'none')
    else if (!demand) error.value = '链接中的 Demand 不存在。'
    return
  }
  selectedDemand.value = null
  clearConversationState()
  activePage.value = route.page
  settingsSection.value = route.settingsSection
  if (route.page === 'knowledge') await loadKnowledge()
  if (route.page === 'skills') await loadSkills()
  if (route.page === 'settings') {
    await loadQuickActions()
    if (route.settingsSection === 'runtime') await loadRuntime()
    if (route.settingsSection === 'quick-actions') await loadSkills()
  }
}
async function connect(conversation: Conversation): Promise<void> {
  visibleConversationEntryCount.value = DEFAULT_VISIBLE_MESSAGE_COUNT
  conversationScrollState.value = null
  const workspaceId = workspace.value!.id
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.host || '127.0.0.1:3211'
  await connectConversationState(conversation.nativeId, {
    read: async () => (await api.conversationHistory(workspaceId, conversation.id)).events,
    snapshot: async () => await api.conversationHistory(workspaceId, conversation.id),
    submit: async (command) => {
      const input = command.input as {
        content: string
        settings?: { model?: string; reasoningEffort?: string; collaborationMode?: 'default' | 'plan'; skills?: string[] }
        imageIds?: string[]
      }
      const accepted = await api.sendMessage(
        workspaceId,
        conversation.id,
        command.clientCommandId,
        input.content,
        command.mode,
        input.settings,
        input.imageIds,
      )
      return { clientCommandId: accepted.commandId }
    },
    interrupt: async () => {
      await api.interruptConversation(workspaceId, conversation.id)
    },
    subscribe: (_threadId, listener) => {
      const realtime = createConversationEventSocket({
        url: `${protocol}://${host}/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversation.id)}/events`,
        onEvent(event) {
          const productEvent = event as ConversationEvent
          listener({ type: 'event', event: productEvent, ownerRevision: productEvent.ownerRevision } satisfies ConversationSubscriptionEvent)
        },
        onConnection(event) { listener(event) },
        onState(state) {
          socketConnection.value = state
        },
      })
      return () => realtime.close()
    },
  })
}
async function openConversation(conversation: Conversation): Promise<void> { selectedConversation.value = conversation; permission.value = conversation.permissionMode; selectedCollaborationModeName.value = 'default'; selectedSkillsForTurn.value = []; draft.value = draftByConversationId.get(conversation.id) ?? ''; composerImages.value = composerImagesByConversationId.get(conversation.id) ?? []; composerImageError.value = ''; error.value = ''; await connect(conversation); await scrollToBottom(true) }
async function workspaceCreated(created: Workspace): Promise<void> {
  showCreateWorkspace.value = false
  const nextWorkspaces = await api.listWorkspaces()
  workspaces.value = nextWorkspaces
  const target = nextWorkspaces.find(item => item.id === created.id) ?? created
  await selectWorkspace(target, { history: 'push' })
}
async function importExistingWorktrees(): Promise<void> { if (!workspace.value || importingWorktrees.value) return; importingWorktrees.value = true; try { const result = await api.importExistingWorktrees(workspace.value.id); demands.value = await api.listDemands(workspace.value.id); await refreshDashboard(); error.value = result.imported.length ? `已导入 ${result.imported.length} 个已有 Demand。` : result.skipped.length ? `没有可导入的 Worktree：${result.skipped[0]!.reason}` : '没有发现尚未导入的 Worktree。' } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { importingWorktrees.value = false } }
async function createDemand(): Promise<void> { if (!workspace.value) return; creating.value = true; modalError.value = ''; try { const created = await api.createDemand(workspace.value.id, { name: demandName.value.trim(), ...(demandBranch.value.trim() ? { branchName: demandBranch.value.trim() } : {}), repositoryIds: selectedRepositoryIds.value }); demands.value = await api.listDemands(workspace.value.id); showCreateDemand.value = false; demandName.value = ''; demandBranch.value = ''; demandRepositoryQuery.value = ''; selectedRepositoryIds.value = []; const demand = demands.value.find((item) => item.id === created.demand.id); if (demand) await openDemand(demand) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { creating.value = false } }
async function createConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value || creatingConversation.value) return; creatingConversation.value = true; error.value = ''; try { const created = await api.createConversation(workspace.value.id, selectedDemand.value.id); conversations.value = [created, ...conversations.value]; await openConversation(created) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { creatingConversation.value = false } }
async function settleConversation(): Promise<void> {
  if (!selectedDemand.value || !selectedConversation.value) return
  if (selectedConversation.value.permissionMode === 'read-only') { error.value = '只读会话不能更新 Demand 文档，请先切换到 Worktree 写入模式。'; return }
  if (isRunning.value || sending.value) { error.value = '请等待当前回复结束后再沉淀会话。'; return }
  const prompt = buildDocumentationMaintenancePrompt({
    demandName: selectedDemand.value.name,
    branchName: selectedDemand.value.branchName,
    conversationTitle: selectedConversation.value.title,
  })
  await submitConversationMessage(prompt, [], '沉淀当前会话到 Demand 文档', [])
}
async function openBindConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value) return; modalError.value = ''; boundNativeId.value = ''; boundConversationTitle.value = ''; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false; showBindConversation.value = true; threadPickerLoading.value = true; try { nativeThreads.value = await api.listAvailableNativeThreads(workspace.value.id, selectedDemand.value.id) } catch (cause) { nativeThreads.value = []; modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { threadPickerLoading.value = false } }
function closeBindConversation(): void { if (bindingConversation.value) return; showBindConversation.value = false; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false }
function selectNativeThread(thread: AvailableNativeThread): void { if (thread.bound) return; boundNativeId.value = thread.nativeId; if (!boundConversationTitle.value.trim()) boundConversationTitle.value = threadTitle(thread) }
async function bindConversation(): Promise<void> { if (!workspace.value || !selectedDemand.value || bindingConversation.value || !canBindNativeThread.value) return; bindingConversation.value = true; modalError.value = ''; try { const created = await api.bindConversation(workspace.value.id, selectedDemand.value.id, { nativeId: boundNativeId.value.trim(), ...(boundConversationTitle.value.trim() ? { title: boundConversationTitle.value.trim() } : {}) }); conversations.value = [created, ...conversations.value]; showBindConversation.value = false; selectedThreadProject.value = ''; threadQuery.value = ''; manualThreadEntry.value = false; boundNativeId.value = ''; boundConversationTitle.value = ''; await openConversation(created) } catch (cause) { modalError.value = cause instanceof Error ? cause.message : String(cause) } finally { bindingConversation.value = false } }
async function submitConversationMessage(
  content: string,
  turnSkills: string[],
  optimisticText: string,
  skillReferences: NonNullable<CodyMessage['skills']>,
  images: ComposerImage[] = [],
  modeOverride?: ComposerSubmitMode,
): Promise<boolean> {
  if (!workspace.value || !selectedConversation.value || sending.value) return false
  if (!composerHasContent({ text: optimisticText, skills: turnSkills, images })) return false
  sending.value = true
  try {
    await submitUserMessage(
      { text: optimisticText, ...(images.length ? { images: images.map(image => image.url) } : {}), ...(skillReferences.length ? { skills: skillReferences } : {}) },
      {
        mode: modeOverride ?? resolveComposerSubmitMode(isRunning.value, selectedSubmitMode.value),
        input: {
          content,
          ...(images.length ? { imageIds: images.map(image => image.id) } : {}),
          settings: {
            ...(selectedModel.value ? { model: selectedModel.value } : {}),
            ...(selectedReasoning.value ? { reasoningEffort: selectedReasoning.value } : {}),
            collaborationMode: selectedCollaborationModeKind.value,
            ...(turnSkills.length ? { skills: turnSkills } : {}),
          },
        },
      },
    )
    return true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    return false
  } finally {
    sending.value = false
  }
}
async function executeQuickAction(action: QuickAction): Promise<void> {
  if (!selectedConversation.value || sending.value || uploadingImages.value) return
  const resolved = resolveQuickActionSkills(action, runtimeSkills.value)
  if (resolved.missing.length) {
    error.value = `快捷指令“${action.name}”引用的 Skill 已失效：${resolved.missing.join('、')}。请到设置中修复。`
    return
  }
  const skillReferences = resolved.ids.flatMap((id) => {
    const skill = runtimeSkills.value.find(candidate => candidate.id === id)
    return skill ? [{ name: skill.name, path: skill.id, displayName: skill.label }] : []
  })
  const queued = isRunning.value
  if (await submitConversationMessage(action.prompt, resolved.ids, action.prompt, skillReferences, [], 'queue')) {
    quickActionFeedback.value = queued ? `“${action.name}”已加入队列` : `“${action.name}”已发送`
    if (quickActionFeedbackTimer !== null) window.clearTimeout(quickActionFeedbackTimer)
    quickActionFeedbackTimer = window.setTimeout(() => { quickActionFeedback.value = '' }, 2_500)
  }
}
async function sendMessage(): Promise<void> {
  if (!selectedConversation.value || sending.value || uploadingImages.value) return
  const conversationId = selectedConversation.value.id
  const content = draft.value.trim()
  const turnSkills = [...selectedSkillsForTurn.value]
  const images = [...composerImages.value]
  if (!composerHasContent({ text: content, skills: turnSkills, images })) return
  const skillReferences = turnSkills.flatMap((id) => {
    const skill = runtimeSkills.value.find((candidate) => candidate.id === id)
    return skill ? [{ name: skill.name, path: skill.id, displayName: skill.label }] : []
  })
  const optimisticText = content || skillReferences.map((skill) => `$${skill.displayName ?? skill.name}`).join(' ')
  draft.value = ''
  draftByConversationId.delete(conversationId)
  if (await submitConversationMessage(content, turnSkills, optimisticText, skillReferences, images)) {
    selectedSkillsForTurn.value = []
    composerImages.value = []
    composerImagesByConversationId.delete(conversationId)
  }
}
async function retryFailedMessage(message: CodyMessage): Promise<void> {
  if (sending.value || message.outbox?.status !== 'failed') return
  const turnSkills = (message.skills ?? [])
    .map((skill) => skill.path)
    .filter((id) => runtimeSkills.value.some((skill) => skill.id === id))
  const imageIds = (message.images ?? []).map(imageIdFromUrl).filter((id): id is string => Boolean(id))
  sending.value = true
  try {
    await retryFailedUserMessage(message.id, {
      mode: resolveComposerSubmitMode(isRunning.value, selectedSubmitMode.value),
      input: {
        content: message.text,
        ...(imageIds.length ? { imageIds } : {}),
        settings: {
          ...(selectedModel.value ? { model: selectedModel.value } : {}),
          ...(selectedReasoning.value ? { reasoningEffort: selectedReasoning.value } : {}),
          collaborationMode: selectedCollaborationModeKind.value,
          ...(turnSkills.length ? { skills: turnSkills } : {}),
        },
      },
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    sending.value = false
  }
}
function updateDraft(value: string): void { draft.value = value; const conversationId = selectedConversation.value?.id; if (!conversationId) return; if (value) draftByConversationId.set(conversationId, value); else draftByConversationId.delete(conversationId) }
function imageIdFromUrl(url: string): string | null {
  try {
    const id = new URL(url, window.location.origin).pathname.split('/').at(-1)
    return id?.startsWith('image_') ? id : null
  } catch { return null }
}
function imageFromUpload(upload: ConversationImageUpload): ComposerImage {
  // `path` is deliberately empty in the browser. It remains present for
  // compatibility with the current tagged Core type; CodyWork resolves the
  // opaque id to its private local path only on the server.
  return { id: upload.id, name: upload.name, path: '', url: upload.url, mimeType: upload.mimeType }
}
function persistComposerImages(images: ComposerImage[]): void {
  composerImages.value = images
  const conversationId = selectedConversation.value?.id
  if (!conversationId) return
  if (images.length) composerImagesByConversationId.set(conversationId, images)
  else composerImagesByConversationId.delete(conversationId)
}
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取图片'))
    reader.onerror = () => reject(new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
}
async function uploadImages(files: File[]): Promise<void> {
  const activeWorkspace = workspace.value
  const activeConversation = selectedConversation.value
  if (!activeWorkspace || !activeConversation || uploadingImages.value || !files.length) return
  const remaining = 8 - composerImages.value.length
  if (remaining <= 0) { composerImageError.value = '每条消息最多附加 8 张图片'; return }
  const candidates = files.slice(0, remaining)
  composerImageError.value = files.length > remaining ? '已达到 8 张图片上限，未添加其余图片' : ''
  uploadingImages.value = true
  try {
    const uploaded = await Promise.all(candidates.map(async file => imageFromUpload(await api.uploadConversationImage(
      activeWorkspace.id,
      activeConversation.id,
      { name: file.name, dataUrl: await readFileAsDataUrl(file) },
    ))))
    if (workspace.value?.id !== activeWorkspace.id || selectedConversation.value?.id !== activeConversation.id) return
    persistComposerImages([...composerImages.value, ...uploaded])
  } catch (cause) {
    composerImageError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    uploadingImages.value = false
  }
}
function removeComposerImage(imageId: string): void { composerImageError.value = ''; persistComposerImages(composerImages.value.filter(image => image.id !== imageId)) }
async function savePermission(): Promise<void> { if (!workspace.value || !selectedConversation.value) return; try { const updated = await api.setConversationPermission(workspace.value.id, selectedConversation.value.id, permission.value); selectedConversation.value = updated; conversations.value = conversations.value.map((item) => item.id === updated.id ? updated : item) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } }
async function loadComposerOptions(demandId: string): Promise<void> { if (!workspace.value) return; try { const options = await api.composerOptions(workspace.value.id, demandId); runtimeModels.value = options.models; runtimeSkills.value = options.skills; runtimeCollaborationModes.value = options.collaborationModes; selectedSkillsForTurn.value = selectedSkillsForTurn.value.filter(id => options.skills.some(skill => skill.id === id)); if (!selectedModel.value && options.models.length) selectedModel.value = options.models[0]! } catch { runtimeModels.value = []; runtimeSkills.value = []; runtimeCollaborationModes.value = []; selectedSkillsForTurn.value = [] } }
function selectCollaborationMode(name: string): void {
  const next = coreCollaborationModes.value.find(mode => mode.name === name) ?? coreCollaborationModes.value[0]
  if (!next) return
  selectedCollaborationModeName.value = next.name
  if (next.model) selectedModel.value = next.model
  if (next.reasoningEffort) selectedReasoning.value = next.reasoningEffort
}
function selectReasoning(value: string): void { if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)) selectedReasoning.value = value }
async function selectPermission(value: string): Promise<void> { if (value !== 'read-only' && value !== 'workspace-write' && value !== 'yolo') return; const previous = permission.value; permission.value = value; await savePermission(); if (error.value) permission.value = previous }
async function interrupt(): Promise<void> { if (selectedConversation.value) await interruptConversationState() }
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
onBeforeUnmount(() => { if (copiedDemandPathTimer !== null) window.clearTimeout(copiedDemandPathTimer); if (copiedDemandLinkTimer !== null) window.clearTimeout(copiedDemandLinkTimer); if (quickActionFeedbackTimer !== null) window.clearTimeout(quickActionFeedbackTimer); if (dashboardTimer !== null) window.clearInterval(dashboardTimer) })
</script>
