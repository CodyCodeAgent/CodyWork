# Runtime 控制、Trae 统计与本地文件链接验收记录

- 日期：2026-09-29
- 代码：`feature/codywork_trae_runtime`（本地未提交）
- Core：`feature/core_runtime_registry`，本地 worktree 版本 `0.42.0`
- 生产服务：`http://127.0.0.1:3001`，切换前确认 SQLite 中没有 `running` 或 `awaiting_approval` 会话。
- 数据库：正式数据库仅只读检查会话状态；未创建、修改或清理真实 Workspace 数据。

## 结论

自动化测试、类型检查和生产构建均通过。3001 已切换到本轮构建，健康接口正常。浏览器 E2E 因当前环境没有可用浏览器执行器而 `BLOCKED`，没有以接口或构建结果代替页面验收。

## 自动化与接口验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Core 本地文件链接 | PASS | `packages/vue/src/markdown.test.ts` 覆盖绝对/相对 Markdown 文件链接、行号和 HTTPS 锚点保留；28 个 Core Vue 测试通过。 |
| CodyWork Server | PASS | 27 个测试文件、182 个测试通过；Trae 回执事件数与 Worktree 非归因变更统计均有覆盖。 |
| CodyWork Web | PASS | 22 个测试文件、79 个测试通过；AI 代码上报组件覆盖 Trae 事件数、无 patch 行归因和 Worktree 指标。 |
| 类型检查 | PASS | Server `tsc --noEmit` 与 Web `vue-tsc --noEmit` 通过。 |
| 生产构建 | PASS | `CODYWORK_LOCAL_CORE_DEV=1 pnpm run build` 完成 Core 版本校验、Vite build 和 Server build。 |
| 3001 健康 | PASS | 重启后 `GET /api/health` 返回 `ok: true`。 |
| 两份问题文档预览接口 | PASS | 已通过本地认证会话验证 `report.md` 与 `code-change-review.md` 均返回 HTTP 200，内容长度分别为 1999 / 4460，且 diff 可用。 |

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | BLOCKED | 未检测到 Chromium、Chrome、Firefox、Playwright 或 Puppeteer，也没有 Browser MCP。 | 无法实际登录并观察页面恢复。 |
| E2E-004 | BLOCKED | 同上。 | 无法实际刷新 Demand 专属 URL。 |
| E2E-007 | BLOCKED | 同上。 | 无法从页面观察新建会话和即时消息收敛。 |
| E2E-008 | BLOCKED | 同上。 | 无法从页面观察刷新后的消息顺序与去重。 |
| E2E-010 | BLOCKED | 同上。 | 无法点击验证 Runtime 切换与停止状态。 |
| E2E-011 | BLOCKED | 同上。 | 无法使用双 Tab 验证实时同步。 |
| E2E-012 | BLOCKED | 同上。 | 无法观察流恢复状态。 |
| E2E-013 | BLOCKED | 同上。 | 无法从对话中点击两份 Markdown 链接并检查弹窗。接口已单独验证。 |
| E2E-014 | BLOCKED | 同上。 | 无法检查 Markdown 文件预览的实际 DOM 和控制台。 |
| E2E-016 | BLOCKED | 同上。 | 无法检查新建会话弹窗、顶部切换 Runtime、居中输入区的真实布局与浏览器 console。 |

## 发现并修复的问题

1. 普通 Markdown 本地文件链接被当作浏览器锚点，未触发 CodyWork 文件预览。根因在 CodyCore Markdown renderer；后端路径校验和预览 API 均正常。Core 现只将显式本地文件路径转换为 `open-file` 事件，HTTP(S)、协议和章节锚点保持普通链接。
2. 新会话 Runtime 提前暴露在页面顶部，和当前会话切换语义混淆。现改为点击“＋ 新会话”后在弹窗中选择 Runtime；当前会话顶部显式提供“切换 Runtime”，保留原会话和带交接的新目标会话。
3. Trae 生产回执只有已确认代码事件数，没有可信 patch 行数据。现明确区分“AI 行级归因不可用”和“当前 Worktree 变更”；后者来自相对需求基线的 Git diff，并明确标注可能包含人工修改、不可作为 AI 归因。

## 健康检查

- 服务端日志：本次启动后只有正常监听记录，未发现本轮启动异常。
- 浏览器 console：`BLOCKED`，无浏览器执行器。
- 刷新/重连最终状态：`BLOCKED`，无浏览器执行器。
- 真实会话保护：切换前与切换后均检查到 `running` / `awaiting_approval` 会话数为 0。

## 清理

未创建临时 Workspace、Worktree、数据库或上传文件；未修改或清理用户的真实业务仓库。
