# CodyWork E2E 回归记录：全局读取与 Demand 写入边界

- 日期：2026-09-05
- 执行者：Codex
- 代码 revision：`e6f1e749e9ed` + 本轮未提交改动
- Core 版本：`0.38.7`
- 环境与 URL：本地 production build，`http://127.0.0.1:3322`
- 浏览器与视口：Google Chrome（Playwright Core），1440×1000
- SQLite 数据库：临时 `/tmp/codywork-global-read-e2e.qOYc0Y/workspace.db`
- 测试 Workspace：临时 `/tmp/codywork-global-read-e2e.qOYc0Y/workspace`

## 结论

自动化策略、会话、类型检查和生产构建通过。产品策略现明确区分读取与写入：所有会话均可读取任意用户和目录；Demand 会话只允许写入当前 Demand 的 Repo Worktree 与 `docs/`；Workspace 搜索会话禁止全部文件写入。

真实浏览器权限探针按用户要求中止，由用户在部署环境接手验证。因此 E2E-019 本轮为 `NOT RUN`，不将自动化结果冒充端到端通过。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-019 | NOT RUN | 已启动隔离服务、Chrome 和一次性 Demand；模型探针等待期间按用户要求停止 | 用户将在部署环境自行验证全局读取和 Demand 外写入拒绝 |

## 发现并修复的问题

- CodyWork 原策略把读取和写入绑定为同一个 Workspace 边界，导致已经出现在统一 Catalog 中的全局 Skill 可选择却无法读取依赖文件。
- `readableRoots: []` 现在明确表示全局可读；`writableRoots` 继续单独控制可写位置。
- Demand、Workspace 搜索、Workspace 初始化和 Skill 安装均使用同一语义；页面权限说明同步更新。

## 未解决问题与阻塞

- 按用户要求未完成真实浏览器权限探针；部署后由用户手动验证。

## 健康检查

- `pnpm verify`：PASS；服务端 127 项、前端 53 项，类型检查、Core 版本校验和生产构建通过。
- 定向策略与会话测试：PASS，25 项。
- 浏览器 console error/warn：测试中止，未形成终态结论。
- 服务端异常日志：中止前无未处理异常。
- 刷新/重连后的最终状态：未执行。

## 清理

- 已停止本地 3322 测试服务并关闭测试 Chrome。
- 一次性 Workspace、Git 仓库、Worktree、SQLite、脚本和截图已整体移入系统废纸篓 `/Users/bytedance/.Trash/codywork-global-read-e2e.qOYc0Y`，可恢复。
- 未修改或清理任何真实用户 Workspace、仓库、Demand、会话或凭证。
