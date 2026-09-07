# CodyWork E2E 回归记录：飞书应用管理员审批路由

- 日期：2026-09-07
- 执行者：Codex
- 代码 revision：`d8b16b1` 加本轮未提交改动
- Core 版本：`v0.38.8`（`264f74f`）
- 环境与 URL：本地生产构建，`http://127.0.0.1:43214/`
- 浏览器与视口：Codex In-app Browser，桌面视口
- SQLite 数据库：临时，`/tmp/codywork-admin-e2e.hP0aVh/workspace.db`
- 测试 Workspace：`/Users/bytedance/GC/GitHub/cody-workbench`（只读采用，未改业务文件）

## 结论

审批管理员已经改为从当前飞书应用读取所有者和管理员，手工允许用户列表只负责使用白名单，不再参与管理员选择。自动测试、类型检查、构建和本地设置页冒烟通过；Core `v0.38.8` 已发布，真实飞书审批消息仍需部署 CodyWork 后验证，因此当前外部通道 E2E 为 `BLOCKED`。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | NOT RUN | 本轮只验证受影响设置页和服务逻辑 | 完整 P0 页面流程待协调发布后执行 |
| E2E-004 | NOT RUN |  | 本轮未创建 Demand |
| E2E-007 | NOT RUN |  | 本轮未执行 Codex 会话 |
| E2E-008 | NOT RUN |  | 本轮未执行 Codex 会话 |
| E2E-011 | NOT RUN |  | 本轮未执行多 Tab |
| E2E-016 | PASS | 本地生产构建启动；设置页可打开，飞书设置页完整渲染 | 页面可见新增权限说明，无布局阻断 |
| E2E-020 | BLOCKED | 单测覆盖当前应用 owner 优先、管理员去重、旧审批重路由和投递失败提示 | Core `0.38.8` 尚未发布，未向真实飞书发送消息 |

## 发现并修复的问题

- 旧逻辑把 `allowedUserIds[0]` 当作审批管理员；该 open_id 可能来自另一应用，导致飞书拒绝发送且用户收不到审批通知。
- 改为通过当前应用接口读取 owner 和 administrator；owner 优先，角色去重，异常时明确提示权限缺失，不再伪报“等待管理员”。
- 旧的 pending 请求若管理员变化或从未成功投递，会重绑当前应用管理员并重新发送；同一管理员已成功投递的请求仍保持幂等。
- Outbox 投递失败会反馈“未能送达”，并记录失败状态和审计事件。

## 未解决问题与阻塞

- CodyWork 尚未部署，真实飞书 owner 审批卡片 E2E 待生产发布后执行。
- 本轮没有执行完整 P0 回归，也没有修改生产服务。

## 健康检查

- `pnpm verify`：PASS；服务端 131 条测试、前端 57 条测试、类型检查和生产构建全部通过。
- Core `pnpm test && pnpm typecheck && pnpm build`：PASS；Core 222 条测试、Vue 26 条测试。
- 浏览器 console error/warn：未单独采集；页面可访问并完整渲染。
- 服务端异常日志：本地冒烟期间无可见异常。
- 刷新/重连后的最终状态：未执行会话连接场景。

## 清理

- 停止本地 43214 测试服务。
- 将临时 SQLite 目录 `/tmp/codywork-admin-e2e.hP0aVh` 移入本机废纸篓，可恢复。
- 未修改或清理真实用户 Workspace、飞书配置或生产数据。
