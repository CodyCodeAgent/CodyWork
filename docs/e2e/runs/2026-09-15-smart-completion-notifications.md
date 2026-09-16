# 智能完工通知 E2E 回归记录

- 日期：2026-09-15
- 变更：Workspace 级智能完工通知配置、复杂长任务识别、飞书持久化 Outbox 投递
- 环境：本地 production build，隔离 SQLite、Workspace、Git Repo 和 Worktree
- 地址：`http://127.0.0.1:43291`

## 自动化验证

- `pnpm verify`：通过
- Server：25 个测试文件、149 个测试通过
- Web：18 个测试文件、65 个测试通过
- Core：0.38.8 验证通过
- TypeScript 与 production build：通过
- 智能通知专项：等待时间扣除、普通聊天不通知、复杂任务通知、失败通知、Turn 幂等与设置校验均通过

## 浏览器回归

| 场景 | 结果 | 说明 |
| --- | --- | --- |
| 智能通知设置入口与默认状态 | PASS | 设置总览可进入；默认关闭、30 分钟、Demand 与 Workspace 范围均启用 |
| 设置保存与刷新恢复 | PASS | 调整为 45 分钟并关闭 Workspace 范围，保存成功；刷新后状态保持 |
| 隔离 Workspace / Repo / Demand 创建 | PASS | 使用临时目录和临时 Git 仓库创建 Demand Worktree |
| Demand 会话消息主链路 | PASS | 用户消息即时出现，Fixture Codex 返回终态，状态切换为已完成 |
| 刷新与直达链接恢复 | PASS | 刷新后用户/AI 历史均保留；第二标签通过完整 URL 直达同一会话 |
| 多标签实时同步 | PASS | 第二标签发送消息后，第一标签实时收到用户消息与 AI 终态 |
| 服务重启恢复 | PASS | 重启 production server 后两个标签自动恢复实时连接，历史消息保留 |
| 桌面横向布局 | PASS | 1280px 视口下 body/document scrollWidth 均等于 innerWidth，无横向溢出 |
| 服务端异常日志 | PASS | 回归期间没有新增 server error |
| 真实飞书私聊投递 | NOT RUN | 本轮未发送外部消息；卡片格式、路由、Outbox 与幂等由自动化测试覆盖 |

## E2E-024 结论

配置、智能判断、持久化 Outbox 和幂等链路通过自动化与浏览器回归。真实飞书账号的创建/发送/离线恢复仍需在获得本轮明确外部发送授权后执行一次生产前验证。

## 清理

测试浏览器标签、临时服务、临时数据库、Workspace、Repo 与 Worktree 均在回归结束后关闭或移入废纸篓，不触碰用户现有工作区。
