# CodyWork E2E 回归记录：超大 Thread 失败恢复

- 日期：2026-09-23
- 执行者：Codex
- 代码 revision：`f2de81ec1906` + 本轮未提交工作区改动
- Core 版本：`0.39.4`
- 环境与 URL：本机 production build，`http://127.0.0.1:43257`
- 浏览器与视口：Codex In-app Browser，`775 × 862`，两个标签页
- SQLite 数据库：临时 `/tmp/codywork-thread-recovery-e2e.rlGF3e/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-thread-recovery-e2e.rlGF3e/workspace`

## 结论

CodyWork 现在会识别“Codex 上游响应流已无法恢复”这类在原 Thread 上必然重复失败的错误。用户明确点击重试后，产品会在同一 Workspace/Demand 内新建 Thread，保留权限、模型、推理档位、Skill、最近文字上下文和可读取的图片，并继续原请求。普通短暂网络错误仍在原 Thread 上重试，不会无条件制造新会话。

飞书入站图片同时改为复制到会话自有存储并登记不透出本地路径的 URL，为浏览器历史展示和跨 Thread 恢复提供稳定输入。自动化、真实 Codex Runtime 消息、刷新、Demand 专属 URL、多标签页实时收敛和窄视口页面回归均通过，可以继续提交。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从空数据库通过 UI 登记 `Thread Recovery E2E`；刷新和第二标签页均恢复同一 Workspace | 回环环境无密码 |
| E2E-004 | PASS | Demand 专属 URL 同时含 `workspace`/`demand`/`conversation`；刷新后恢复 `Thread Recovery Demand` 和原会话 | 无重复会话 |
| E2E-007 | PASS | `THREAD_RECOVERY_BROWSER_OK` 发送后 250ms 内可见唯一用户气泡和“正在发送”，后续收敛为正式历史 | 真实 Codex Runtime |
| E2E-008 | PASS | 两轮回复均为用户/AI/Worked 顺序；刷新后无重复 | 回复分别为 `THREAD_RECOVERY_BROWSER_OK` 和 `THREAD_RECOVERY_MULTITAB_OK` |
| E2E-010 | BLOCKED | 单元测证明仅不可恢复的上游流错误走新 Thread，普通网络错误不迁移 | 隔离 Runtime 中未人为制造 20MB+ 原生 Thread，未完整执行停止/失败 UI 全矩阵 |
| E2E-011 | PASS | 第二标签页发送后，第一标签页在 300ms 内收到消息；终态两页各只有一组用户/AI 文本 | 两页均 `Realtime connected` |
| E2E-012 | BLOCKED | 已有生产故障数据证实超大 Thread 上游主动关闭；本轮单测覆盖错误识别、上下文裁剪和新会话标题 | 本地隔离 E2E 未复刻上游尺寸限制 |
| E2E-013 | BLOCKED | 服务端自动化验证飞书下载图片复制、会话隔离、opaque URL 映射和删除边界 | 当前 CUA 文件输入不提供 `setInputFiles`，未完成页面粘贴/预览矩阵 |
| E2E-016 | PASS | `775×862` 下无水平溢出；概览、知识库、Skills、设置和会话页均可打开；两个标签页 console 日志均为空 | 服务端无未处理异常 |
| E2E-020 | BLOCKED | Channel pipeline 自动化验证飞书图片持久化后的路径进入统一 Conversation Gateway | 本轮未向真实飞书群发消息 |

## 发现并修复的问题

- 失败 outbox 的“重试此消息”原先总是重用同一原生 Thread；对超大 Thread 造成的上游流关闭，这会稳定重复失败。现改为只在该错误上显式迁移。
- 新 Thread 恢复会携带裁剪后的最近用户/AI 文字，并要求 Agent 先检查文件、Git 和进程的实际状态，避免将失败前已经落地的副作用再做一次。
- 飞书图片原先只以 `docs/.channel-attachments/` 绝对路径进入 Runtime，没有登记到 `conversation_images`，导致浏览器历史不能稳定展示或迁移。现复制到会话自有存储，源附件不被删除。

## 未解决问题与阻塞

- CodyWork 能规避超大 Thread 上反复失败，但根本的上游 WebSocket/历史载荷限制仍属于 Codex Runtime。
- 已经存在于旧历史中、仅保存为绝对路径的飞书图片无法追溯登记；新消息从本修复开始使用会话自有存储。

## 健康检查

- `pnpm verify`：PASS（服务端 25 个文件 / 155 项，前端 20 个文件 / 70 项，类型检查、Core 版本校验和生产构建通过）。
- 浏览器 console error/warn：两个标签页均无日志。
- 服务端异常日志：无未处理异常；仅 Node SQLite experimental warning。
- 刷新/重连后的最终状态：两个标签页均 `Realtime connected`，历史各一份。
- `GET /api/health`：HTTP 200，`service=codywork`，`status=ok`。

## 清理

- 已关闭两个隔离测试标签页并停止 43257 端口服务；一次性 Workspace、Demand Worktree、SQLite、测试 Git 仓库和本地 bare remote 已整体移入 `/Users/bytedance/.Trash/codywork-thread-recovery-e2e.rlGF3e`，可恢复。
- 未修改或清理真实用户 Workspace、业务仓库、正式数据库或飞书群。
