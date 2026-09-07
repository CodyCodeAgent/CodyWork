# CodyWork E2E 回归记录：飞书允许所有群聊

- 日期：2026-09-07
- 执行者：Codex
- 代码 revision：`533c0ae` 加本轮未提交改动
- Core 版本：`0.38.7`
- 环境与 URL：本地生产构建，`http://127.0.0.1:43214/`
- 浏览器与视口：Codex In-app Browser，桌面视口
- SQLite 数据库：临时，`/tmp/codywork-open-groups.xDexh1/workspace.db`
- 测试 Workspace：`/tmp/codywork-open-groups.xDexh1/workspace`

## 结论

“允许所有群聊”设置、持久化和服务端路由自动测试通过；P0 页面、会话和多 Tab 冒烟通过。代码尚未部署，因此真实飞书新群入站验证为 `BLOCKED`，部署前不宣称外部通道 E2E 完成。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 本地生产构建启动，创建并刷新恢复 `Open Groups E2E` Workspace | 使用隔离 SQLite 和一次性 Git 仓库 |
| E2E-004 | PASS | Demand 专属 URL 刷新后恢复同一 Demand 与 Conversation | URL 含精确 workspace、demand、conversation |
| E2E-007 | PASS | 发送后立即显示用户消息和“正在发送…” | 随后收敛到正式历史 |
| E2E-008 | PASS | 助手仅显示一次 `OPEN_GROUPS_E2E_OK`，终态为已完成 | 无重复消息 |
| E2E-011 | PASS | 第二个浏览器 Tab 打开专属 URL，恢复同一 Thread 历史并显示 Realtime connected | 两个 Tab 内容一致 |
| E2E-016 | PASS | 设置页和会话页无布局阻断；两个 Tab 控制台均无 warning/error；服务端无异常日志 | 生产构建运行 |
| E2E-020 | BLOCKED | 设置页开启“允许所有群聊”后群 ID 输入禁用，保存并刷新后保持开启 | 代码未部署，未向真实飞书发送外部测试消息 |

## 发现并修复的问题

无。

## 未解决问题与阻塞

- 真实飞书任意新群入站、用户授权卡片及话题绑定，需要部署本轮代码并开启正式机器人的“允许所有群聊”后验证。

## 健康检查

- `pnpm verify`：PASS；服务端 129 条测试、前端 57 条测试、类型检查和生产构建全部通过。
- 浏览器 console error/warn：两个测试 Tab 均为空。
- 服务端异常日志：无。
- 刷新/重连后的最终状态：设置开关保持开启；Demand 会话和助手终态在刷新及第二个 Tab 中一致。

## 清理

- 关闭两个测试浏览器 Tab。
- 停止本地 43214 测试服务。
- 将临时 SQLite、Workspace、Worktree 和测试 Git 仓库 `/tmp/codywork-open-groups.xDexh1` 移入本机废纸篓，可恢复。
- 未修改或清理任何真实用户仓库和生产数据。
