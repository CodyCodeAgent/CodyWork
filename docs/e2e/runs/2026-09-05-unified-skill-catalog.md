# CodyWork E2E 回归记录：统一 Skill Catalog 与搜索

- 日期：2026-09-05
- 执行者：Codex
- 代码 revision：`20cceb9` + 当前未提交改动
- Core 版本：正式依赖 `0.37.31`；消息收敛回归使用 `827864f` + 当前 Core 未提交改动构建
- 环境与 URL：本地隔离服务 `http://127.0.0.1:3321`，Demand 专属 URL
- 浏览器与视口：Codex 内置浏览器，默认桌面视口及 `820 × 900`
- SQLite 数据库：临时，`/tmp/codywork-skill-e2e.ivqECp/workspace.db`
- 测试 Workspace：`/tmp/codywork-skill-e2e.ivqECp/workspace`

## 结论

统一 Skill Catalog、搜索、来源展示、同名 Skill 路径消歧、快捷指令和 Composer `$` 引用均通过隔离环境回归。可以继续提交；正式合并 CodyWork 前应先发布包含本轮消息收敛修复的 Core 版本并升级依赖。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 错误密码被拒绝，正确密码登录；刷新、新 Tab 均恢复同一 Workspace | 登录态未重复丢失 |
| E2E-004 | PASS | 带 `workspace`、`demand` 参数的 URL 在刷新和新 Tab 后恢复同一 Demand、会话与历史 | 未出现空白页或串 Demand |
| E2E-007 | PASS | 发送 `APPROVAL OPTIMISTIC_E2E` 后，在审批和回复出现前已看到唯一用户气泡；终态刷新后仍仅一条 | 覆盖 optimistic、绑定和正式历史收敛 |
| E2E-008 | PASS | 连续完成普通、审批和排队 Turn；刷新后三条唯一 Prompt 各出现一次，无残留“正在发送”、重复回复或 Worked | 验证了 Core `command.bound` 修复 |
| E2E-009 | PASS | Composer `$` 列出 Workspace、Codex 全局和 Codex 内置 Skill；可多选并按结构化路径发送 | 同名 Skill 同时展示来源和完整路径 |
| E2E-011 | PASS | 三个同站点 Tab 可同时连接；重启本地测试服务后自动重连，Tab 间实时同步 `MULTITAB_SYNC_E2E` | 未互相踢线、未重复消息 |
| E2E-016 | PASS | 默认视口与 `820 × 900` 下检查 Demand、Skills、设置和 Composer；新 Tab console 为空，服务端无异常日志 | 主要控件可访问，未见意外水平溢出 |
| E2E-017 | PASS | 创建包含两个 Skill 的快捷指令，刷新持久化；空闲直接执行、运行中进入队列且只执行一次；停用隐藏、重新启用、确认删除均正常 | SQLite 持久化及完整生命周期通过 |
| E2E-018 | PASS | 通过测试 Runtime 移除 `global-review`：设置标记“需修复”，Demand 禁用指令；编辑页明确列出失效名称并可移除、改选、保存后恢复 | 未静默忽略失效 Skill |

## 统一 Skill Catalog 专项

- Skills 页面、快捷指令和 Composer 均消费 Codex Runtime `skills/list` 的同一份目录，不再各自扫描和拼装。
- 搜索覆盖名称、展示名、描述、路径和来源；空结果和匹配数量反馈正确。
- Workspace、Codex 全局、Codex 内置、管理员来源有独立标签。
- 同名 Skill 不做名称级隐式覆盖，列表标记同名数量；详情、快捷指令和 `$` 菜单按完整路径区分并固定引用。

## 发现并修复的问题

1. 刷新后，原生用户消息可能不携带 Skill 元数据，导致它与 `command.queued` 乐观消息无法收敛。Core 现以 `command.bound` 的命令到 Turn 身份为准，保留原生消息并补回结构化 Skill/图片元数据。
2. 快捷指令引用失效 Skill 时只能看到泛化提示，且缺少可操作的移除入口。现明确列出失效 Skill 名称，并提供“移除失效引用”后重新选择和保存。
3. 同名 Skill 只显示名称时无法判断来源。现统一展示来源、同名数量和精确路径，并在 Composer 中明确说明路径消歧。

## 未解决问题与阻塞

- 源码尚未提交、推送、打 Core tag 或部署；CodyWork 的正式依赖仍是 Core `0.37.31`。本轮按当前请求仅完成实现和验证。

## 健康检查

- `pnpm verify`：PASS；server 16 个测试文件 / 75 个测试，web 10 个测试文件 / 33 个测试，类型检查与生产构建通过。
- Core：12 个测试文件 / 192 个测试，类型检查通过。
- 浏览器 console error/warn：最终新开 Tab 为 0；复用的旧 Tab 仅保留本轮初始化前已发生的旧路径错误记录。
- 服务端异常日志：无未处理异常或重试风暴。
- 刷新/重连后的最终状态：`Realtime connected / Browser WebSocket connected`。

## 清理

- 停止本地 3321 测试服务。
- 关闭本轮三个临时浏览器 Tab。
- 将 `/tmp/codywork-skill-e2e.ivqECp` 下的一次性 Workspace、Worktree、SQLite 和 Runtime 状态移入废纸篓，可恢复。
- 未修改或清理任何真实用户 Workspace、仓库或会话。
