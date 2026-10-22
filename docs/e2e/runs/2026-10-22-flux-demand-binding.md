# CodyWork E2E 回归记录：Bits Flux on-demand bridge

- 日期：2026-10-22
- 执行者：Codex
- 代码 revision：`38d66eb` + 当前工作区改动
- Core 版本：`0.43.1`
- 环境与 URL：当前 production build，`http://127.0.0.1:43921/`
- 浏览器与视口：ChatGPT in-app Chromium；默认桌面视口、显式 `820×900`
- SQLite：`/tmp/codywork-flux-refactor-e2e.e4gBln/runtime/workbench.db`
- 一次性 Workspace：`/tmp/codywork-flux-refactor-e2e.e4gBln/workspaces/alpha`

## 结论

本轮 Flux 专项主路径通过：一个 Demand 可绑定、替换、解除并重新绑定一个 Flux 协作；缺少官方 Skill 时入口明确且指令禁用；Skill 就绪后，内置意图会把精确的 `flux-collab` Skill 作为结构化输入交给本地 Codex。刷新、服务重启和多 Tab 后，绑定、消息及会话均能恢复。

真实浏览器首次点击“安装官方 Skill”时发现并修复了一个既有 Runtime 缺陷：Skill 安装 Turn 把 `approval: none` 错误推导为 `dangerFullAccess`，启动失败后未观察的 `started` rejection 又会终止服务端。修复后安装 Turn 使用 `workspaceWrite + approvalPolicy: never`，同时观察 start/completion 两个 Promise；失败被包含在任务内，服务端保持健康。

本轮不能标记为所有受影响自然语言用例全绿：`E2E-003`、`E2E-005`、`E2E-006`、`E2E-017`、`E2E-018` 的全部扩展矩阵未逐项执行，见下表。Flux 专项、全部 P0 和 `E2E-022` 均有当前代码的浏览器证据。

## 用例结果

| 用例 | 结果 | 当前版本证据 |
| --- | --- | --- |
| E2E-001 | PASS | 错误密码显示“密码不正确”；正确密码进入；刷新与服务重启恢复同一 Workspace；第二 Tab 复用登录并进入应用。 |
| E2E-003 | NOT RUN | 已通过搜索分别选中 `beta`、`gamma` 创建多仓库 Demand，两个独立 Worktree 均为 `multi-repo-e2e` 分支；未执行远端新增提交、detached HEAD、失败回滚和“添加已有 Repo”完整矩阵。 |
| E2E-004 | PASS | 专属 URL 含 workspace、demand、conversation；直接打开、刷新和服务重启均恢复 Flux Demand、选中会话与历史；浏览器 back/forward 在 Demand 与概览间恢复正确 URL。 |
| E2E-005 | NOT RUN | UI 识别 `beta` 基线 dirty；确认弹窗明确只清基线；确认后基线未跟踪文件删除而 Demand Worktree 文件保留；`gamma` 单仓同步显示“远端基线已是最新”。未执行落后、分叉、detached、批量并发完整矩阵。 |
| E2E-006 | NOT RUN | 工作台导航和会话栏可折叠/展开；两个 Demand 各创建第二会话；会话重命名为 `Flux Follow-up E2E` 并刷新保留。未执行运行中禁止删除和最少保留一个会话的全部删除矩阵。 |
| E2E-007 | PASS | `SLOW_E2E optimistic unique 20261022` 在回复前立即显示一次，回复后和刷新后精确计数均为 1；另有启动失败 outbox 可见并提供重试。 |
| E2E-008 | PASS | 慢回复、Flux Skill Turn、普通 Turn 和审批 Turn 顺序稳定；审批后显示 `APPROVED` 与单个 Worked，刷新后无重复。 |
| E2E-011 | PASS | 两个 Tab 同时连接；Tab A 的消息在 Tab B 实时出现；多次服务重启后自动恢复历史且没有重复。 |
| E2E-016 | PASS | 默认桌面与 `820×900` 均检查概览和 Flux 工具箱；`innerWidth === scrollWidth === bodyScrollWidth === 820`。两个 Tab 的 console warn/error 均为空；最终服务端日志无未处理异常。 |
| E2E-017 | NOT RUN | 创建 `Flux Review E2E`，绑定两个结构化 Skill，设置专属 URL 刷新后保留，Demand 工具箱直接执行成功。未执行运行中排队、编辑/删除和 AI 授权/未授权落库完整矩阵。 |
| E2E-018 | NOT RUN | 临时隐藏 `fixture-skill` 后，Demand 工具箱按钮禁用，title 精确提示“Skill 已失效，请到设置中修复：fixture-skill”；恢复 Runtime Skill 后目录重新就绪。未按用例通过设置页重新选择 Skill 并保存配置。 |
| E2E-022 | PASS | Flux 安装入口立即打开 Agent 执行面板并展示官方安装来源和事件；合成安装任务收起后继续、重新打开后可暂停并进入“已暂停”；另一任务运行 `2 分 1 秒` 后自然完成，证明无固定 120 秒超时；面板在 820px 视口无横向溢出。 |

## Flux 专项证据

- 创建 Demand 时接受 `bits.bytedance.net/flux/...` 链接，并规范化为 `flux.bytedance.net`；未知 query 与 fragment 被丢弃。
- 工具箱展示规范化 URL 和 Delivery ID；换绑、两次确认解绑、空态重绑均成功。
- 缺少 `flux-collab` 时显示“需要安装 Skill”，六条指令全部禁用；安装入口使用官方 AgentBuddy source。
- Skill 就绪后显示“Skill 已就绪”，六条指令标记“附带官方 Skill”。
- “理解当前协作”的时间线显示 `$flux-collab`，fixture 只有在收到唯一、精确的 `/skills/flux-collab/SKILL.md` 结构化输入时才返回 `FLUX_SKILL_ATTACHED`。
- 指令上下文包含 Demand、Delivery、Space、规范化 URL 和 Worktree；提示不复制 CLI 语法，并明确本地 Codex 负责代码、Flux 负责协作流程。
- 未对真实 Flux 发送消息、写 Artifact、上报事件、触发 Worker、推送分支或创建 MR。

## 发现并修复的问题

1. Skill 安装使用 `approval: none` 时被 Runtime 推导为 YOLO，违背安装器只在 workspace-write sandbox 内运行的边界。现改为显式 `workspace-write + never approval`。
2. `sendTurn()` 只返回 completion、丢弃 start Promise；原生 Turn 启动失败会产生未处理 rejection 并终止 Node 进程。现同时观察两个 Promise，并增加“启动被拒绝后 Runtime 继续健康”的集成回归。
3. 手工安装来源现在只在安装任务成功创建后清空；请求失败不再丢失用户输入。

## 自动化校验

- `pnpm verify`：PASS。
- Server：34 files / 250 tests PASS。
- Web：27 files / 127 tests PASS。
- TypeScript、Core `0.43.1` 校验、前后端 production build：PASS。
- `git diff --check`：PASS。
- 构建仅有既有 SQLite experimental 与 bundle chunk-size warning。

## 清理

端口 `43921` 的测试服务已停止。`/tmp/codywork-flux-refactor-e2e.e4gBln` 仅包含本轮合成数据库、Runtime 状态、三个一次性 Git 仓库和 Demand Worktree；最终已移入用户废纸篓，可恢复。未修改真实用户 Workspace 或 Flux 数据。
