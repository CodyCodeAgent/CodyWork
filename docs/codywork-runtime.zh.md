# CodyWork Codex Runtime

[English](codywork-runtime.md) | 中文

CodyWork 当前只支持 Codex App Server。默认命令是 `codex app-server --stdio`，可在全局 **Codex Runtime** 设置中覆盖。

- CodyWork 不需要 API Key，并复用本机 Codex 登录状态。
- 连接测试会启动 App Server 并完成真实 `initialize` 握手。
- Workspace 初始化、需求会话、Goal、Plan、审批、工具事件、Diff 和中断都走同一 Codex Adapter。
- CSR Policy 将读写范围固定到当前 Workspace 和需求 Worktree；Yolo 不能扩大到 Workspace 外。
- Codex 进程或策略能力不可用时失败关闭，不会使用 Fake Runtime。

可用环境变量：

- `CODY_CODEX_COMMAND`
- `CODY_CODEX_MODEL`
- `CODY_CODEX_INIT_PROMPT`
- `CODYWORK_PORT`
- `CODYWORK_DB`
