# CodyWork E2E 回归记录：Trae 可选运行时与飞书续卡

- 日期：2026-09-30
- 执行者：Codex
- 代码 revision：CodyWork `b50354b`（隔离分支 `fix/merge-followup`，含未提交修复）
- Core 版本：待发布 `0.43.0`；CodyWork 现有锁定依赖为 `0.42.0`
- 环境与 URL：临时 SQLite、`http://127.0.0.1:3211`
- 浏览器与视口：BLOCKED，开发机未提供 Chromium/Playwright
- SQLite 数据库：临时，已清理
- 测试 Workspace：未创建真实用户 Workspace

## 结论

服务级验证通过；浏览器 P0 用例不能在本机执行，不能以 HTTP 健康检查替代页面验收。没有发送飞书消息、没有使用真实飞书账号。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 页面启动、身份验证与 Workspace 恢复 | BLOCKED | 开发机没有 Chromium/Playwright | 未执行页面操作 |
| E2E-004 Demand URL 与刷新恢复 | BLOCKED | 同上 | 未执行页面操作 |
| E2E-007 用户消息收敛 | BLOCKED | 同上 | 单测覆盖事件归并，不等同浏览器验收 |
| E2E-008 回复顺序与去重 | BLOCKED | 同上 | 单测覆盖稳定续卡 outbox key |
| E2E-011 实时连接与多 Tab | BLOCKED | 同上 | 未执行浏览器 WebSocket 场景 |
| E2E-016 页面布局、控制台与服务端健康检查 | BLOCKED | `GET /api/health` 返回 `service=codywork,status=ok`；无浏览器 | 仅服务端健康检查通过 |
| E2E-020 飞书外部消息 | BLOCKED | 本轮未授权向真实飞书发送 | 单测验证 topic 续卡 `replyInThread=true` |

## 发现并修复的问题

1. 保存的默认 Runtime 仍为 Trae、但 Trae 未启用时，`getRuntime()` 把默认值误当成显式选择，导致无法回退 Codex。现改为只有调用方显式传入 Trae 才报“请选择已启用的 Runtime”。
2. Core 将超长回复分片后，CodyWork 过去只更新第 1 张卡，余下内容会丢失。现将后续分片用与根消息相同的回复路由发送，话题场景固定 `replyInThread=true`，并使用稳定的每页 outbox key 去重。
3. 早期 Trae ACP 仅持久化 `assistant.delta` 时，产品层曾自行重建结果。现由 CodyWebCore 的规范投影在终态缺少 `assistant.completed` 时保留规范 delta，已有终态回复不会被后到 delta 覆盖。

## 健康检查

- `CodyWebCore: pnpm test && pnpm typecheck && pnpm build`：通过（Core 305 tests，Vue 28 tests）。
- `CodyWork`：`pnpm verify` 的类型检查、Server 184 tests 与 Web 81 tests 通过；随后单独复跑 `pnpm run build`，生产构建通过。
- 隔离服务：启动后 `/api/health` 返回正常；`/api/runtimes` 读回默认 `codex`，`/api/runtime/test` 返回 Core 协议信息；未启动 Trae ACP 进程。
- 浏览器 console error/warn：BLOCKED，无可用浏览器。
- 服务端异常日志：临时实例启动、健康检查和关闭期间未见业务异常；Node SQLite experimental warning 不影响测试结论。

## 清理

已停止临时监听 `127.0.0.1:3211` 的 CodyWork 进程，并删除临时 SQLite 目录 `/data00/home/liaoqiang.lq/project/trae/tmp/codywork-e2e-EeC7x1`。未修改或清理任何真实用户 Workspace。
