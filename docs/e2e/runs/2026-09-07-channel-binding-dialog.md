# CodyWork E2E 回归记录：会话机器人绑定弹窗

- 日期：2026-09-07
- 执行者：Codex
- 代码 revision：`c386f67f4bdf` + 本轮未提交工作区改动
- Core 版本：`0.38.8`
- 环境与 URL：本机 production build，`http://127.0.0.1:3437`
- 浏览器与视口：Codex In-app Browser，默认桌面视口与 `820 × 900`；两个独立标签页
- SQLite 数据库：临时 `/tmp/codywork-channel-dialog-e2e.ovi7LT/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-channel-dialog-e2e.ovi7LT/workspace`

## 结论

浏览器侧改动通过。本轮移除了聊天内容区常驻的飞书绑定横幅，把会话列表中的机器人标识改为独立按钮，并通过按需弹窗展示绑定详情和操作。自动化、生产构建及隔离浏览器 P0 回归均通过；可以继续提交。完整真实飞书收发矩阵本轮没有外部消息授权，因此 `E2E-020` 仍按 `BLOCKED` 记录，不能据此宣称外部通道全量回归完成。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从空数据库通过 UI 登记 `Channel Dialog E2E` Workspace；刷新与服务重启后恢复同一 Workspace。 | 回环环境不启用密码。 |
| E2E-004 | PASS | 复制的链接包含精确 workspace、demand、conversation；第二标签页与刷新均恢复同一 Demand、会话和机器人入口。 | 未创建重复会话。 |
| E2E-007 | PASS | 发送 `CHANNEL_DIALOG_RESTART_E2E` 后立即显示唯一用户消息及发送状态。 | 使用持久化 fixture Runtime。 |
| E2E-008 | PASS | 终态只有一条用户消息和一条 `CODEX_FIXTURE_OK`；刷新、第二标签页及服务重启后数量和顺序保持。 | 无重复 optimistic 或终态。 |
| E2E-011 | PASS | 两个标签页同时显示 `Realtime connected`；停止服务后都进入 connecting，恢复后重新连接并恢复历史。 | Runtime fixture 状态写入临时目录。 |
| E2E-016 | PASS | 默认视口与 `820 × 900` 均无水平溢出；机器人按钮实测 `44 × 44`，弹窗可用关闭按钮和 `Esc` 退出。 | 两个标签页 console error/warn 均为 0。 |
| E2E-020 | BLOCKED | 浏览器子流程通过：内容区横幅数量为 0；机器人按钮按需展示机器人、话题、连接状态、脱敏用户、Thread、投递状态；复制链接正确；确认后解除绑定，弹窗转为空状态，关闭及刷新后入口消失但 Thread 历史保留。 | 未向真实飞书发送消息，未执行私聊、群聊、话题、附件、交互请求、解绑后重新入站绑定及外部重启恢复全矩阵。 |

## 发现并修复的问题

- 原绑定信息作为横跨内容区的常驻横幅，视觉优先级高于会话内容。现改为列表中的低干扰机器人按钮和按需详情弹窗。
- 原标识只有约 17px 且不可单独点击。现视觉图标为 22px、实际点击区域为 44px，并补充可见焦点、按钮语义和完整 `aria-label`。
- 绑定详情、复制链接、解除绑定、连接异常和投递积压原先分散在横幅中；现统一收敛到可滚动、响应式弹窗。

## 未解决问题与阻塞

- 完整 `E2E-020` 需要再次使用专用测试机器人和测试群发送真实外部消息。本轮用户只要求浏览器 UI 调整，没有授权新的外部消息，因此保留为 `BLOCKED`。

## 健康检查

- `pnpm verify`：PASS（服务端 133 项、前端 59 项，类型检查、Core 版本校验和生产构建通过）。
- 浏览器 console error/warn：两个标签页均为 0。
- 服务端异常日志：无未处理异常；只有 Node SQLite experimental warning。
- 刷新/重连后的最终状态：两个标签页均恢复 `Realtime connected`；历史各一份，机器人入口和弹窗详情保持，内容区无绑定横幅。

## 清理

- 已关闭隔离测试标签页并停止 3437 端口的 CodyWork 进程。
- 一次性 Workspace、Worktree、SQLite、Runtime fixture 状态和测试 Git 仓库目录已整体移入系统废纸篓 `/Users/bytedance/.Trash/codywork-channel-dialog-e2e.ovi7LT`，可恢复。
- 未读取或修改正式飞书凭证、正式数据库、真实用户 Workspace 或业务仓库。
