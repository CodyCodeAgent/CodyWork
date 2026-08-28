# CodyWork 端到端功能验证报告

- 验证日期：2026-08-29（Asia/Shanghai）
- 目标环境：`http://10.37.222.12:3001`
- CodyWork 分支：`codex/e2e-full-verification-fixes`
- CodyWebCore：`v0.6.7` / `dd86596`
- CodyWeb：`main` / `ea39fd5`
- 部署目录：`/data00/home/gouchao/code/github/CodyWork-unified`

## 结论

CodyWork 的 Workspace → Repository → Demand → Worktree 主动线、原生 Codex Thread 会话链路、权限隔离、深链接、历史恢复、实时状态和主动停止均已完成端到端验证。此次发现的问题已优先在 CodyWebCore 修复，没有在 CodyWork 再造一套状态机。

当前远端开发机无法稳定访问 ChatGPT/MCP 上游，因此依赖完整模型回复的少数场景在本轮被标记为“外部阻塞”，不冒充通过。App Server 本身处于 `running/initialized`，请求、通知和主动中断链路正常。

## 产品与架构原则

本项目尚未上线，不承担历史兼容成本：

1. 可以破坏式重构；错误边界直接改正，不保留长期双实现。
2. AI 交互的协议、Runtime、事件归一化、conversation reducer、Composer 和通用展示能力应进入 CodyWebCore。
3. CodyWork 只保留 Workspace、Demand、Worktree、权限根目录、业务导航和部署适配。
4. CodyWeb 只保留飞书、任务、catalog、审计等产品能力及其 adapter。
5. 原生 Codex Thread 是消息历史的唯一 durable source；CodyWork 不再镜像 SQLite `conversation_events`。

## 验证环境

| 项目 | 结果 |
| --- | --- |
| CodyWork Web | `0.0.0.0:3001`，HTTP 200 |
| CodyWork Server | `127.0.0.1:3210`，`/api/runtime` HTTP 200 |
| CodyWebCore runtime | `cody-web-core/0.6.7` |
| CodyWeb | `0.0.0.0:3000`，部署期间未停止、未重启 |
| 测试 Workspace | `/data00/home/gouchao/code/github/CodyWork-e2e-csr` |
| 测试 Demand | `E2E Multi Repo` / `codex/e2e-multi-repo` |

## 功能矩阵

状态含义：`通过` 表示有自动化或真实浏览器证据；`外部阻塞` 表示产品链路已进入上游，但远端网络未返回足够结果；`待下沉` 表示功能可用但仍存在重复架构。

| 领域 | 场景 | 状态 | 证据或说明 |
| --- | --- | --- | --- |
| Workspace | 本地目录创建、服务端目录选择 | 通过 | 真实浏览器创建并进入 |
| Workspace | 已有 Workspace 恢复 | 通过 | 刷新后按 URL 和服务端状态恢复 |
| Workspace | 删除二次确认 | 通过 | 删除仅移除 CodyWork 登记，不删除源码目录 |
| Workspace | 概览缓存与后台刷新 | 通过 | 首屏读缓存；刷新请求去重；后台更新 |
| Repository | 扫描多仓库、dirty 标签 | 通过 | 多仓库列表、clean/dirty 状态可见 |
| Repository | 添加本地仓库与 Git clone | 通过 | 两种入口均完成 |
| Demand | 从已有 worktree 初始化 Demand | 通过 | 无需求名时使用分支名 |
| Demand | 多仓库独立 Worktree | 通过 | `repo-alpha/repo-beta/repo-gamma` |
| Demand | 专属 URL 与刷新直达 | 通过 | `?workspace=...&demand=...` 刷新恢复 |
| Demand | Worktree 路径展示与复制 | 通过 | 需求页顶部可复制路径和需求链接 |
| 导航 | 需求列表滚动、折叠、选中态 | 通过 | 真实浏览器验证 |
| 会话 | 新建、切换、删除会话绑定 | 通过 | 删除保留原生 Thread 和历史，文案已修正 |
| Thread | 列表搜索与绑定非 active Thread | 通过 | 支持项目过滤与全局搜索 |
| Thread | active Thread 跨 owner 绑定 | 受限 | Codex owner 限制；需要统一 Runtime owner/handoff 才能彻底解决 |
| 历史 | Native thread/read 恢复 | 通过 | URL 刷新后原生历史恢复，无 SQLite 消息镜像 |
| 历史 | live/history 去重与 optimistic 收敛 | 通过 | Core reducer 自动化测试与浏览器历史恢复 |
| 实时 | 用户消息、assistant 增量 | 通过 | 正常上游期间验证 `E2E-PONG` 等回复 |
| 实时 | retry/reconnecting 可见 | 通过 | 浏览器显示 `Reconnecting... 2/5` 和恢复状态 |
| 实时 | 用户主动停止 | 通过 | 0.6.7：显示“本次回复已停止”，状态回到“就绪”，无失败条、不回填输入 |
| 模式 | Default / Plan | 通过 | Plan 模式响应和退出已验证 |
| 模式 | queue | 通过 | active turn 下第二条消息进入队列 |
| 模式 | steer | 部分通过 | 协调器与输入映射测试通过；完整远端回复受上游阻塞 |
| 模型 | 模型与 reasoning 选择 | 通过 | `gpt-5.6-luna/high` 返回过指定响应 |
| 权限 | read-only 拒绝写入 | 通过 | 目标文件未生成 |
| 权限 | Worktree 写入 | 通过 | 只在 Demand Worktree 内写入成功 |
| 权限 | Workspace 外路径隔离 | 通过 | server policy 测试覆盖 |
| Skills | 仅显式选择 Skill | 通过 | 不再把全部 Skill 注入本轮输入 |
| Skills | 非法 Skill 诊断 | 通过 | 缺失 frontmatter 进入 diagnostics，不静默吞掉 |
| 工具 | command/tool timeline | 通过 | live running/completed 状态可见 |
| 工具 | 完成项收起与连续合并 | 通过 | command/agent/file-change 连续项合并 |
| 文件变更 | 分组、折叠、文件数摘要 | 通过 | Core reducer/UI 测试与既有历史验证 |
| 审批 | question 卡片 | 通过 | Plan `request_user_input` 真实交互完成 |
| 审批 | 高风险写入拒绝 | 外部阻塞 | 当前上游连接无法稳定推进到审批请求 |
| Markdown | GFM、代码、高亮、表格、复制 | 通过 | 共用 Core Markdown；自动化和既有会话验证 |
| Markdown | Mermaid、图片预览 | 部分通过 | 构建与组件测试通过；本轮远端生成回复受上游阻塞 |
| Runtime | 单进程初始化与 diagnostics | 通过 | 0.6.7 running/initialized，pending=0 |
| Runtime | 进程重启、页面重连 | 通过 | 部署重启后页面恢复，Realtime connected |
| Runtime | provider timeout 呈现 | 通过 | 不再表现为“没反应”，Core 显示重试/连接中断 |

## 本轮发现并修复的问题

### 1. provider 重试被产品层吞掉

原先 CodyWork 只维护本地 `liveStatus`，Codex 的 reconnecting 信息没有进入统一 reducer，用户看到消息发出但没有响应。

修复：在 CodyWebCore 0.6.6 中把 working、provider retry、approval/question waiting、disconnected recovery 统一生成为共享 live-turn activity；CodyWork 删除本地重复状态。

### 2. 用户主动停止被错误归类为失败

原生状态 `interrupted` 被映射为 `turn.failed`，导致红色失败卡、失败状态和输入回填。

修复：CodyWebCore 0.6.7 新增 `turn.interrupted`，历史、live reducer、工具取消和 Vue 展示全链路保留中断语义；CodyWork coordinator 将其回收到 idle，不写 runtime failure。

真实浏览器复测结果：

- 发送 `Reply exactly INTERRUPT-067-SMOKE.` 后进入“执行中”；
- 点击停止后出现“本次回复已停止”；
- 会话状态变为“就绪”；
- 无红色失败提示；
- Composer 保持为空。

### 3. terminal 错误中文标点重复

修复 CodyWork 错误文案拼接，避免 `。。`。

### 4. 请求卡重复渲染

CodyWork composer 曾额外渲染产品层 request card，与共享 conversation request card 重复。已删除本地重复渲染，以 Core 为唯一展示来源。

### 5. 会话删除语义不准确

删除的是 Demand 与 Thread 的 CodyWork 绑定，不是 Codex 原生 Thread。二次确认文案已改为明确保留原生 Thread 和历史。

### 6. 自动化测试可能消费旧 Core dist

CodyWebCore 根测试脚本已调整为先构建 Core、再运行 Vue 测试，避免 workspace package 的旧 dist 造成假失败或假通过。

## 自动化验证

| 仓库 | 验证结果 |
| --- | --- |
| CodyWebCore | Core 36 项通过，Vue 11 项通过，typecheck/build 通过 |
| CodyWork Server | 43 项通过 |
| CodyWork Web | 2 项通过，生产构建通过 |
| CodyWork 全仓 | typecheck/build 通过 |
| CodyWeb | 143 个测试文件、960 项测试通过，typecheck/build 通过 |

## 远端上游阻塞

部署后的 `/api/runtime/diagnostics` 显示：

- App Server `running=true`、`initialized=true`；
- client request 已完成，无 pending RPC；
- model refresh 多次出现 `timeout waiting for child process to exit`；
- MCP 多次无法向 `https://chatgpt.com/backend-api/ps/mcp` 发送请求；
- Skill 与无 Skill 的 turn 都能复现上游断流。

因此，本轮模型完整回复、危险审批、实时文件变更和 Mermaid 新回复的剩余场景属于远端网络/上游阻塞。CodyWork 已正确显示 retry 和 interrupted，不再把它伪装成静默无响应。

## SQLite 边界

CodyWork 不保留 SQLite 消息事件链：数据库初始化会删除旧 `conversation_events`，`history()` 直接读取 native Codex Thread。

仍保留的 SQLite 内容是 CodyWork 业务数据：Workspace、Repository、Demand、Conversation 绑定元数据和 bounded audit。`conversation_audits` 用于操作/审批/诊断审计，不作为消息历史 source of truth。

## 共享边界现状

已经下沉到 CodyWebCore：

- App Server host、RPC、通知、server request 和 diagnostics；
- canonical turn input 与能力兼容；
- native notification/history 归一化；
- conversation reducer、live/history authority、retry/interrupted；
- tool status/preview、Markdown/Mermaid 安全渲染；
- CodyWork 当前使用的共享 Conversation/Composer 基础组件。

仍应继续下沉：

- CodyWeb 的成熟 `ThreadConversation`、`ThreadComposer`、`ThreadActivityPanel` 通用结构；
- approval risk、question、diff/file-change grouping、composer images/context/skills；
- history window、latest-wins read、scroll anchor/follow-bottom；
- tool timeline 的完整视图模型和产品无关样式 tokens。

建议下一阶段直接以 CodyWeb 的成熟实现为基线重构 Core 组件，不保留 CodyWork 旧组件兼容层。Core 通过 adapter/slot 接收产品文案、图标、权限策略和业务动作；两端删除本地重复实现。

## 部署与安全检查

- 使用精确 PID/PGID 停止 CodyWork，停止前校验 `/proc/<pid>/cwd`；
- 未使用 `killall node` 或 `pkill node`；
- 3001/3210 启动前确认释放；
- 3000 的 CodyWeb 进程 PID 保持不变；
- 日志和 PID 位于 `.runtime`；
- 部署脚本应以 `/api/runtime` 作为健康检查，当前项目没有 `/health` 路由。

## 测试清理

测试 Workspace 中曾创建一个非法 Skill fixture：

`/data00/home/gouchao/code/github/CodyWork-e2e-csr/.agents/skills/e2e-broken/SKILL.md`

它用于验证 malformed Skill 诊断，验证完成后已精确删除，并单独重启 CodyWork 后端清空旧诊断缓存；其他 Skill 未被修改。
