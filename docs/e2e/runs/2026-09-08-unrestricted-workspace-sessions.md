# CodyWork E2E 回归记录：Workspace 会话解除产品级限制

- 日期：2026-09-08
- 执行者：Codex
- 代码 revision：`644ec31664e8` + 本轮未提交工作区改动
- 分支：`codex/unrestricted-workspace-sessions`
- Core 版本：`0.38.8`
- Runtime：确定性 Codex Runtime fixture
- 环境与 URL：本机隔离服务，`http://127.0.0.1:43231`
- 浏览器：Codex In-app Browser，Workspace 与 Demand 两个标签页
- SQLite 数据库：临时 `/tmp/codywork-unrestricted-e2e.owZ35H/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-unrestricted-e2e.owZ35H/workspace`

## 结论

Workspace 一级会话不再被 CodyWork 固定为“只读搜索”。新会话默认 YOLO，同时保留只读、Normal、YOLO 三种 Codex 原生权限模式；切换结果可持久化并在刷新、直接 URL 和服务重启后恢复。初始上下文会注入 Workspace 根 `AGENTS.md`，并要求 Agent 在进入具体 Repo 或子目录前沿目录链读取更深层 `AGENTS.md`，不一次性加载所有 Service 规则。

本轮使用确定性 Runtime 完成浏览器链路和原生 permission 字段回归，没有再次执行真实文件写入、网络或 Git 推送；这些系统权限边界已在前一轮 `2026-09-07-native-codex-permissions.md` 使用真实 Codex Runtime 验证。本轮涉及真实飞书消息的 E2E-020 未执行，因为当前轮没有新的外部消息发送授权。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从全新隔离数据库通过 UI 注册 Workspace，自动进入“Workspace 会话”，Realtime 连接和 Workspace 恢复正常。 | 回环环境不启用密码。 |
| E2E-004 | PASS | 创建 Demand 和会话后，通过精确 URL 在第二标签页打开；服务重启后恢复同一 Worktree、Conversation 和已完成历史。 | 未创建重复会话。 |
| E2E-007 | PASS | Workspace 与 Demand 消息提交后立即出现 optimistic 用户气泡，随后各自收敛为一条正式回复和 Worked 终态。 | 暂停夹具无法确认 interrupt，不将该夹具限制记为产品故障。 |
| E2E-008 | PASS | 完成后刷新和服务重启，消息顺序稳定，无重复用户消息或 assistant 回复。 | Workspace 权限选择同时恢复。 |
| E2E-011 | PASS | 两个标签页在停服时进入重连，服务恢复后重新连接，并恢复各自 URL 和历史。 | 两个标签页 console error/warn 均为 0。 |
| E2E-016 | PASS | 822px 窄视口下 `scrollWidth === innerWidth`，无水平溢出；健康接口正常，浏览器控制台和服务端无未处理异常。 | 权限说明和控件可读。 |
| E2E-019 | PARTIAL | UI 实际切换并持久化只读、Normal、YOLO；fixture 分别收到 `readOnly`、`workspaceWrite`、`dangerFullAccess`，自动化测试确认不再携带 CodyWork 自定义目录白名单。 | 本轮未重复真实文件写入、网络和 Git 推送；真实原生边界沿用 2026-09-07 已通过记录。 |
| E2E-020 | BLOCKED | 新增集成测试验证 Workspace 绑定卡提供 YOLO/Normal、默认 YOLO，并创建 Workspace/Yolo/Feishu 会话；Workspace 附件落点也有自动化覆盖。 | 当前轮没有新的真实飞书消息授权，因此未向外部群或用户发送消息。 |
| E2E-021 | PARTIAL | 首个 Workspace 会话自动创建且默认 YOLO；第二会话可新建、切换三种权限、发送消息、刷新及重启恢复；Runtime 启动指令包含根 AGENTS 注入和目录链动态读取规则。 | 确定性 fixture 不执行真实文件、CLI、Skill 或 Git 操作；相关原生权限已有前轮真实 Runtime 证据。 |

## 自动化与健康检查

- `pnpm verify`：PASS。
- 服务端测试：PASS（22 个测试文件，135 项）。
- 前端测试：PASS（16 个测试文件，59 项）。
- 类型检查、Core 版本校验、前后端 production build：PASS。
- Workspace 旧数据库迁移测试：PASS；旧的只读 Workspace conversation、group profile 和 channel binding 会升级为 YOLO，同时保留原生 Thread。
- 飞书 Workspace 绑定集成测试：PASS；默认 YOLO，Normal 可选，scope/permission/conversation 持久化一致。
- `git diff --check`：PASS。
- `GET /api/health`：PASS。
- 浏览器 console error/warn：两个标签页均为 0。

## 清理

- 已关闭两个隔离测试标签页并停止 43231 端口的测试服务。
- 一次性 Workspace、Worktree、SQLite、fixture state 和测试 Git 仓库已整体移入系统废纸篓 `/Users/bytedance/.Trash/codywork-unrestricted-e2e.owZ35H`，可恢复。
- 未读取或修改正式凭证、正式数据库、真实用户 Workspace 或业务仓库。
