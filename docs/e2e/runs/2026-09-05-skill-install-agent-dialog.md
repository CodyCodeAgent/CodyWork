# CodyWork E2E 回归记录：Skill 安装 Agent 执行窗口

- 日期：2026-09-05
- 执行者：Codex
- 代码 revision：`e7fbe3f08bfbea05d5f842e808bb4579ed1f6910` + 本轮未提交工作区改动
- Core 版本：`0.38.7`
- 环境与 URL：本机 production build，`http://127.0.0.1:3214`
- 浏览器与视口：agent-browser Chromium，1440×900、390×844；两个独立浏览器会话
- SQLite 数据库：临时 `/tmp/codywork-skill-e2e.ldkJpC/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-skill-e2e.ldkJpC/workspace`

## 结论

PASS。Skill 安装改为无固定超时的长任务，独立 Dialog 能持续展示 Runtime 事件、在收起后继续执行，并且只能通过显式“暂停执行”调用 Runtime interrupt。任务实测运行 2 分 36 秒后仍为执行中，手动暂停后稳定进入已暂停终态。允许继续提交；本轮未提交、未合并、未部署。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从根地址登记一次性 Workspace；刷新及重新打开后恢复同一 Workspace；页面最终为 `Realtime connected`。 | 回环测试环境不要求密码。 |
| E2E-004 | PASS | Demand URL 同时包含 workspace、demand、conversation；创建两个会话后，刷新、后退、前进均恢复对应会话及历史。 | 使用一次性 Git 仓库和 Worktree。 |
| E2E-007 | PASS | 持续 Turn 在 assistant 输出前已显示唯一用户气泡；正常完成 Turn 与刷新后仍只有一条正式用户消息。 | 失败 outbox 由既有自动化覆盖。 |
| E2E-008 | PASS | 连续三轮完成，其中一轮经过 command approval；刷新后 3 条用户消息各 1 份、相同 assistant 回答按 Turn 各保留 1 份、Worked 共 3 份。 | 未见重复、错序或跨 Turn 收敛。 |
| E2E-011 | PASS | 两个浏览器会话同时显示 `Browser WebSocket connected`；服务停止时显示 reconnecting，恢复后两端自动回到 connected。 | 未观察到互踢或重启风暴。 |
| E2E-016 | PASS | 检查概览、Demand、知识库、Skills、设置和执行 Dialog；1440×900 与 390×844 均可操作，按钮有文本标签。 | 两个浏览器会话 console 均无 error/warn。 |
| E2E-022 | PASS | 完成态展示 9 个事件；长任务展示 command 与输出，收起后摘要仍为执行中并可重开；运行 2 分 36 秒未超时；手动暂停后显示已暂停和“不自动回滚”提示；Esc 只收起；刷新不伪造运行状态。 | 暂停接口真实调用测试 Runtime 的 `turn/interrupt`。 |

## 发现并修复的问题

- 原实现使用 `Promise.race` 强制 120 秒失败，用户无法查看 Agent 的过程，也无法主动控制。现已删除固定超时，增加明确的任务状态机、事件记录、执行 Dialog 和手动暂停接口。
- 原 Skill 安装会单独创建并关闭一个 App Server Runtime，违反 CodyWork 单一 App Server owner 约束。现改为复用共享 Runtime，并仅释放该次短会话，不关闭 App Server。
- 首次长任务回归遇到测试 Runtime 重启后 Thread 序号重复。为隔离夹具启用持久化序号后重跑通过；真实 Codex Thread ID 不受影响。

## 未解决问题与阻塞

无。

## 健康检查

- `pnpm verify`：PASS（本轮功能代码完成后全量执行；测试夹具补充后再次执行全量验证）。
- 浏览器 console error/warn：无。
- 服务端异常日志：无未处理异常；仅 Node SQLite experimental warning。
- 刷新/重连后的最终状态：两个浏览器会话均恢复 `Realtime connected`；已暂停任务刷新后不伪造执行中状态。

## 清理

- 已关闭 `codywork-skill-e2e` 与 `codywork-skill-e2e-tab2` 浏览器会话。
- 已停止 3214 端口的隔离 CodyWork 服务。
- 已将 `/tmp/codywork-skill-e2e.ldkJpC` 移入系统废纸篓，其中包含一次性 Workspace、Worktree、Git 仓库、SQLite、Runtime 状态和截图，可恢复。
- 未修改或清理任何真实用户 Workspace、仓库或数据库。
