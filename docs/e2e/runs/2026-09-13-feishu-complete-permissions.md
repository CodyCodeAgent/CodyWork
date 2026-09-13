# CodyWork E2E 回归记录：飞书机器人固定完整权限

- 日期：2026-09-13
- 执行者：Codex
- 代码 revision：`92ff1e29afdb` + 本轮未提交工作区改动
- Core 版本：`0.38.8`
- 环境与 URL：本机隔离 production build，`http://127.0.0.1:43261`
- 浏览器与视口：Codex In-app Browser，默认桌面视口，两个独立标签页
- SQLite 数据库：临时 `/tmp/codywork-feishu-permissions-e2e.MyqfOW/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-feishu-permissions-e2e.MyqfOW/workspace`

## 结论

新建和已有飞书机器人现在统一使用固定的 17 项完整权限模板，不提供逐项删减。填写 App ID 后可进入飞书批量权限申请页，链接携带整份模板；保存机器人后 CodyWork 回读租户授权状态，明确显示权限完整、缺失/待授权项或检查失败。会话分享使用飞书官方列出的精确文档 scope，遇到飞书错误时会给出失败步骤、平台详情或错误码，以及设置入口、发布版本和管理员授权提示，不再只显示 HTTP 400。

代码、自动化测试、production build 和隔离浏览器主流程通过。真实飞书管理员授权、外部消息和真实文档创建未在本轮执行，因为本轮没有新的外部发送或权限变更授权；相关用例按 `BLOCKED` 记录。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从空数据库登记 `Feishu Permissions E2E` Workspace；刷新、服务重启和第二标签页后均恢复，两个标签最终显示 `Realtime connected`。 | 回环环境不启用密码。 |
| E2E-004 | PASS | 创建两个 Demand 会话；专属 URL 同时含 workspace、demand、conversation，直接打开和刷新后保持同一空会话，旧会话历史未串入。 | 未创建重复 Workspace 或 Demand。 |
| E2E-007 | PASS | 发送 `FEISHU_PERMISSION_P0_E2E` 后页面出现一条用户消息，并收敛为一条正式用户消息和一条 `CODEX_FIXTURE_OK`。另用 `PAUSE_E2E MULTITAB_PERMISSION` 观察到执行中状态。 | 使用确定性 Runtime fixture。 |
| E2E-008 | PASS | 首轮完成后刷新、新标签页和服务重启，唯一用户消息与唯一助手回复数量、顺序保持。 | 无 optimistic/终态重复。 |
| E2E-011 | PASS | 两个标签页同时连接；停止服务后都进入连接中，恢复服务后都自动回到 `Realtime connected`，历史各一份。 | 页面之间未互踢。 |
| E2E-016 | BLOCKED | 默认桌面视口下概览、Demand、设置、飞书机器人和分享 Dialog 无横向阻断；两个标签页 console warning/error 均为 0，服务端无未处理异常。 | 当前 In-app Browser 未提供 viewport capability，无法完成约 820px 的窄视口断言。 |
| E2E-020 | BLOCKED | 浏览器子流程通过：新建机器人始终显示 17 项固定权限且权限区复选框为 0；批量申请链接包含 17 项 scope；保存、刷新和服务重启后配置存在、Secret 为空、检查失败及修复入口可见。 | 未修改真实飞书权限，也未发送私聊、群聊、话题、卡片或附件消息。 |
| E2E-023 | BLOCKED | 分享 Dialog 正常展示导出边界、默认名称和机器人选择；没有已启用机器人时明确提示并禁用创建。缺权 Axios 400 到可操作产品错误由自动化测试覆盖。 | 未创建真实飞书文档。 |

## 发现并修复的问题

- 原分享失败只透传 Axios 的 `Request failed with status code 400`。现在解析并保留失败步骤、飞书错误详情和错误码；`99991672` 会说明机器人缺少 CodyWork 完整权限，并引导到设置页补齐、发布版本和完成管理员授权。
- 根据飞书官方接口文档将分享权限拆为精确 scope：创建 `docx:document:create`、写入 `docx:document:write_only`、转换 `docx:document.block:convert`、权限设置 `docs:permission.setting:write_only`、失败清理 `space:document:delete`，避免用户只开文档写入权限后仍在最后一步收到 400。
- 原机器人设置没有统一权限事实源，也无法知道已有应用缺什么。现在 Server 提供固定模板与授权状态接口，Web 新建页、已有账号页和修复入口消费同一份清单。
- 权限申请入口最初使用单权限搜索深链拼接多个 scope；复核现有飞书接入后改为 `/page/scope-apply` 批量申请页，确保一次携带整份固定模板。
- 权限状态检查只读取飞书 `application.scope.list`，响应和页面不包含 App Secret。

## 未解决问题与阻塞

- 飞书平台仍要求人工确认权限、发布应用版本并由租户管理员授权；App Secret 不能绕过这些安全步骤，这是平台边界，不是 CodyWork 运行错误。
- 完整 E2E-020 和 E2E-023 需要用户明确授权使用专用测试应用、测试群并创建一次性飞书文档后执行。
- 本轮测试浏览器不支持窄视口覆盖，因此 E2E-016 保留为 `BLOCKED`，不能用桌面结果冒充完整响应式回归。
- 部署前对正式机器人执行了只读 scope 回读：文档创建、编辑、读取和 Markdown 转换均已租户授权，但 `docs:permission.setting:write_only` 与 `space:document:delete` 尚未出现。因此旧版分享流程仍会在访问权限设置阶段返回 400；该检查未读取或输出 App Secret，也未创建真实文档。

## 健康检查

- `pnpm verify`：PASS（服务端 24 个文件 / 145 项，前端 17 个文件 / 63 项；类型检查、Core 版本校验和 production build 均通过）。
- 浏览器 console error/warn：两个隔离标签页均为 0。
- 服务端异常日志：无未处理异常；只有 Node SQLite experimental warning。
- 刷新/重连后的最终状态：两个标签页均恢复 `Realtime connected`；Workspace、Demand、两个会话和测试机器人配置保持。

## 清理

- 本报告写入后关闭两个隔离浏览器标签页并停止 43261 端口服务。
- 一次性 Workspace、Worktree、SQLite、Runtime fixture 状态和假机器人凭证目录整体移入系统废纸篓；不触碰正式凭证、正式数据库、真实飞书权限、业务 Workspace 或业务仓库。
