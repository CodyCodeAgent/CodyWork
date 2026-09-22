# 飞书引用消息上下文 E2E 回归记录

- 日期：2026-09-22
- 执行者：Codex
- 代码 revision：`1939236` + 当前引用消息上下文工作区修改
- Core 版本：`@codycodeagent/cody-web-core` 0.39.4
- 环境与 URL：本地 production build，`http://127.0.0.1:43341`
- 浏览器与视口：Codex in-app browser，1280×720
- SQLite 数据库：临时 `/tmp/codywork-quote-e2e.4EQDwI/runtime/workspace.db`
- 测试 Workspace：一次性 Workspace `Quoted Message E2E`

## 结论

PASS，可继续提交、合并和打 tag。本轮未部署。飞书真实群消息属于外部写入，本轮没有获得发送测试消息的单独授权，因此 E2E-020 的真实外部消息部分记为 BLOCKED；Core 与 CodyWork 的进程内通道流水线已覆盖引用正文、发送者、图片、文件、长度上限和当前消息分隔。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 通过 API 注册一次性 Workspace，浏览器加载概览并识别 1 个 Git Repo；服务重启后 Workspace 自动恢复。 | 健康接口和 UI 均正常。 |
| E2E-004 | PASS | 浏览器创建 Demand 后 URL 同时包含 Workspace、Demand、Conversation；刷新和服务重启后仍恢复同一会话和消息。 | URL 身份完整。 |
| E2E-007 | PASS | Composer 发送 `QUOTED_CONTEXT_BROWSER_E2E`，页面只出现一条用户消息并正常完成。 | 使用确定性 Runtime fixture。 |
| E2E-008 | PASS | 终态是一条用户消息、一条 `CODEX_FIXTURE_OK` 和一个 Worked 分隔；刷新和重启后无重复、无错序。 | 历史来源保持原生 Thread。 |
| E2E-011 | PASS | 创建 Demand 后显示 `Realtime connected`；服务停止、重启后自动恢复连接，历史消息保持不变。 | 重连完成后无额外消息。 |
| E2E-016 | PASS | 1280×720 下 `body` 与 `documentElement` 宽度均为 1280，无水平溢出；浏览器 console 无 error/warn。 | Demand、会话栏和 Composer 完整可用。 |
| E2E-020 | BLOCKED | `channelPipeline.spec.ts` 和 `channelBot.spec.ts` 进程内通道回归 PASS：引用正文、发送者、图片输入、文件路径、12,000 字上限及当前消息分隔均已验证。 | 未向真实飞书群发送测试消息；需要部署后的外部写入授权。 |

## 发现并修复的问题

1. CodyWork 原先只把当前飞书消息正文交给 Codex，虽然 Core 保存了 `replyTo`，但引用消息没有进入 Prompt。
2. Core 现在按 `replyTo` 拉取一层引用消息详情，校验同一会话后输出 provider-neutral `quotedMessage`；拉取失败会记录告警并仅处理当前消息。
3. CodyWork 现在用明确边界分隔“引用消息”和“当前消息”，引用正文最多保留 12,000 字；引用图片作为模型图片输入，引用文件下载到独立消息目录并把路径写入 Prompt。

## 未解决问题与阻塞

- 真实飞书话题群/普通群引用消息尚未执行外部 E2E；本轮没有发送真实消息的单独授权，留待部署后验证。

## 健康检查

- `pnpm verify`：PASS；Server 25 文件 / 154 测试，Web 19 文件 / 67 测试，类型检查、Core 0.39.4 版本校验和 production build 通过。
- 浏览器 console error/warn：0。
- 服务端异常日志：0；仅有 Node SQLite experimental warning。
- 刷新/重连后的最终状态：Demand、Conversation、唯一用户消息和唯一 assistant 终态全部恢复，Realtime connected。

## 清理

测试后关闭隔离浏览器标签、停止本地服务，并移除一次性 Workspace、Demand Worktree、Runtime fixture state 与临时 SQLite。未修改真实用户仓库、正式数据库或飞书数据。
