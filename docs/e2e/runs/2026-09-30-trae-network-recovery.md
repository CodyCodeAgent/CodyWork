# CodyWork E2E 回归记录：Trae 网络直连恢复

- 日期：2026-09-30
- 执行者：Codex
- 代码 revision：`1a1e396` + 本轮未提交的网络恢复改动
- Core 版本：0.42.0
- 环境与 URL：本机 3001 受认证保护的 CodyWork 服务；代码验证使用隔离工作树
- 浏览器与视口：BLOCKED（本执行环境没有可用的已登录浏览器自动化会话）
- SQLite 数据库：生产数据库只读检查；自动化测试使用临时数据库
- 测试 Workspace：自动化测试临时创建并清理

## 结论

代码侧已覆盖 Trae 的大小写 `NO_PROXY` 归一化和 ACP 将网络请求错误标准化为 `Internal error` 的提示恢复。运行时已将当前 3001 服务与其 Trae ACP 子进程切换到完整直连规则。真实页面最小消息需要由已登录用户在 Trae 会话中补发验证。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | BLOCKED | 3001 正在监听；未认证 HTTP 请求返回 403。 | 没有可用已登录浏览器，不能验证 Workspace 恢复。 |
| E2E-007 | BLOCKED | `runtime.spec.ts` 覆盖 Trae prompt 成功、失败与事件终态。 | 不能从浏览器观察消息发送到失败卡的过渡。 |
| E2E-008 | BLOCKED | 服务端 185 项、前端 81 项测试全部通过。 | 无页面刷新与视觉回归。 |
| E2E-010 | PASS | Trae fixture 覆盖 ACP 网络请求失败；失败事件包含 `trae_model_network_connection_failed`。 | 自动化 Runtime 协议回归。 |
| E2E-011 | BLOCKED | 3001 重启后监听正常，ACP 子进程继承 7 条 `NO_PROXY` 规则。 | 未验证真实浏览器重连。 |
| E2E-016 | BLOCKED | 生产构建完成；服务日志显示正常监听。 | 无浏览器 console / 布局检查。 |

## 发现并修复的问题

1. 脱离交互 shell 启动的 CodyWork 仅继承小写 `no_proxy`，没有 Trae CLI 所需的大写 `NO_PROXY` 内网直连规则。服务脚本现在合并已有规则与 7 条 Trae 基线，并把相同结果导出到大小写两个变量；脚本测试已纳入 `pnpm test`。
2. Trae ACP 会把底层 `Connection failed: error sending request` 收敛成 `Internal error`。Trae Runtime 现在将两种形式映射为可恢复的中文网络错误及稳定错误码，其他 ACP 错误保留原文。
3. 当前 3001 运行目录新增未跟踪、权限为 `0600` 的 `codywork.network.env`，其中仅保留既有代理值并加入完整 `NO_PROXY`；未写入仓库。

## 未解决问题与阻塞

- 需要已登录用户在页面选择 Trae 并发送一条最小消息，确认真实模型请求不再出现连接失败，并确认失败时页面展示中文网络恢复提示。
- 本轮代码在 `fix/merge-followup` 工作树，尚待合并与构建部署；当前 3001 已仅应用运行时网络配置。

## 健康检查

- `pnpm verify`：PASS（服务端 185 tests、前端 81 tests、类型检查、生产构建）。
- 浏览器 console error/warn：BLOCKED（无浏览器会话）。
- 服务端异常日志：重启后仅见正常监听日志。
- 刷新/重连后的最终状态：BLOCKED（无浏览器会话）。

## 清理

自动化测试创建的临时数据库与临时 Git 仓库由测试清理；未删除或重置任何真实 Workspace、Worktree、会话或仓库。
