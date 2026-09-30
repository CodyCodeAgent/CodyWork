# CodyWork E2E 回归记录：Codex / Trae Runtime 迁移

- 日期：2026-09-29
- 执行者：TraeCode
- 代码 revision：本地未提交 worktree（`feature/codywork_trae_runtime`）
- Core 版本：0.43.0 本地开发依赖
- 环境与 URL：隔离 CodyWork 服务 `http://10.37.113.220:3002`
- 浏览器与视口：BLOCKED；当前环境没有 Chromium、Chrome、Playwright 或可用的浏览器自动化入口
- SQLite 数据库：既有隔离服务数据库；未创建或修改测试 Workspace
- 测试 Workspace：未使用真实 Workspace 作为迁移夹具

## 结论

后端迁移服务、前端迁移入口与 Runtime 标识均已完成构建和自动化回归。迁移语义由服务测试覆盖：保留源会话、创建新目标 Runtime 会话、发送有上限的可见历史交接、阻止执行中/待审批会话，并审计源/目标两端。

真实浏览器 E2E 仍为 `BLOCKED`，原因是环境不存在可启动的浏览器；不能把 API 或构建结果宣称为浏览器验收。隔离服务已重启，可由用户在页面上完成最后的可视化验收。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | BLOCKED | 无浏览器可启动 | 隔离服务健康检查通过 |
| E2E-004 | BLOCKED | 无浏览器可启动 | 未操作真实 Workspace/URL |
| E2E-007 | BLOCKED | 无浏览器可启动 | 服务测试覆盖目标迁移交接 Turn |
| E2E-008 | BLOCKED | 无浏览器可启动 | 服务测试覆盖历史交接与源会话保留 |
| E2E-011 | BLOCKED | 无浏览器可启动 | 未执行真实 WebSocket UI 测试 |
| E2E-016 | BLOCKED | 无浏览器可启动 | 前端构建通过；隔离服务健康检查通过 |

## 发现并修复的问题

- 无新增缺陷。迁移不覆盖原生 Codex Thread 或 Trae ACP Session，而是创建新目标会话，避免跨协议原生 ID 被错误复用。

## 未解决问题与阻塞

- 根目录 `pnpm verify` 在发布约束脚本停止：本地 Core 使用 `file:` 依赖，`verify-core-version.mjs` 要求不可变 `vX.Y.Z` 标签。类型检查、服务端 26 个测试文件 / 166 项、前端 21 个测试文件 / 74 项均已在此前通过。
- 浏览器 E2E 被当前环境缺少浏览器/自动化入口阻塞。

## 健康检查

- `pnpm verify`：上述本地 Core 发布标签保护阻塞；其之前阶段均通过。
- 浏览器 console error/warn：BLOCKED，无浏览器。
- 服务端异常日志：最新重启后未观察到新的服务启动异常。
- 刷新/重连后的最终状态：BLOCKED，无浏览器；服务端路由和前端产物均包含迁移入口。

## 清理

未创建或删除临时 Workspace、Worktree、数据库、上传文件或测试进程。未修改、清理或重置真实用户仓库。
