# CodyWork E2E 回归记录：会话导出为飞书文档

- 日期：2026-09-11
- 执行者：Codex
- 代码 revision：`197557644a04` + 本轮未提交工作区改动
- 分支：`codex/agent-quick-actions`
- Core 版本：`0.38.8`
- 环境与 URL：本机隔离服务，`http://127.0.0.1:43241`
- 浏览器：Codex In-app Browser
- SQLite 数据库：临时 `/tmp/codywork-conversation-share-e2e.3oKsC8/browser-workspace-3.db`
- 测试 Workspace：临时 `/tmp/codywork-conversation-share-e2e.3oKsC8/workspace`

## 结论

会话顶部已提供低干扰的“分享”入口。用户可设置文档名称、选择已启用的飞书机器人，并把当前原生 Codex Thread 导出为一份飞书文档静态快照。成功后会显示导出消息数、复制链接和打开文档入口。

文档源仍是原生 Thread 快照，CodyWork 没有新增第二份聊天记录。内容只保留用户文字和 AI 文字，保留 Markdown、列表、代码块与链接；工具调用、命令日志、思考、审批、状态与图片均不导出。被中断但已经对用户可见的 AI 文字会保留并标记“回复已中断”。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 隔离 Workspace、原生会话与消息历史均正常加载。 | 使用确定性测试 Runtime。 |
| E2E-004 | PASS | 精确 URL 刷新后恢复同一 Workspace 会话、消息和完成状态。 | 未创建重复会话。 |
| E2E-008 | PASS | 刷新前后用户消息、AI 文字、工具项和顺序一致。 | 导出不写入会话历史。 |
| E2E-016 | PASS | 概览、知识库、Skills、设置与会话页均可正常打开。 | 浏览器 console error/warn 为 0。 |
| E2E-023 | PASS | 分享弹窗展示保留/排除范围，自动选中可用机器人；自定义标题后创建成功，显示 2 条文字消息，链接可复制。 | 发布器断言导出中包含 `SHARE_E2E_OK` 和代码块，且不包含 `PRIVATE_LOG`。 |

## 自动化与协议验证

- `pnpm verify`：PASS。
- 服务端测试：PASS（23 个测试文件，140 项）。
- 前端测试：PASS（17 个测试文件，62 项）。
- 类型检查、Core 版本校验、前后端 production build：PASS。
- 内容筛选单测：PASS；验证用户/AI 文字、Markdown 代码块、中断标记，并排除思考、工具、命令日志和图片路径。
- 空会话防护：PASS；在联系飞书发布器前直接拒绝无可导出文字的快照。
- 审计断言：PASS；`conversation.document.shared` 记录包含 Workspace、文档 ID 和消息数。

## 外部飞书说明与清理

- 本轮为避免用正式机器人在用户云空间产生测试文档，浏览器 E2E 使用了确定性飞书发布器，没有创建真实飞书文档。
- 真实实现使用已配置机器人的 App ID/Secret，通过飞书 Docx API 创建文档、将 Markdown 转换为 Block 并写入，然后把链接权限设为组织内可读。任一后续步骤失败时会尽力将半成品移入回收站。
- 隔离浏览器标签页和本地服务已关闭；一次性 Workspace、SQLite 和测试脚本已整体移入系统废纸篓，可恢复。
- 未读取或修改正式数据库、真实用户 Workspace 或业务仓库；未提交、推送或部署。
