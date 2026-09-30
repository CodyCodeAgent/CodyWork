# Runtime Registry 与选择入口验收记录

- 日期：2026-09-29
- 代码：`feature/codywork_trae_runtime`（本地未提交）
- Core：`feature/core_runtime_registry`，本地 worktree 版本 `0.41.0`
- 环境：CodyWork 本地生产构建；未触碰 3001 的真实数据库或进行中会话。

## 自动化验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Core Runtime Registry | PASS | Core typecheck、build 和 287 个测试通过；覆盖注册、默认 Runtime、未知 ID 与重复 ID。 |
| CodyWork TypeScript | PASS | Server `tsc --noEmit` 和 Web `vue-tsc --noEmit` 通过。 |
| CodyWork Server tests | PASS | 27 个测试文件、182 个测试通过；覆盖 Runtime 创建/绑定/切换、Trae Session 回放、动态飞书 `/runtime`。 |
| CodyWork Web tests | PASS | 22 个测试文件、79 个测试通过；覆盖 Runtime 描述符、下拉选择、会话菜单和界面状态。 |
| Production build | PASS | 本地 Core 版本校验、Vite build、Server build 均通过。 |

本地 Core worktree 仅用于此轮未发布联调；版本校验仍要求发布环境使用不可变 `vX.Y.Z` tag，只有显式设置 `CODYWORK_LOCAL_CORE_DEV=1` 时才接受 `file:` 路径。

## 浏览器 E2E

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| E2E-001 | BLOCKED | 当前会话没有真实浏览器自动化工具，且系统没有 Chromium/Chrome 或 Playwright/Puppeteer 可用；未将构建或 API 结果冒充页面通过。 |
| E2E-004 | BLOCKED | 同上，无法实际打开、刷新并观察 Demand 专属 URL。 |
| E2E-007 | BLOCKED | 同上，无法通过 Composer 观察 Runtime 选择后的即时消息和正式收敛。 |
| E2E-008 | BLOCKED | 同上，无法在刷新后实际观察消息顺序与去重。 |
| E2E-010 | BLOCKED | 同上，无法点击页面停止入口确认 Runtime 切换后的停止行为。 |
| E2E-011 | BLOCKED | 同上，无法用两个真实浏览器 Tab 验证 WebSocket 及 Runtime 状态同步。 |
| E2E-012 | BLOCKED | 同上，无法在页面侧观察上游流断开后的恢复状态。 |
| E2E-016 | BLOCKED | 同上，无法检查实际 DOM 横向溢出、交互焦点和浏览器 console。 |

## 本轮范围

- 选择新会话 Runtime 仅在新会话创建入口保留；不再与当前会话切换混在顶部。
- 当前会话的带交接切换入口位于会话 `…` 菜单。
- 飞书 `/runtime` 保留并基于同一 Runtime Registry 枚举目标，切换后接管后续飞书消息。
- Runtime 持久化命令由固定双列迁移为按 Runtime ID 的 JSON 映射；后续新增适配器不需要再改数据库列、浏览器下拉或飞书目标列表。
