# CodyWork E2E 回归记录：多飞书机器人配置

- 日期：2026-09-05
- 执行者：Codex
- 代码 revision：`e6f1e749e9ed` + 本轮未提交工作区改动
- Core 版本：`0.38.7`
- 环境与 URL：本机 production build，`http://127.0.0.1:3321`
- 浏览器与视口：Playwright Core 驱动本机 Chrome，1440×1000、1440×900、1000×850、820×900；两个独立页面
- SQLite 数据库：临时 `/tmp/codywork-multibot-e2e.YVD3qZ/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-multibot-e2e.YVD3qZ/workspace`

## 结论

PASS。CodyWork 已从存储层的一机器人限制升级为真正的多机器人配置：设置页始终提供新建入口，新建草稿可取消，不同机器人独立保存、切换和删除，重复 App ID 会在落库前被明确拒绝，Secret 刷新后不回显。浏览器消息、刷新、多 Tab 和服务重连回归未受影响。本轮结果允许提交、推送和部署。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从专属 URL 恢复一次性 Workspace；设置页与会话页刷新后均恢复相同 Workspace，连接最终为 `Realtime connected`。 | 回环环境不要求密码。 |
| E2E-004 | PASS | 带 workspace、demand、conversation 的 URL 在刷新、第二 Tab 和服务重启后恢复到 `P0 Final` 会话。 | 原生 Thread 未重建。 |
| E2E-007 | PASS | 浏览器通过 composer 连续发送 `MULTIBOT P0 FIRST` 与 `MULTIBOT P0 SECOND`，两条用户消息和两条 fixture 回复均可见。 | 无额外 optimistic 消息。 |
| E2E-008 | PASS | 刷新前后均为 2 条用户消息、2 条 `CODEX_FIXTURE_OK`、2 个 Worked。 | 无重复终态、错序或 overlay 回流。 |
| E2E-011 | PASS | 两个 Tab 同时连接并看到相同两轮消息；隔离服务停止后页面进入重连，服务恢复后自动回到 connected。 | 重连后消息计数不变，Tab 未互踢。 |
| E2E-016 | PASS | 飞书设置页和会话页均正常渲染；820px 视口无水平溢出，无 Vite overlay。 | 最终浏览器 console 无 error/warn。 |
| E2E-020（配置生命周期） | PASS | 页面创建两个不同 App ID 的禁用机器人，切换配置、拒绝重复 App ID、取消新建草稿、刷新检查 Secret 空值，再删除第二个机器人；第一个机器人仍完整存在。 | 使用假凭证且保持禁用，没有连接外部飞书或修改正式配置。 |

## 发现并修复的问题

- 后端 `ChannelStore` 曾明确拒绝第二个机器人，导致 UI 即使暴露入口也无法完成创建。已移除单例限制，并保留账号级外键、Inbox、Outbox、绑定、诊断和 Runtime 隔离。
- 原设置页只有零机器人时才显示配置入口。现改为稳定的“机器人列表 + 当前配置”主从结构，并增加新建草稿、取消和机器人数量提示。
- SQLite 唯一约束原本只会返回底层写库错误。现保存前检查 App ID 冲突并提供可操作的中文提示。
- 页面缺少 favicon，Chrome 每次打开都会产生无业务影响的 404 console error。已增加内联 CodyWork 图标，使最终浏览器健康检查保持干净。

## 未解决问题与阻塞

- 本轮目标是“新增已有飞书应用配置”。CodyWeb 的扫码代建应用还依赖开放平台登录、应用创建、权限发布和身份确认整套流程，没有混入本次多账号改造。
- 完整外部飞书收发、授权卡和群聊绑定没有使用假账号重复执行；这些能力已有同日正式通道回归记录，本轮未改动其执行链路。

## 健康检查

- `pnpm verify`：PASS（服务端 127 项、前端 53 项，类型检查、Core 版本校验和生产构建通过）。
- 浏览器 console error/warn：负向重复 App ID 请求按预期产生一次 HTTP 400；退出该负向步骤并重新加载后为 0。
- 服务端异常日志：无未处理异常；只有 Node SQLite experimental warning。
- 刷新/重连后的最终状态：两个 Tab 均恢复 `Realtime connected`；消息数量、顺序和 Worked 数量保持不变。

## 清理

- 已关闭全部测试浏览器页面并停止 3321 端口的隔离 CodyWork 服务。
- 一次性 Workspace、Git 仓库、Worktree、SQLite、fixture runtime 状态和截图已整体移入系统废纸篓 `/Users/bytedance/.Trash/codywork-multibot-e2e.YVD3qZ`，可恢复。
- 未读取、修改或清理任何正式机器人凭证、正式数据库或真实用户 Workspace。
