# CodyWork E2E 回归记录：Runtime 切换目标选择

- 日期：2026-09-30
- 执行者：TraeCode
- 代码 revision：本地未提交 worktree（`feature/codywork_trae_runtime`）
- Core 版本：0.42.0 本地开发依赖
- 环境与 URL：本地 CodyWork `http://127.0.0.1:3001`（验证后已部署到 3001）
- 浏览器与视口：BLOCKED；当前环境没有 Chromium、Chrome、Playwright 或可用的浏览器自动化入口
- SQLite 数据库：正式运行库只读检查；无新增测试 Workspace
- 测试 Workspace：未使用真实 Workspace 作为迁移夹具

## 结论

Runtime 切换不再假定目标是某个固定 Runtime。对话框从 Runtime Registry 派生全部候选项，排除源 Runtime 后要求用户显式选择目标；未选择前确认按钮禁用。新增第三个或更多 Runtime 时不需要再改这段 UI 逻辑。源会话仍保留，确认后创建携带受限历史交接的新目标会话。

真实浏览器验收为 `BLOCKED`：当前执行环境没有可启动的浏览器或浏览器自动化能力。自动化单元、类型、服务端测试与生产构建均已通过，但这些不能代替页面 E2E。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | BLOCKED | 无可启动浏览器 | 受影响的 P0 页面启动/恢复流程未能从页面执行 |
| E2E-004 | BLOCKED | 无可启动浏览器 | 未操作真实 Workspace 或 Demand URL |
| E2E-007 | BLOCKED | 无可启动浏览器 | 未能通过页面观察消息即时状态 |
| E2E-008 | BLOCKED | 无可启动浏览器 | 未能通过页面观察迁移后会话顺序与刷新 |
| E2E-011 | BLOCKED | 无可启动浏览器 | 未能执行浏览器实时连接、多 Tab 观察 |
| E2E-016 | BLOCKED | 无可启动浏览器 | 页面布局、控制台与响应式观察未能执行 |
| E2E-010 | BLOCKED | 无可启动浏览器 | Runtime 切换弹窗与交接操作未能从 UI 执行 |
| E2E-012 | BLOCKED | 无可启动浏览器 | Runtime 状态恢复未能通过刷新/重连验证 |

## 发现并修复的问题

- 原迁移入口通过 `find(...)` 取第一个非源 Runtime。当 Registry 有两个以上候选时，目标会被隐式固定，扩展 Runtime 后行为不确定。
- 已改为 `migrationRuntimeOptions(runtimes, sourceRuntime)`：排除源 Runtime，保留 Registry 中的所有其他候选，并在确认前由用户通过语义化 `<select>` 明确选择。
- 新增 UI 单测验证三个 Runtime 注册时，任一源 Runtime 只会被排除，其他多个 Runtime 均保留为迁移目标。

## 未解决问题与阻塞

- 浏览器 E2E 被当前环境缺少浏览器/自动化入口阻塞；没有将 API、测试或构建结果标记为页面 E2E 通过。

## 健康检查

- `CODYWORK_LOCAL_CORE_DEV=1 pnpm verify`：PASS（显式选择目标后的最终构建）。服务端 27 个测试文件 / 182 项、前端 22 个测试文件 / 80 项、类型检查及前后端生产构建均通过。
- 浏览器 console error/warn：BLOCKED，无浏览器。
- 服务端异常日志：重启后的服务日志仅包含 Node SQLite experimental warning；未观察到本轮构建或启动错误。
- 刷新/重连后的最终状态：BLOCKED，无浏览器。

## 清理

重启前已只读确认正式运行库中 `running` / `awaiting_approval` 会话数为 0；重启后仍为 0。未创建或删除临时 Workspace、Worktree、数据库、上传文件或测试进程。未修改、清理或重置真实用户仓库。
