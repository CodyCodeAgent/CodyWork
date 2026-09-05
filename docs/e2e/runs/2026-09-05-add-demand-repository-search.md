# CodyWork E2E 回归记录：向需求添加 Repo 搜索

- 日期：2026-09-05
- 执行者：Codex
- 代码 revision：`e7fbe3f08bfbea05d5f842e808bb4579ed1f6910` + 本轮未提交工作区改动
- Core 版本：`0.38.7`
- 环境与 URL：本机 production build，`http://127.0.0.1:3215`
- 浏览器与视口：agent-browser Chromium，1440×900、820×900；两个独立浏览器会话
- SQLite 数据库：临时 `/tmp/codywork-repo-search-e2e.WL3mMy/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-repo-search-e2e.WL3mMy/workspace`

## 结论

PASS。“添加 Repo 到需求”弹窗现在可以按项目名、完整路径和默认分支即时搜索，并提供匹配数量、清空操作和无结果提示。隐藏当前单选项时会清除选择，关闭后重新打开不残留查询。实际添加 Repo、创建 Worktree、刷新和服务重连后的状态均正确。本轮未提交、未合并、未部署。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从根地址登记一次性 Workspace；刷新和第二浏览器会话均恢复相同 Workspace，最终显示 `Browser WebSocket connected`。 | 回环环境不要求密码。 |
| E2E-003 | PASS | 初始 Demand 使用 `fe_ls_market_admin`；工具箱中按 `release/2026`、项目名和 `services/investment_application` 路径过滤均只显示目标 Repo；添加 `life.marketing.benefit` 后创建了对应 Worktree。 | 两个 Worktree 都位于 Demand 的 `services/`，分支均为 `codex/repo-add-search-e2e`，基线未修改。 |
| E2E-004 | PASS | 创建两个会话；带 workspace、demand、conversation 的专属 URL 刷新可恢复，浏览器后退/前进可回到 Skills 与设置页面。 | 历史消息和当前会话未丢失。 |
| E2E-007 | PASS | `PAUSE_E2E OPTIMISTIC_REPO_SEARCH` 在 assistant 输出前立即显示且只有一条；正常 Turn 完成及刷新后用户消息仍各一条。 | optimistic 与正式消息未重复。 |
| E2E-008 | PASS | 连续完成四轮，其中一轮经过 command approval；刷新及服务重连后，4 条用户消息各 1 份、3 条 `CODEX_FIXTURE_OK`、1 条 `APPROVED`、4 条 Worked。 | 无错序、重复终态或旧回复回流。 |
| E2E-011 | PASS | 两个独立浏览器会话同时连接；服务停止时都进入 reconnecting，恢复后都自动回到 connected。 | 未互踢，未出现连接横幅闪烁或消息重复。 |
| E2E-016 | PASS | 检查概览、Demand、知识库、Skills、设置和添加 Repo 弹窗；1440×900 与 820×900 均无水平溢出。 | 两个浏览器会话无 console error/warn，无错误 overlay。 |

## 发现并修复的问题

- 原“添加 Repo 到需求”弹窗只能滚动查找。现复用统一的 Repo 过滤函数，搜索项目名、路径和默认分支，不新增后端接口或缓存。
- 为避免筛选后误提交不可见的单选 Repo，当查询隐藏当前选择时自动清除；关闭弹窗时清空查询。
- 补充组件测试和 E2E 自然语言契约，覆盖过滤、清空、无结果、隐藏选择和重新打开。

## 未解决问题与阻塞

无。

## 健康检查

- `pnpm verify`：PASS（服务端 127 项、前端 51 项，类型检查和生产构建通过）。
- 浏览器 console error/warn：两个会话均无。
- 服务端异常日志：无未处理异常；仅 Node SQLite experimental warning。
- 刷新/重连后的最终状态：两个浏览器会话均恢复 `Browser WebSocket connected`；消息数量和 Repo 归属保持稳定。

## 清理

- 已关闭 `codywork-repo-search-e2e` 与 `codywork-repo-search-e2e-tab2` 浏览器会话。
- 已停止 3215 端口的隔离 CodyWork 服务。
- 已将 `/tmp/codywork-repo-search-e2e.WL3mMy` 移入系统废纸篓，其中包含一次性 Workspace、Worktree、Git 仓库、SQLite、Runtime 状态和截图，可恢复。
- 未修改或清理任何真实用户 Workspace、仓库或数据库。
