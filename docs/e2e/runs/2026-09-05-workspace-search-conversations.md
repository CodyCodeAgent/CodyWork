# CodyWork E2E 回归记录：Workspace 只读搜索会话

- 日期：2026-09-05
- 执行者：Codex
- CodyWork revision：`d75261f` + 当前未提交改动
- Core 版本：`v0.38.7`（`4c71aad`）
- 环境与 URL：本地隔离服务 `http://127.0.0.1:3212`，Workspace 与 Demand 专属 URL
- 浏览器：Safari，多个同站点 Tab
- SQLite 数据库：临时，位于 `/tmp/codywork-workspace-runtime-e2e.Rd6Bqm`
- 测试 Workspace：临时，位于 `/tmp/codywork-workspace-search-e2e.LVn8u6`

## 结论

Workspace 一级只读会话的创建、切换、重命名、刷新/新 Tab/服务重启恢复、代码与知识读取、命令执行、联网、`$Skill` 引用、权限锁定和消息顺序均通过隔离环境回归。Workspace 会话未依赖虚构 Demand，Demand/Worktree 开发路径仍可独立创建和恢复。

浏览器没有执行最终删除，因为删除会话属于需要操作时确认的破坏性动作；自动化测试已覆盖 Workspace 最后一个会话可删除的服务语义。真实飞书绑定也未在本轮重复执行。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 刷新、服务重启和多个 Safari Tab 后恢复同一 Workspace；实时连接保持成功 | 本轮隔离服务未启用登录页，身份验证部分不适用 |
| E2E-003 | PASS | 从一次性 Git 仓库创建 Demand 与 Worktree，路径和分支正确 | 单仓库回归，覆盖 Workspace 功能未破坏 Demand 创建链路 |
| E2E-004 | PASS | 直接打开携带 `workspace`、`demand`、`conversation` 的 URL，刷新后恢复同一 Demand 会话 | 未产生伪造 Workspace 会话或串会话 |
| E2E-007 | PASS | 用户消息在回复前立即显示；正式 user item 到达后仍只有一条，刷新稳定 | 覆盖 Workspace 会话的 optimistic 收敛 |
| E2E-008 | PASS | 首轮含读文件、命令、联网和写入失败活动项，随后连续完成 `E2E-TURN-2/3/4`；刷新后顺序一致 | 每轮只有一个 assistant 回复和一个 Worked，无旧 overlay 回流 |
| E2E-010 | PARTIAL | Demand 长任务点击停止后回到空闲，未出现重复 Stopped | 本轮未注入启动失败，不重复验证 failed outbox 重试 |
| E2E-011 | PARTIAL | 多个同站点 Tab 同时保持连接，服务重启后恢复历史 | 未人工中断单个浏览器 WebSocket |
| E2E-016 | PARTIAL | Workspace、Demand、确认弹层和 Composer 主要桌面布局正常；服务端无异常日志 | 未重复窄视口与浏览器 console 全量检查 |
| E2E-019 | PASS | Workspace 会话网络访问返回 HTTP 200；两次文件写入均被 `Operation not permitted` 拒绝；API 越权切换 `workspace-write` 返回 400 | 服务重启前后都保持只读；两个探针文件均不存在 |
| E2E-020 | NOT RUN | 本轮未使用新的飞书授权和真实消息 | 自动化测试覆盖 Workspace/Demand 绑定类型与持久化；真实通道留给专用飞书回归 |
| E2E-021 | PARTIAL | 一级会话、双会话、重命名、URL、刷新、新 Tab、服务重启、知识/代码/命令/网络/Skill、写入拒绝和权限锁定均通过 | 删除确认边界已验证；未在浏览器确认执行最终删除 |

## Workspace 只读专项证据

- 首次进入“只读搜索”自动创建 Workspace 会话；新建第二会话后可重命名为“只读回归二号”。
- Workspace URL 只包含 `workspace` 与 `conversation`，不包含 `demand`；刷新、新 Tab 和服务重启后恢复同一原生 Thread。
- 代码文件标识读取为 `readonly-catalog-20260905`；知识文档事实读取为 `ORCHID-READONLY-731`。
- `pwd` 返回测试 Workspace；访问 `https://example.com` 返回 HTTP 200。
- `$test-search-skill` 在候选中标记为 Workspace 来源，结构化引用后返回固定标识 `SKILL-READONLY-219`。
- 重启前创建 `readonly-write-probe.txt`、重启后创建 `readonly-after-restart.txt` 都被沙箱拒绝；文件系统复核两个文件均不存在。
- Composer 只显示“Workspace 只读”；直接调用权限接口升级为 `workspace-write` 也被服务拒绝。
- 多轮顺序为：用户 Prompt、对应 assistant 回复、单个 Worked；刷新后没有重复消息、重复 Worked、重复 Stopped 或跨 Turn 穿插。

## 自动化覆盖

- DB 迁移：旧 Demand 会话升级为显式 `scope=demand`，Workspace 会话允许空 `demand_id`，子表外键与审计记录保留，并执行 `foreign_key_check`。
- 服务：Workspace 会话创建、列表、恢复、删除最后一个会话、只读 Composer 配置、权限升级拒绝。
- Runtime：Workspace cwd/readable root、空 writable roots、完整查询命令与网络、Workspace knowledge catalog、按需 Skill 引导。
- 飞书存储与路由：绑定目标可为 Demand 或 Workspace，Workspace 不伪造 Demand；Workspace 附件明确拒绝，避免为了落盘突破只读边界。
- Web：Workspace 会话入口、专属 URL、作用域展示、Demand/Workspace 分支和删除文案。

## 未解决问题与阻塞

- 浏览器端最终删除需要操作时确认，因此本轮只验证了确认文案与服务级自动化测试，没有执行破坏性点击。
- Workspace 飞书绑定的真实私聊/群聊流程未在本轮重复执行；需要专用测试飞书应用授权后运行 E2E-020。
- 当前改动尚未提交、推送、打 tag 或部署。

## 健康检查

- `pnpm verify`：PASS；server 18 个测试文件 / 116 个测试，web 11 个测试文件 / 42 个测试，类型检查、Core `0.38.7` 版本校验和生产构建通过。
- `git diff --check`：PASS。
- 服务端运行期间无未处理异常或重试风暴。
- 两个写入探针均不存在，未修改真实用户 Workspace 或仓库。

## 清理

- 停止本地 3212 测试服务。
- 删除本轮精确创建的两个 `/tmp` 临时目录。
- Safari 临时 Tab 保留，不通过 GUI 执行关闭/删除操作。
- 未修改或清理任何真实用户 Workspace、仓库、Demand、会话或飞书绑定。
