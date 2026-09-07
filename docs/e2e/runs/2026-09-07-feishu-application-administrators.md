# CodyWork E2E 回归记录：飞书应用管理员审批路由

- 日期：2026-09-07
- 执行者：Codex
- 代码 revision：`2ff58db`
- Core 版本：`v0.38.8`（`264f74f`）
- 环境与 URL：本地生产构建 `http://127.0.0.1:43214/`；生产 `http://10.37.222.12:3001/`
- 浏览器与视口：Codex In-app Browser，桌面视口
- SQLite 数据库：临时，`/tmp/codywork-admin-e2e.hP0aVh/workspace.db`
- 测试 Workspace：`/Users/bytedance/GC/GitHub/cody-workbench`（只读采用，未改业务文件）

## 结论

审批管理员已经改为从当前飞书应用读取所有者和管理员，手工允许用户列表只负责使用白名单，不再参与管理员选择。Core `v0.38.8` 和 CodyWork `2ff58db` 已发布到生产；自动测试、类型检查、构建、本地设置页冒烟、生产页面和当前应用管理员只读查询均通过。完整未授权用户审批卡片流程缺少第二个未入白名单账号，仍标记为 `BLOCKED`。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 生产页面成功恢复 `Life CSR` Workspace，现有登录状态有效 | 服务重启后页面可访问 |
| E2E-004 | NOT RUN |  | 本轮未创建 Demand |
| E2E-007 | NOT RUN |  | 本轮未执行 Codex 会话 |
| E2E-008 | NOT RUN |  | 本轮未执行 Codex 会话 |
| E2E-011 | NOT RUN |  | 本轮未执行多 Tab |
| E2E-016 | PASS | 本地与生产设置页均可打开；生产浏览器 console 无 warning/error；内外网健康检查正常 | 页面可见新增权限说明，无布局阻断 |
| E2E-020 | BLOCKED | 单测覆盖 owner 优先、管理员去重、旧审批重路由和投递失败；生产只读调用成功解析 owner，返回 1 名管理员 | 缺少未入白名单的第二账号，未发送真实审批卡片 |

## 发现并修复的问题

- 旧逻辑把 `allowedUserIds[0]` 当作审批管理员；该 open_id 可能来自另一应用，导致飞书拒绝发送且用户收不到审批通知。
- 改为通过当前应用接口读取 owner 和 administrator；owner 优先，角色去重，异常时明确提示权限缺失，不再伪报“等待管理员”。
- 旧的 pending 请求若管理员变化或从未成功投递，会重绑当前应用管理员并重新发送；同一管理员已成功投递的请求仍保持幂等。
- Outbox 投递失败会反馈“未能送达”，并记录失败状态和审计事件。

## 未解决问题与阻塞

- 完整审批卡片 E2E 需要一个当前应用下、尚未加入允许用户列表的第二账号发起消息。
- 本轮未执行会话消息、多 Tab 等与修改无关的完整 P0 回归。

## 健康检查

- `pnpm verify`：PASS；服务端 131 条测试、前端 57 条测试、类型检查和生产构建全部通过。
- Core `pnpm test && pnpm typecheck && pnpm build`：PASS；Core 222 条测试、Vue 26 条测试。
- 生产 Core 版本：运行时读取为 `0.38.8`。
- 浏览器 console error/warn：生产设置页为空。
- 服务端异常日志：本次 PID `335815` 启动后无新增异常，健康检查返回 HTTP 200。
- 飞书管理员查询：生产凭证只读调用成功，`ownerResolved=true`、`administratorCount=1`；未输出凭证或完整 Open ID。
- 刷新/重连后的最终状态：飞书机器人显示“已连接”。

## 清理

- 停止本地 43214 测试服务。
- 将临时 SQLite 目录 `/tmp/codywork-admin-e2e.hP0aVh` 移入本机废纸篓，可恢复。
- 生产验证只读取应用管理员和现有配置；未修改真实 Workspace、飞书配置或生产数据，也未发送外部测试消息。
