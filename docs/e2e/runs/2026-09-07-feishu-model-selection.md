# CodyWork E2E 回归记录：飞书模型选择与执行卡配置

- 日期：2026-09-07
- 执行者：Codex
- 代码 revision：`e46e2a5` 加本轮未提交改动
- Core 版本：`0.38.8`
- 环境与 URL：本地生产构建，`http://127.0.0.1:43215/`
- 浏览器与视口：Codex In-app Browser，桌面视口，两个 Tab
- SQLite 数据库：临时，`/tmp/codywork-feishu-model.EPo97S/workspace.db`
- 测试 Workspace：`/tmp/codywork-feishu-model.EPo97S/workspace`

## 结论

飞书绑定级模型配置、合法推理档位校验、SQLite 持久化、Turn 参数传递和执行卡配置快照已通过自动化测试。浏览器 P0 会话链路在隔离生产构建中通过。代码尚未部署，本轮也未获得发送真实飞书测试消息的授权，因此 `/model` 交互卡和真实飞书终态卡验证标记为 `BLOCKED`，不能宣称外部通道 E2E 已完成。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从空数据库创建 `Feishu Model E2E` Workspace，自动识别一次性 Git 仓库并进入页面 | 使用隔离 SQLite 和一次性仓库 |
| E2E-004 | PASS | Demand 专属 URL 含精确 workspace、demand、conversation；刷新后恢复同一会话 | 历史和终态保持 |
| E2E-007 | PASS | 发送 `FEISHU_MODEL_UI_OK` 后立即出现用户消息、“正在发送…”和 Thinking | 随后收敛为正式历史 |
| E2E-008 | PASS | 9 秒后仅显示一次助手回复 `FEISHU_MODEL_UI_OK`，会话状态为“已完成” | 无重复用户或助手消息 |
| E2E-011 | PASS | 第二个 Tab 使用相同专属 URL，恢复同一 Thread、完整历史和 Realtime connected | 两个 Tab 内容一致 |
| E2E-016 | PASS | 页面无布局阻断；两个 Tab console 均无 warning/error；服务端无异常日志 | 本地生产构建运行 |
| E2E-020 | BLOCKED | 自动测试覆盖 `/model` 两步选择、创建者权限、合法模型/推理校验、持久化、执行参数和卡片内容 | 未部署且未发送真实飞书消息，外部卡片交互未执行 |

## 发现并修复的问题

- 初版把模型查询作为普通消息提交的硬前置；Runtime 模型列表暂时不可用时会提前阻断消息。已改为普通提交安全回落到已存配置或 Runtime 默认值，只有显式 `/model` 配置时才要求模型目录可用。
- 通道整链路测试夹具此前没有实现 Runtime Composer 模型目录，新增确定性模型能力，避免产品代码为测试绕过真实契约。

## 未解决问题与阻塞

- 真实飞书 `/model` 下拉卡、模型选择后的推理档位卡、成功反馈卡，以及下一条飞书消息的实际模型执行，需要部署后使用专用测试应用发送外部消息验证。

## 健康检查

- `pnpm verify`：PASS；服务端 133 条测试、前端 57 条测试、类型检查和生产构建全部通过。
- 浏览器 console error/warn：两个测试 Tab 均为空。
- 服务端异常日志：无。
- 刷新/重连后的最终状态：Realtime connected；同一 Demand、Conversation 和唯一终态回复均恢复。

## 清理

- 关闭两个测试浏览器 Tab，并停止本地 43215 测试服务。
- 将临时 SQLite、Workspace、Worktree 和测试 Git 仓库 `/tmp/codywork-feishu-model.EPo97S` 移入本机废纸篓，可恢复。
- 未修改或清理任何真实用户 Workspace、仓库、飞书配置或生产数据。
