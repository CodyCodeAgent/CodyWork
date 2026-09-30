# Trae 运行中追加消息验收记录

- 日期：2026-09-29
- 代码：`feature/codywork_trae_runtime`（本地未提交）
- Core：`feature/core_runtime_registry`（本地未提交的联调 worktree）
- 环境：CodyWork 本地生产构建，`0.0.0.0:3001`；使用既有正式 SQLite 数据库进行只读核验。

## 结论

Core 与 CodyWork 已完成并通过自动化验证。Trae 运行中可选择明确的“追加到当前任务”模式：请求会立即送入 ACP；若 ACP 拒绝并发 prompt，消息会以相同命令 ID 明确回退到发送队列，而不是被伪装成已送达。

真实 Trae 会话已于 15:37:39 自然完成后，3001 已安全切换至本次构建。健康检查、原 Workspace 和原会话恢复、以及 Trae Composer 能力查询均通过。当前环境无可用浏览器自动化能力，因此页面 E2E 仍为 `BLOCKED`。

## 自动化验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| CodyCore typecheck / build | PASS | `pnpm --filter @codycodeagent/cody-web-core typecheck`、build 通过。 |
| CodyCore unit tests | PASS | Composer、conversation 与 Vue component 相关测试通过，覆盖 `append`、`command.appended` 与 `command.requeued`。 |
| CodyWork typecheck | PASS | `pnpm run typecheck` 通过。 |
| CodyWork Server tests | PASS | 27 个测试文件、182 个测试通过；Trae ACP fixture 覆盖追加成功与 ACP 拒绝后回退队列。 |
| CodyWork Web tests | PASS | 22 个测试文件、79 个测试通过；覆盖 Runtime capability、默认提交策略与 UI 状态。 |
| Production build | PASS | `CODYWORK_LOCAL_CORE_DEV=1 pnpm run build` 通过，且 `git diff --check` 无格式错误。 |

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-007 | BLOCKED | 无 Chrome/Chromium、Playwright、Puppeteer 或 Browser MCP。 | API 核验确认 Trae 声明 `append: true`；仍无法在 Composer 中观察即时“追加”与回退队列提示。 |
| E2E-008 | BLOCKED | 同上。 | 无法刷新页面验证 delivered / queued 视觉收敛。 |
| E2E-010 | BLOCKED | 同上。 | 无法经页面验证运行中 Runtime 的异常恢复。 |
| E2E-011 | BLOCKED | 同上。 | 无法用双 Tab 验证 WebSocket 状态同步。 |
| E2E-012 | BLOCKED | 同上。 | 无法通过浏览器观察 ACP 拒绝后的实时恢复呈现。 |
| E2E-016 | BLOCKED | 同上。 | 无法实际检查 DOM、焦点、溢出及浏览器 console。 |

## 发现并修复的问题

- 现象：Trae 会话运行中，后续用户消息只能显示“排队”，容易被误判为进程无响应。
- 根因：原 Runtime 协议只有 `queue` / `steer`；Trae ACP 不声明 steer，但协议层允许在 active session 上额外发送 `session/prompt`。
- 修复：新增与 steer 语义分离的 `append`。Trae Runtime 立即尝试 supplemental prompt，发出 `command.appended`；失败时发出 `command.requeued`，Core 将本地消息显示为“已加入发送队列”并保留原因。
- 边界：append 不携带模型、推理强度、协作模式、Skill 或图片配置，避免修改运行中 ACP 配置或图片链路造成语义不确定。飞书入站暂保留 queue，因为一个 Turn 仅对应一张卡片的投影模型尚不能正确表达多条 append 消息。

## 未解决问题与阻塞

- `BLOCKED`：当前执行环境无真实浏览器；自动化构建/API 测试未作为页面 E2E 的替代证据。
- `BLOCKED`：页面侧验收仍需真实浏览器或用户手验，尤其是 Trae ACP 实际接收并发 prompt 与拒绝回退提示。

## 健康检查

- `pnpm verify`：本轮已完成 typecheck、Server/Web tests 和 build；生产构建已启动。
- 浏览器 console error/warn：BLOCKED（无浏览器）。
- 服务端异常日志：当前服务 PID `406531` 的启动后日志未见错误；`/api/health` 返回 `ok`。
- 刷新/重连后的最终状态：原 Workspace `AiHub`、原 Trae 会话及其 `completed` 状态均通过认证 API 恢复；页面侧仍需浏览器验收。

## 清理

- 没有创建或清理真实 Workspace、Worktree、数据库记录或进行中会话。
- 只写入本地 E2E 验收记录；没有提交、推送或改动业务代码。
