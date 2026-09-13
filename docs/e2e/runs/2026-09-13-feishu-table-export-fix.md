# CodyWork E2E 回归记录：飞书会话表格导出修复

- 日期：2026-09-13
- 执行者：Codex
- 代码 revision：`dc94e6334346`
- Core 版本：`0.38.8`
- 环境：本地隔离 production build `http://127.0.0.1:43273/`；生产 `http://10.37.222.12:3001/`
- 浏览器：Codex In-app Browser，两个隔离标签页及一个生产标签页
- 隔离数据：`/tmp/codywork-feishu-table-e2e.xxuWMF`（结束后已移入废纸篓）

## 结论

飞书 Markdown 转换接口返回的表格只读字段实际位于 `table.property.merge_info`。旧实现删除了错误层级的 `table.merge_info`，并误删创建嵌套块必需的 `table.cells`，导致含 Markdown 表格的会话在写入阶段返回 `1770001 invalid param`。修复后只移除 `parent_id` 与 `table.property.merge_info`，保留单元格和父子关系。

生产环境使用报错的同一长会话完成真实导出：页面成功态显示 241 条用户与 AI 文字消息；机器人回读文档标题和 68,915 个正文字符成功，首 500 个块中包含 3 个 Table Block。刷新 CodyWork 后 Demand、Conversation 和分享入口恢复，浏览器无 error/warn。

## 用例结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| E2E-001 | PASS | 从空数据库通过 UI 登记一次性 Workspace；页面进入概览，服务重启后两个标签恢复连接。 |
| E2E-004 | PASS | 一次性 Demand URL 同时包含 workspace、demand、conversation；第二标签直接打开后恢复同一会话。 |
| E2E-007 | PASS | 通过 Composer 发送 `FEISHU_TABLE_FIX_P0`，页面出现唯一用户消息并收敛为 `CODEX_FIXTURE_OK`。 |
| E2E-008 | PASS | 完成后第二标签、服务重启和重连后，用户消息与 AI 回复均各一条且顺序不变。 |
| E2E-011 | PASS | 两个标签同时显示 `Realtime connected`；停服后都显示 connecting，恢复后都自动重连。 |
| E2E-016 | BLOCKED | 默认桌面视口、控制台和服务健康检查通过；生产长会话在 820px 临时视口下的 DOM 宽度读取超时，未把未完成的窄屏断言记为通过。 |
| E2E-020 | NOT RUN | 本轮修改文档发布器，不改变消息、绑定、卡片或外部通道；没有重新发送飞书消息。 |
| E2E-023 | PASS | 生产 UI 从原生会话创建飞书文档成功；实际消息数为 241，飞书 API 回读正文成功且确认 3 个表格块，失败审计已收敛为成功审计。 |

## 自动化与真实接口证据

- `pnpm verify`：PASS。服务端 24 个文件 / 146 项，前端 17 个文件 / 63 项；类型检查、Core 版本校验和前后端 production build 全部通过。
- 新增回归测试确认 `table.cells` 必须保留，`table.property.merge_info` 必须删除。
- 使用当前机器人创建一次性表格探针：转换、嵌套块写入、正文回读均返回成功，随后删除成功。
- 生产真实导出：文档 `TtfTdHbOfovDZrxY3F9cMgxhnuh`，审计事件 `conversation.document.shared` 成功，消息数 241。
- 部署后服务 revision `dc94e6334346`，健康接口返回 `ok`；生产页面刷新后恢复 `Realtime connected`。

## 清理与说明

- 一次性表格探针文档已删除；隔离本地服务和两个浏览器标签已关闭，临时目录已移入系统废纸篓。
- 生产导出的文档是用户要求修复并验证的目标会话快照，予以保留，不作为一次性测试数据删除。
- 未在报告、日志或提交中记录 App Secret、Cookie 或访问令牌。
