# Trae 群协作兼容性调研（2026-11-15）

## 结论

Trae 有只读能力，但当前 CodyWork 的 Trae ACP 适配器尚未把它落实为逐轮执行权限，因此本版群协作仍限定 Codex。不能仅将 `session/request_permission` 全部拒绝，就宣称实现只读：代理自己的文件、命令和 MCP 工具不保证全部经过客户端审批。

## 实测与来源

- 在 CN 开发机只读检查 `traex --version` / `--help` / `acp serve --help`：版本 `0.207.1-alpha.9 (internal edition)`，启动参数接受 `--sandbox read-only` 与 `--ask-for-approval never`。
- 在临时目录启动独立 ACP 进程，进行 initialize / session/new，不提交模型 prompt。实际 backend 为 `legacy`；会话 `configOptions` 仅包含 `model`、`reasoning_effort`，没有沙箱/权限选项。没有根据网上其他版本的 `mode` 值硬编码映射。
- 用该版本 `app-server generate-json-schema` 在临时目录生成协议：`TurnStartParams` 有 `sandboxPolicy`、`approvalPolicy`；描述明确是 “this turn and subsequent turns”，所以不能当作执行一次后自动恢复。
- [Trae CLI 参数](https://docs.trae.cn/cli_command-line-parameters)列出了只读沙箱；[ACP 文档](https://docs.trae.cn/cli_agent-client-protocol)描述启动权限预设，没有承诺逐轮只读切换。
- 以上确认的是启动参数、握手、能力和协议结构；未执行真实模型的拒写测试，也没有证明所有 MCP 外部副作用都被沙箱覆盖。

## 接入方案

优先评估 Trae App Server 适配：沿用真实 native session，由 Core 承担通用传输、协议和事件规范化，Work 决定来源权限；每轮开始前显式传入有效 sandbox/approval，不依赖上一轮状态。协作只读、人工正常权限、队列及追加/引导必须隔离，不能在协作轮次中追加高权限请求。失败、取消、进程重启后都需重新确认权限。

App Server 当前被 CLI 标为 experimental，不能仅因协议形似 Codex 就直接替换命令。需验证 initialize、thread resume/read、history、turn、审批、停止、usage 等真实事件兼容，以及旧 ACP Session 是否能迁移；不兼容时保留原 ACP 会话，显式新建/绑定受支持的会话。

备用方案是独立只读 ACP 进程，启动时固定沙箱和审批策略；需使用明确支持的 fork/load 语义、独立执行记录，并验证原会话不被污染。仅修改全局启动命令会把正常人工开发也锁成只读，不采用。

放开 Trae 协作前的验收：临时仓库读取成功；文件编辑及 shell 写入均失败；危险 MCP 不可执行；协作后人工权限恢复；停止排队任务不执行；失败重连仍只读。由运行时能力决定是否开放，不依据名称猜测。

## 本轮边界

没有升级服务器 Trae、改全局配置、重启生产服务、提交模型任务或发送群消息。探测进程与临时目录已关闭/清理。Trae 的完整运行时适配和真实拒写验收仍待实现，本轮不把未经验证的 Trae 开放为群协作运行时。
