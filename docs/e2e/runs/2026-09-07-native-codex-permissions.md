# CodyWork E2E 回归记录：Codex 原生权限接管

- 日期：2026-09-07
- 执行者：Codex
- 代码 revision：`c386f67f4bdf` + 本轮未提交工作区改动
- Core 版本：`0.38.8`
- Runtime：ChatGPT bundled `codex-cli 0.153.4`
- 环境与 URL：本机 production build，`http://127.0.0.1:43219`
- 浏览器：Codex In-app Browser，两个独立标签页
- SQLite 数据库：临时 `/tmp/codywork-native-policy-e2e.bkfDnj/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-native-policy-e2e.bkfDnj/workspace`

## 结论

本轮权限改造通过。CodyWork 不再维护独立目录白名单、Git 元数据例外或自定义 permission profile，而是把实际执行目录和用户选择的权限模式直接交给 Codex Runtime：只读对应 `readOnly`，Normal 对应 `workspaceWrite`，YOLO 对应 `dangerFullAccess`。隔离环境中已真实验证三种模式的关键写入行为、终态收敛、刷新恢复和多标签页恢复。

实际可访问范围仍受 CodyWork 服务进程所属操作系统用户、系统权限和 Codex Runtime 自身策略约束；CodyWork 不再叠加第二层文件边界。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从隔离数据库通过 UI 使用 `Native Policy E2E` Workspace，页面启动、Realtime 连接和 Workspace 恢复正常。 | 回环环境不启用密码。 |
| E2E-004 | PASS | Demand、Conversation 精确 URL 刷新后恢复同一 Worktree 和历史；第二标签页也恢复同一会话。 | 未创建重复会话。 |
| E2E-007 | PASS | 三种权限提示均通过真实输入框提交；用户消息立即出现，执行状态和正式消息正常收敛。 | 使用真实 Codex Runtime。 |
| E2E-008 | PASS | YOLO、只读和 Normal 均进入明确终态；刷新及第二标签页没有重复消息，顺序一致。 | Normal 最终回复为 `NORMAL_NEWER_CLI_E2E_OK`。 |
| E2E-011 | PASS | 两个标签页同时显示 `Realtime connected`，第二标签页恢复相同历史、终态和 Conversation URL。 | 两个标签页 console error/warn 均为 0。 |
| E2E-016 | PASS | 页面无水平溢出，权限选项和提示可读；浏览器 console error/warn 为 0，服务进程无未处理异常。 | 使用默认桌面视口。 |
| E2E-019 | PASS | YOLO 写入 Worktree 内文件和 Workspace 外唯一临时文件；只读写入被 Codex 拒绝且目标文件不存在；Normal 由原生 `workspaceWrite` 成功写入并正常完成。Runtime fixture 测试同时断言三种原生 sandbox policy，且不再携带 CodyWork 自定义 profile。 | 网络和 Git 推送路径未改动，由自动化回归覆盖既有协议；本轮人工浏览器重点验证受影响的文件权限边界。 |

## 真实权限证据

- YOLO / `dangerFullAccess`：
  - `docs/native-policy-inside.txt` 内容为 `INSIDE_YOLO_OK`。
  - Workspace 外 `/tmp/codywork-native-policy-e2e.bkfDnj/outside-yolo.txt` 内容为 `OUTSIDE_YOLO_OK`。
  - Agent 最终回复 `YOLO_E2E_OK`。
- 只读 / `readOnly`：
  - 尝试创建 `docs/read-only-must-not-exist.txt`，Codex 返回权限阻止。
  - 文件系统复核目标文件不存在。
  - Agent 最终回复 `READ_ONLY_BLOCKED`。
- Normal / `workspaceWrite`：
  - `docs/normal-newer-cli.txt` 内容为 `NORMAL_NEWER_CLI_OK`。
  - 文件变更卡从 `inProgress` 收敛为 `completed`。
  - Agent 最终回复 `NORMAL_NEWER_CLI_E2E_OK`，会话状态为“已完成”。

## 自动化与健康检查

- Runtime、Conversation context 和权限策略定向测试：PASS（28 项）。
- 服务端与前端类型检查：PASS。
- 完整 `pnpm verify`：PASS（服务端 133 项、前端 59 项，类型检查、Core 版本校验和 production build 全部通过）。
- `git diff --check`：PASS。
- 浏览器 console error/warn：两个标签页均为 0。
- 服务端异常日志：无未处理异常。

## 兼容性说明

首次真实验证使用本机旧版 `codex-cli 0.149.0` 时，默认 `gpt-6-astra` 被 Runtime 明确拒绝，且两个 Normal 回合在文件落盘后未及时收敛。改用 ChatGPT bundled `codex-cli 0.153.4` 和 `gpt-5.6-sol` 后，同一 Normal 场景在 42 秒内完整收敛。该问题属于本机旧 Runtime 版本兼容性，不是本轮权限映射失败。

## 清理

- 已关闭两个隔离测试标签页并停止 43219 端口的 CodyWork 进程。
- 一次性 Workspace、Worktree、SQLite 和测试 Git 仓库已整体移入系统废纸篓 `/Users/bytedance/.Trash/codywork-native-policy-e2e.bkfDnj`，可恢复。
- 未读取或修改正式凭证、正式数据库、真实用户 Workspace 或业务仓库。
