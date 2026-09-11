# CodyWork E2E 回归记录：需求会话内由 AI 管理快捷指令

- 日期：2026-09-11
- 执行者：Codex
- 代码 revision：`197557644a04` + 本轮未提交工作区改动
- 分支：`codex/agent-quick-actions`
- Core 版本：`0.38.8`
- Runtime：真实 Codex App Server，CLI `0.153.4`，模型 `gpt-5.6-sol`
- 环境与 URL：本机隔离服务，`http://127.0.0.1:43235`
- 浏览器：Codex In-app Browser，两个标签页
- SQLite 数据库：临时 `/tmp/codywork-agent-quick-action-e2e.MhA9gw/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-agent-quick-action-e2e.MhA9gw/workspace`

## 结论

需求会话中的 AI 现在可以通过 CodyWork 产品工具查询现有快捷指令、搜索统一 Skill Catalog，并在用户明确要求时创建或更新快捷指令。写入仍复用设置页的同一份数据，记录来源会话、来源 Turn、编辑入口和递增版本；Turn 完成后工具箱自动刷新，无需重新加载页面。

真实 Runtime 回归中，AI 创建并启用了 `E2E 需求检查`，绑定 Workspace Skill `e2e-review`；工具箱立即显示该指令，点击后以结构化 Skill 引用发送，并返回 `E2E_ACTION_OK`。仅发送“这个 Prompt 挺好用”时没有调用写入工具，数据库记录和版本均保持不变。服务重启后，同一原生 Thread 仍可调用产品工具更新指令。

按自然语言说“使用 e2e-review Skill……把这段内容沉淀成快捷指令”时，AI 自动生成名称 `E2E 沉淀检查`，把 Prompt 与 `e2e-review` 结构化落库。回归中进一步发现并修复了更新时省略 `skills` 会误清空原值的问题；最新版工具要求 `expectedRevision` 防止覆盖并把省略字段解释为保持原值，相同内容重复保存也不会增加版本。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 隔离数据库和临时 Workspace 可直接加载，Workspace、Demand 和会话均正常恢复。 | 本地回环环境。 |
| E2E-004 | PASS | 精确 URL 刷新后恢复同一 Demand、Conversation、消息历史和快捷指令。 | 未创建重复会话。 |
| E2E-007 | PASS | AI 创建快捷指令、工具箱点击执行以及普通消息均完成，状态从执行中收敛到已完成。 | 使用真实 App Server。 |
| E2E-008 | PASS | 多次刷新及服务重启后，消息顺序稳定，快捷指令仍为 1 条，无重复消息。 | 数据库版本为 v2。 |
| E2E-011 | PASS | 两个标签页打开同一会话；一个标签页发送 `MULTITAB_OK` 验证消息，另一个实时收到；服务重启后两页均恢复 Realtime connected。 | 两页 console error/warn 均为 0。 |
| E2E-016 | PASS | 页面、设置页、工具箱和消息流均可操作；健康检查正常，浏览器控制台和服务端没有未处理异常。 | 本轮重点为功能链路，未做窄屏专项。 |
| E2E-017 | PASS | AI 明确收到创建授权后搜索 Skill 并落库；工具箱无需刷新出现新指令，点击后发送 `$e2e-review` 并返回 `E2E_ACTION_OK`；设置页显示来源和版本。自然语言“沉淀成快捷指令”可自动命名并结构化保存 Skill。 | 新会话使用 list 返回的 actionId/revision 更新，Prompt 变为 `DEPOSIT_OK_V2`，Skill 数仍为 1、启用状态仍为 true、版本从 v1 递增到 v2。 |
| E2E-018 | PASS | 临时移走 `e2e-review` 后，列表显示“需修复”，编辑页显示“以下 Skill 已失效”及移除入口；恢复 Skill 后数据未损坏。 | 测试 Skill 已恢复。 |

## 自动化与协议验证

- `pnpm verify`：PASS。
- 服务端测试：PASS（22 个测试文件，137 项）。
- 前端测试：PASS（16 个测试文件，60 项）。
- 类型检查、Core 版本校验、前后端 production build：PASS。
- 真实 App Server 动态工具协议探针：PASS；`thread/start` 注册 `codywork_quick_actions.save`，`item/tool/call` 被 CodyWork 接收并返回结果。
- 数据库断言：快捷指令 `count=2`；`E2E 沉淀检查` 为 `revision=2`、`enabled=true`、`skill_count=1`、`last_edited_via=agent`，并保留来源 Conversation 与 Turn。
- 模糊表达安全边界：PASS；“这个 Prompt 挺好用”没有触发动态写入工具。
- 更新保护：PASS；自动化覆盖 stale `expectedRevision` 拒绝、未提供 Skill/启用状态时保留原值，以及相同内容重复保存不涨版本。
- `GET /api/health`：PASS。
- 两个浏览器标签页 console error/warn：0。

## 环境说明与清理

- 首次尝试复用了全局 Codex hooks，导致测试 Turn 被外部 hook 阻塞；随后改用只复用登录凭据、不加载全局 hooks 的临时 `CODEX_HOME`，真实 Runtime E2E 正常完成。这是测试隔离问题，不是本功能故障。
- App Server 的动态工具定义随原生 Thread 创建；上线前已存在的旧 Demand 会话需要新建一次会话才能获得本能力。新会话创建后，服务重启和 Thread 恢复均已验证正常。
- 测试完成后停止 43235 端口服务、关闭两个隔离标签页，并将一次性 Workspace、Worktree、SQLite、测试 Skill 和测试 Git 仓库整体移入系统废纸篓。
- 未读取或修改正式数据库、真实用户 Workspace 或业务仓库；未提交、推送或部署。
