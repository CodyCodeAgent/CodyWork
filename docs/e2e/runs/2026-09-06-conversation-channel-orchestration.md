# CodyWork E2E 回归记录：统一会话命令、事件与通道投影

- 日期：2026-09-06
- 执行者：Codex
- 代码 revision：`525a068`
- Core 版本：`0.38.7`
- 环境与 URL：本机隔离生产构建 + 生产环境 `http://10.37.222.12:3001`
- 浏览器与视口：Codex in-app browser，桌面视口，通过 Computer Use 操作
- SQLite 数据库：临时，`/tmp/codywork-orchestration-e2e.kd8dnz/runtime/workspace.db`
- 测试 Workspace：`/tmp/codywork-orchestration-e2e.kd8dnz/workspace`
- 审批/问答补充环境：独立临时 `CODEX_HOME`（0 个 Hook）与 `http://127.0.0.1:43211`，避免用户全局同步 Hook 影响产品审批链路
- 重构后最终浏览器复核：当前 production build、临时 SQLite/Workspace、独立 `CODEX_HOME`，`http://127.0.0.1:43212`

## 结论

统一命令入口、Canonical EventHub、通道投影和 Outbox 投递层通过自动化测试、本机浏览器回归及生产飞书真实外部链路回归。浏览器与通道不再分别维护第二套会话状态；单 Turn 的执行权限按命令隔离，不会修改会话默认权限。生产部署后，浏览器、飞书私聊、群回复、群话题、审批/问答桥接与重启恢复均正常。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 正确密码登录；新开同源浏览器 Tab 直接恢复同一 Workspace、Demand、Conversation 和登录状态 | 本轮未重复错误密码场景；该场景由既有 E2E 覆盖 |
| E2E-002 | PASS | UI 登记隔离 Workspace 后自动发现 `services/repo-clean`，扫描结果为 clean，与文件系统一致 | 缺少 `docs/` 时显示明确结构校验错误，补齐后成功 |
| E2E-003 | PASS | 创建 Demand 时 Repo 搜索控件正常显示，选中 `repo-clean` 后成功创建隔离 Worktree | 单 Repo 场景 |
| E2E-004 | PASS | Demand 专属 URL 直接打开和刷新后恢复同一 Demand、Conversation 与历史 | URL 含 Workspace、Demand、Conversation |
| E2E-007 | PASS | 两轮连续要求回复相同的 `SAME_TURN_TEXT`，页面保留两个独立 user/assistant 对；第二 Tab 实时收到第一 Tab 的新消息和终态 | 同 Turn overlay 收敛且不跨 Turn 误去重 |
| E2E-008 | PASS | 实际执行 `sh services/repo-clean/check.sh` 并返回 `ORCHESTRATION_TOOL_OK_20260906`；完成的命令卡自动收起；每个成功回合只有一个 Worked | Normal 模式命令由用户全局 permission hook 阻塞；YOLO 命令链路完整通过 |
| E2E-010 | PASS | 在两个无 delta 的真实 Turn 上点击“停止当前回复”，会话均从执行中收敛为就绪，停止按钮消失 | 原生历史记录为 `turn.interrupted`；没有重复 `Stopped` 块 |
| E2E-011 | PASS | 两个浏览器 Tab 同时连接；Tab A 发消息后 Tab B 在 700ms 内收到 optimistic 消息，随后收到终态；服务停止时两个 Tab 均显示 `Realtime connecting…`，重启后自动恢复历史 | 无互踢；两个 Tab 的交叉回复文本计数均为 user+assistant 各一份 |
| E2E-012 | PASS | 服务进程主动 SIGINT 后页面进入 Browser WebSocket reconnecting；同一 SQLite 和构建重新启动后自动连接且恢复原生 Thread 历史 | 浏览器重连未触发第二份 Turn 或自动重发 |
| E2E-013 | PASS | Normal / Worktree 写入模式真实触发 `Command approval`；“允许一次”后命令执行并返回 `NORMAL_APPROVAL_OK_20260906`，“拒绝”后命令卡变为 failed 且会话回到已完成 | 隔离 `CODEX_HOME` 的 `hooks/list` 为 0；未修改用户全局 Hook |
| E2E-014 | PASS | Plan 模式真实触发 `request_user_input`，页面展示“继续/停止”和自由输入；选择“继续”并提交后 Turn 恢复并返回 `QUESTION_CONTINUE_OK` | Default 模式按 Codex 能力不暴露该工具，Plan 模式闭环正常 |
| E2E-016 | PASS | 概览、Demand 和 Workspace 只读搜索关键页面可用；浏览器 console 无日志；服务端无未处理异常 | 本轮未单独执行 820px 窄视口矩阵 |
| E2E-019 | PASS | Demand YOLO 会话成功写入自身 `docs/write-allowed.txt`，但写基线 `services/repo-clean` 被 `operation not permitted` 拒绝；文件系统复核目标不存在且基线仓库 clean | Turn 级权限没有扩大 Demand 固定写入边界；未做完整网络矩阵 |
| E2E-020 | PASS | 使用生产机器人和 `CodyWork E2E Topic 20260905` 测试群完成真实链路：私聊返回 `PRIVATE_OK_B`；群话题返回 `TOPICOKC`；群回复模式原消息下返回 `GROUPREPLYOKG`；浏览器 Plan 问题卡同步到飞书并由飞书选择“继续”恢复 Turn；生产服务重启后私聊返回 `RESTARTOKE` | 浏览器页面保持打开时飞书卡片仍能从执行中更新为终态；群模式验证后恢复为话题任务；临时测试白名单已恢复 |
| E2E-021 | PASS | 从侧栏创建并使用 Workspace 一级只读会话；读取 Workspace 外绝对路径得到 `ORCHESTRATION_GLOBAL_READ_OK_20260906`；写 Workspace 内文件被 `operation not permitted` 拒绝，文件系统复核文件不存在 | 页面固定展示“全局可读 · 禁止写入”；未执行多会话重命名/删除全流程 |

## 发现并修复的问题

- 旧数据库从非 scoped conversations 迁移时，重建 `channel_bindings` 可能丢失已经存在的 `permission_mode` 和 `notification_policy`。迁移逻辑现会显式保留两列，并增加回归断言。
- 通道投影在 snapshot 与 live event 交界处需要同时处理 watermark 和事件 ID。ProjectionHost 现为每个会话维护有界事件 ID 集合并持续推进 watermark，避免重放旧 revision 或重复终态。
- 通道 Outbox 的 flush 后收敛阶段如果再次直接触发 flush，可能形成递归等待。DeliveryWorker 在该阶段只排队，由当前循环继续投递。
- Runtime `model/list` 已经给出每个模型的 `supportedReasoningEfforts`，但 UI 过去展示固定推理档位。真实回归中 `gpt-5.3-codex-spark + none` 返回 400；Composer 现直接消费 provider 能力，切换模型时只展示合法档位并自动回落到 provider 默认值。
- 用户全局 `~/.codex/hooks.json` 的同步 `permissionRequest` Hook 会先于 Core approval event 阻塞真实 Normal 回合。补充回归改用只复用登录身份、但不加载用户 Hook 的临时 `CODEX_HOME`；由此确认 CodyWork 自身的审批和用户问答请求桥接均可正常暂停、处理并恢复 Turn。
- 测试 Runtime 的 `command.queued` / `command.bound` 过去只把 `clientCommandId` 放在 `data`，没有像 Core owner 一样写入规范的顶层 `itemId`，因此无法真实验证 TurnLink 收敛。Fixture 已对齐 Core 事件契约，并新增三种飞书会话形态的整链路测试，确认 Inbox 从 `received` 最终收敛为 `completed`、Turn 权限保持 `yolo`、Topic 卡片只在线程内回复。
- 组合根回归进一步发现测试 Runtime 只发送 `assistant.delta`、没有 Core 的终态 `assistant.completed`，会让测试卡片出现“已完成但正文为空”的假象。Fixture 已补齐终态事件；渠道 Provider 增加窄工厂注入点，使测试能覆盖真实 AccountManager 与 Outbox Worker，而生产仍默认创建 Core `FeishuProvider`。
- 真实生产回归发现 Codex 可能合法地以空 assistant 文本结束 Turn，旧卡片会显示“已完成”但正文仍像在等待。`525a068` 为 completed/interrupted/failed/disconnected 分别提供明确终态文案；标记 `E2E_EMPTY_TERMINAL_20260906_F` 已验证空回复显示“本次回复已完成，Codex 未返回可显示的文本”。

## 生产飞书真实回归

- 未授权私聊首先收到白名单访问申请提示；为执行后续 E2E 临时加入测试用户，全部验证结束后恢复原管理员白名单。
- 私聊消息 `E2E-ORCHESTRATION-PRIVATE-20260906-A` 触发授权流程；授权后的 `E2E_PRIVATE_20260906_B` 在同一飞书卡片内从执行中更新为 `PRIVATE_OK_B`，浏览器同时只显示一份 user/assistant/Worked。
- 群话题 `E2ETOPIC20260906C` 完成首次绑定后返回 `TOPICOKC`；群级 `/setting` 可在“回复原消息”和“话题任务”间切换。
- 群回复模式消息 `E2E_GROUP_REPLY_20260906_G` 在原根消息回复中返回 `GROUPREPLYOKG`，未创建独立机器人根话题；验证完成后将群恢复为“话题任务”。
- 浏览器 Plan 模式触发 `request_user_input` 后，飞书收到同一问题卡；在飞书选择“继续”后，飞书卡标记请求已处理，浏览器 Turn 从待确认恢复为已完成。
- Demand Normal 模式命令审批真实验证“允许一次”和“拒绝”：允许命令返回 `E2E_COMMAND_APPROVAL_20260906`；拒绝命令未执行且页面明确显示用户拒绝。
- 生产服务重启前后使用同一 SQLite；浏览器 WebSocket 自动恢复，机器人长连接恢复，绑定未丢失，重启后私聊返回 `RESTARTOKE`。
- 最终数据库检查：Inbox 无 `received`/`processing`/`waiting_binding`；Outbox 无 pending，`dedupe_key` 重复数为 0；当前进程启动后未出现新的 `SQLITE_BUSY` 或未处理异常。

## 重构后最终浏览器复核

- 通过 Computer Use 从空数据库创建 Workspace、自动发现 Git Repo、搜索并选择 Repo、创建 Demand 和隔离 Worktree。
- 在 YOLO 模式调用真实 Codex，执行 `sh services/demo/check.sh` 并得到唯一终态 `FINAL_ORCHESTRATION_E2E_OK_20260906`；完成的命令卡自动收起，页面只显示一个 Worked。
- 刷新后 user/assistant 历史各保留一份；第二个浏览器 Tab 打开同一会话后，双方都只收到一份 `TAB_TWO_REALTIME_OK`。
- 主动停止 CodyWork 服务后，两个 Tab 都进入 `Realtime connecting`；使用同一 SQLite 重启后均自动恢复为 `Realtime connected`，历史各保持一份，没有自动重放 Turn。

## 未解决问题与阻塞

- 飞书访问申请卡已验证成功投递，但管理员备用账号登录已失效，因此本轮没有从管理员飞书客户端点击批准；卡片 Action 的幂等与状态迁移由自动化测试覆盖。后续可在双账号测试环境补充该人工动作。
- 生产库保留 2 条历史死信，分别来自跨应用 `open_id` 和旧图片卡缺少 image key；本轮新链路没有新增死信。
- E2E-003、E2E-016、E2E-019、E2E-021 本轮只覆盖与本次架构变更直接相关的路径，完整矩阵应在发布回归中继续执行。

## 健康检查

- `pnpm verify`：通过；Server 22 个文件 / 125 个测试，Web 15 个文件 / 56 个测试，typecheck、Core 版本校验和生产构建通过。
- 渠道定向测试：`channelStore.spec.ts`、`channelPipeline.spec.ts`、`channelBot.spec.ts` 共 30 个测试通过。
- 浏览器 console error/warn：0。
- 当前生产进程服务端异常日志：0；历史 `database is locked` 记录属于修复前旧进程，`3376334` 启动后未复现。
- 刷新/重连后的最终状态：历史顺序稳定；消息和 Worked 无重复；浏览器 WebSocket 自动恢复。实时命令卡属于运行期投影，App Server 重建后的原生历史只保留 user/assistant/terminal 事件。

## 清理

- 完成本轮验证后停止本机 `43210` 测试服务及其隔离 Codex App Server，并将 `/tmp/codywork-orchestration-e2e.kd8dnz` 移入废纸篓。
- 停止本机 `43211` 审批测试服务并关闭测试页；将 `/tmp/codywork-approval-e2e.S5a71a`（含临时数据库、Workspace 和仅指向本机认证文件的软链接）整体移入废纸篓。
- 停止本机 `43212` 最终复核服务并关闭两个测试页；将 `/tmp/codywork-final-e2e.5H3GV7` 整体移入废纸篓。
- 生产代码已部署到 `/data00/home/gouchao/code/github/CodyWork`，运行 revision 为 `525a068`；部署前数据库备份为 `.runtime/backups/workspace-pre-525a068.db`。
- 真实 E2E 未修改业务 Workspace/仓库文件；创建的测试会话和测试群消息保留为审计证据。临时加入的测试用户白名单已删除，测试群已恢复为话题模式。
