# Gemini 接入和 Skill 共享验收

- 日期：2026-11-20，北京时间。
- 基线：CodyWork `c18454d`、CodyWebCore `6b81acf`，均叠加本地改动。CodyWork 的隔离构建使用锁定的 Core 0.46.0 及仓库内补丁。
- 环境：本机生产构建、IAB 两个标签、隔离 SQLite、一个合成 Workspace 和 Demand、Codex / ACP 测试进程。另在 CN 对真实 agy 做了单次临时目录验证。

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Gemini 接入、共享、切换及发送 | PASS（测试进程） | Runtime 卡显示 CLI、ACP 和模型请求三项结果，Codex 仍是默认值。Skills 页面点击共享后创建工作区内的相对软链。切到 Gemini 后，输入 `$fixture`、按 Enter 选择，收到 `FIXTURE_SKILL_OK`。原 Codex 会话保留，新会话标题标为 Gemini。合成地区拒绝显示 ACP 已连接、模型请求未通过。 |
| 外部个人 Skill 导入 | PASS（自动化） | 个人 Skill 目录和参考文件一起导入，原件保持原样。同名冲突时保留已有副本。 |
| 真实 Antigravity | BLOCKED（模型） | CN 的 agy ACP 上报了临时 `.agents/skills/` 中的测试 Skill。原生斜杠请求在 18 秒观察窗口内未返回，真实模型生成无法确认。 |
| E2E-001 | PASS | 错误测试密码有明确反馈，正确密码进入预置 Workspace，后续刷新恢复会话。 |
| E2E-004 | PASS（本次需求和会话路径） | 两个标签从需求 URL 可进入原会话，Gemini 会话专属 URL 刷新后恢复同一条 Skill 消息和回复。未跑全部浏览器前进后退组合。 |
| E2E-007 | PASS（首屏、收敛、刷新及失败） | 慢请求立即出现一条用户消息，完成及刷新后内容保留。合成上游退出显示失败和手动重试。Gemini 选 Skill 的消息保留原文与引用。 |
| E2E-008 | PASS（本次正常顺序） | 四条 Codex 轮次和四份相同回复在刷新后仍按顺序保留，Gemini 工具及 Skill 回复正常结束。未跑所有历史与实时事件 ID 组合。 |
| E2E-009、010 | NOT RUN（仅部分验证） | 验证 Gemini 键盘选 Skill 后发送，以及 Codex 失败显示手动重试。Gemini 每条消息支持一个原生 Skill。未跑 Codex 多 Skill 排队和完整停止、重试组合。 |
| E2E-011 | PASS | 两标签实时同步。主动重启隔离服务后观察到自动重连，四轮历史未重复。 |
| E2E-012 | NOT RUN（仅部分验证） | 合成 Codex App Server 退出时网页连接继续，失败消息可见。未模拟真实上游 HTTPS fallback。 |
| E2E-016 | PASS（受改页面） | 1280px 会话与 820px Gemini 会话、Skills 页面均无横向溢出。新功能正常路径的浏览器控制台无 warn/error。未跑图片预览等未改面板。 |
| E2E-017、018 | NOT RUN（仅部分验证） | 快捷指令能选两个 Codex Skill，保存并刷新后保持配置。未跑完整快捷指令执行、AI 创建及 Skill 失效组合。 |
| E2E-022 | NOT RUN（仅部分验证） | 安装任务弹窗可开始、收起，后台仍运行。另验证手动暂停进入终态。长任务被刻意注入的上游退出打断，未验证超过 120 秒后正常完成。 |

浏览器发现 ACP 的用户消息回显会把斜杠指令和内部上下文显示在气泡中。修复后仅显示原始用户消息和 Skill 标签，已复验发送及刷新。

Core 全量测试、CodyWork `pnpm verify`、末次相关类型检查、生产构建和聚焦回归通过。CodyWebUI 当前未调用此次新增的 ACP 接口。未使用真实业务数据或发送外部消息。隔离服务、浏览器标签、SQLite 和测试目录在验证后清理。
