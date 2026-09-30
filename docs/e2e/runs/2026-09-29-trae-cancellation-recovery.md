# CodyWork E2E 回归记录：Trae ACP 停止恢复

- 日期：2026-09-29
- 执行者：NiceTrae
- 代码 revision：本地 `feature/codywork_trae_runtime` worktree，未提交、未推送
- Core 版本：本地 0.44.0 worktree（ACP cancellation transport 修复）
- 环境与 URL：本地生产构建，`http://127.0.0.1:3001`
- 浏览器与视口：BLOCKED（当前会话无浏览器自动化能力）
- SQLite 数据库：正式数据库仅做状态读取；自动化测试使用内存库/一次性目录
- 测试 Workspace：运行时单测用 `mkdtemp` 创建并清理

## 结论

Trae ACP 停止路径已修复并部署到 3001。ACP `session/cancel` 现在按协议以通知发送，不再等待不存在的 RPC 响应；若代理接受通知后仍不结束 Turn，CodyWork 在有界窗口后释放该会话独占的 ACP 进程，并以一次 `turn.interrupted` 收敛。没有提交或推送。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | BLOCKED | 3001 健康接口返回 HTTP 200。 | 无浏览器，不能验证页面启动与身份恢复。 |
| E2E-007 | BLOCKED | `runtime.spec.ts` 覆盖开始、停止、唯一终态事件。 | 不是浏览器即时 UI 证据。 |
| E2E-008 | BLOCKED | 正常取消和强制取消均只产生一次 `turn.interrupted`，没有 `turn.failed`。 | 无浏览器刷新验证。 |
| E2E-010 | PASS | Trae fixture 的 `LONG_RUNNING` 由 ACP notification 取消；`HANG_AFTER_CANCEL` 在有界时间内强制终止，随后可恢复同一 native Session。 | 自动化 Runtime 端到端协议回归。 |
| E2E-011 | BLOCKED | 生产服务重启后健康接口正常。 | 未执行真实多 Tab/WebSocket 页面验证。 |
| E2E-016 | BLOCKED | 生产构建完成；服务端启动日志没有新增未处理异常。 | 无浏览器 console、视口与布局验证能力。 |

## 发现并修复的问题

- 原实现把 ACP `session/cancel` 当作 request 并等待响应；但 ACP 规范将其定义为 notification，合规代理不会返回响应，导致 `/interrupt` 永远等待。
- Core 改为 notification，并提供立即释放单会话 ACP transport 的能力。
- CodyWork 在通知无法写出或等待 native Turn 结束超时后，发出一次明确中断事件、终止该会话 ACP 进程、抑制连接关闭引发的重复失败事件，并让后续操作恢复有效 native Session。

## 未解决问题与阻塞

- 当前会话没有浏览器自动化能力，所有需要从页面点击 Stop、观察“停止中”及刷新状态的用例仍为 BLOCKED。
- `pnpm verify` 的类型检查、服务端 169 项和前端 74 项测试均通过；最终构建阶段被本地 Core `file:` 依赖触发的发布版本校验阻断。该校验要求不可变 `vX.Y.Z` tag，与本轮未提交的本地 Core 联调冲突；单独的服务端、前端和 Core production build 均通过。

## 健康检查

- Core：24 个测试文件、298 项通过；Core 和 Vue 生产构建通过。
- CodyWork：类型检查通过；服务端 27 个文件、169 项通过；前端 21 个文件、74 项通过；服务端和前端生产构建通过。
- 浏览器 console error/warn：BLOCKED（无浏览器能力）。
- 服务端异常日志：本次重启后的启动日志无未处理异常。
- 刷新/重连后的最终状态：正式数据库只读确认此前卡住的 Trae 会话 `conversation_mumbpksv_z4ir1g` 已是 `completed`；3001 健康接口返回 `ok`。

## 清理

- Runtime 测试创建的临时目录由测试自行清理。
- 停止了旧的 3001 CodyWork 进程及其子 ACP 进程，并按用户授权启动新构建的 3001 服务。
- 未删除或修改真实业务仓库；未提交、未推送。
