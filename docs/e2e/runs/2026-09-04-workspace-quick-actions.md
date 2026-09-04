# CodyWork E2E 回归记录：Workspace 快捷指令与新会话引导

- 日期：2026-09-04
- 执行者：Codex
- 代码 revision：`66e5f85`
- Core 版本：`0.37.31`
- 环境与 URL：本地隔离环境；正式环境 `http://10.37.222.12:3001/`
- 浏览器与视口：Safari 桌面端；本地浏览器覆盖桌面与约 820px 窄视口
- SQLite 数据库：本地临时数据库；正式环境只读验证
- 测试 Workspace：本地一次性 Workspace；正式环境 `AI Hub` 仅做导航与读取验证

## 结论

自动化验证全部通过；快捷指令的配置、SQLite 持久化、专属 URL 刷新恢复和响应式布局已在隔离环境验证，正式环境完成部署后的只读冒烟。未在真实 Workspace 中触发快捷指令或模拟多 Tab 消息发送，避免产生业务会话和模型任务；相应完整消息链路用例记录为未执行，不能计入本轮 E2E 通过率。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | Safari 刷新正式页面后保持登录，恢复 `AI Hub` Workspace；连接状态最终显示 `Realtime connected / Browser WebSocket connected` | 正式环境只读验证 |
| E2E-004 | PASS | 直接刷新带 `workspace` 与 `demand` 参数的 URL，恢复到“灵活返佣审批流调整”及其会话 | 正式环境只读验证 |
| E2E-007 | NOT RUN | 未向真实 Demand 发送合成消息 | 乐观消息与收敛行为由现有自动化测试覆盖，但不替代 E2E |
| E2E-008 | NOT RUN | 未向真实 Demand 发送合成消息 | 回复终态顺序与去重未在本轮浏览器流程重跑 |
| E2E-011 | NOT RUN | 单 Tab 下连接恢复正常 | 本轮未执行双 Tab 并发与重连流程 |
| E2E-016 | PASS | 本地桌面与窄视口验证设置总览、二级页面、表单和 Skill 多选无横向溢出；本地浏览器 console 无新增 error/warn；正式服务日志无未处理异常 | 正式 Safari 还验证了需求页和设置页主要控件可访问 |
| E2E-017 | NOT RUN | 本地隔离环境已验证创建、持久化、总览计数、Skill 选择、场景选择和二级 URL 刷新；正式环境验证设置入口及 424 个 Skill 正常加载 | 未执行空闲/运行中直接发送以及停用、删除全流程，因此不标记 PASS |
| E2E-018 | NOT RUN | 未移除一次性 Skill | 失效 Skill 行为由自动化测试覆盖 |

## 发现并修复的问题

- 窄视口下设置表单和 Skill 选择区域可能横向撑开；已调整响应式布局，并在约 820px 视口复核。
- 设置二级页面需要可刷新恢复；已将 `view=settings&settings=quick-actions` 纳入 URL 状态，Safari 直接刷新后仍停留在快捷指令页。

## 未解决问题与阻塞

- `E2E-007`、`E2E-008`、`E2E-011`、`E2E-017` 的完整消息发送部分和 `E2E-018` 本轮未执行。原因是部署验收使用真实 Workspace，未创建业务会话、模型任务或删除 Skill；后续应在完整的一次性 Workspace、Demand 和两个测试 Skill 中执行。

## 健康检查

- `pnpm verify`：PASS；server 16 files / 74 tests，web 10 files / 30 tests，typecheck、Core 版本检查和构建均通过。
- 浏览器 console error/warn：本地隔离环境无新增 error/warn；原生 Safari 自动化未提供正式页 console 读取能力。
- 服务端异常日志：正式服务最近日志未发现 `Unhandled`、`uncaught`、`EADDRINUSE`、`Error` 或 `FATAL`。
- 刷新/重连后的最终状态：Demand 与设置专属 URL 均恢复正确；页面显示 `Realtime connected / Browser WebSocket connected`。

## 清理

本地一次性 SQLite 数据库、预览服务和浏览器测试页已清理。正式 Workspace 仅进行读取、导航和刷新，没有修改或清理真实用户仓库，也没有创建快捷指令或发送模型任务。
