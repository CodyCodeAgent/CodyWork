# CodyWork E2E 回归记录：Trae ACP Runtime

- 日期：2026-09-28
- 执行者：TraeCode
- 代码 revision：`c9b133c96fdf9a0761dfd027ce65c3d38a2fd70b` + 本分支未提交变更
- Core 版本：Cody Web Core `v0.40.0`
- 环境与 URL：隔离 worktree；本地服务已重启于 `http://10.37.113.220:3002`（密码保护）
- 浏览器与视口：BLOCKED（当前会话未提供浏览器控制能力）
- SQLite 数据库：自动化测试使用内存库/一次性临时库
- 测试 Workspace：`mkdtemp` 创建的一次性目录，已由测试清理

## 结论

服务端 ACP adapter、provider 持久化迁移、运行时注册表和 Web 生产构建均通过。Trae fixture 覆盖了两条并发会话、模型配置、事件流、授权响应、会话加载入口与独立进程边界。已认证地验证重启后的本地服务，默认 Trae 的 `/api/runtime/test` 完成真实 ACP initialize 握手。由于本机 TraeCLI 没有配置有效模型（`traecli doctor` 报告无 effective model），且没有浏览器能力，真实 Trae 模型 Turn 与浏览器 P0 回归仍为 BLOCKED；不得将本记录视为发布 E2E 通过。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | BLOCKED | 无浏览器能力；`pnpm --filter @codywork/web build` 成功。 | 未进行页面启动/恢复观察。 |
| E2E-004 | BLOCKED | 无浏览器能力。 | 未进行专属 URL 刷新验证。 |
| E2E-007 | BLOCKED | `tests/runtime.spec.ts` 的 Trae ACP fixture 断言 user、tool、assistant、terminal 事件。 | 不是浏览器可观察证据。 |
| E2E-008 | BLOCKED | 同上，adapter 单测验证单回合事件收敛。 | 未进行刷新后的真实原生历史验证。 |
| E2E-010 | BLOCKED | fixture 提供 cancel 协议路径；本轮未进行浏览器停止操作。 | 真实 Trae 模型不可用。 |
| E2E-011 | BLOCKED | 无浏览器能力。 | 未验证多 Tab。 |
| E2E-012 | BLOCKED | 单测确保每个会话独立 ACP 进程，未在浏览器中注入上游流故障。 | 不会把连接问题自动重启为新会话。 |
| E2E-016 | BLOCKED | Web production build 成功。 | 未检查真实视口、console 和服务端日志。 |
| E2E-017 | BLOCKED | Web build 包含 Runtime 选择器；未做浏览器表单操作。 | 设置页需人工浏览器复核。 |
| Runtime API probe | PASS | 已认证调用重启服务的 `/api/runtime/test` 返回 HTTP 200、`traecli-acp`、协议 `1.0`。 | 此项只证明 ACP initialize；不代表模型可执行 Turn。 |

## 发现并修复的问题

1. ACP fixture 的每进程 session 计数会生成重复 native id，不能覆盖 Trae 单进程单 session 的并发隔离。改为在 session id 中加入进程 PID，随后两会话并发测试通过。
2. 初版 Runtime 设置迁移只保留 Codex command。扩展为 `runtime_type`、`codex_command`、`trae_command`，并以历史数据库测试验证原 Codex 配置保持默认选中。
3. Workspace setup 原先固定构造 Codex runtime。改为复用当前 ConversationService 的已选 Runtime，避免 Trae 设置只影响普通会话而不影响初始化流程。
4. 默认 Runtime 以前只写入设置，不会替换 singleton ConversationService；且 native id 未记录 provider。现已持久化 `runtime_type`、以 `(runtime_type, native_id)` 唯一，并使历史会话恢复、发送、重命名、停止均按其 provider 路由。
5. Composer、飞书模型选择和代码上报入口以前会把 Codex 能力套到 Trae。现由 Runtime capability 元数据控制：Trae 未声明的推理档位、结构化 Skill、Plan/引导、原生会话绑定和 Codex Hook 代码上报不会显示或接受。

## 未解决问题与阻塞

- 本机 `traecli` 版本 `0.120.52`，但未配置有效模型；真实 ACP prompt 返回模型配置错误，无法验证真实模型、工具、权限与 session/load 回放。
- 当前会话没有浏览器自动化能力，所有必须由真实浏览器判定的 P0 用例保持 BLOCKED。
- 本机 `traecli doctor` 仍报告没有 effective model；ACP 初始化已验证，但真实模型、工具、权限与 session/load 回放需要配置模型后复测。

## 五轮自审

| 轮次 | 重点 | 发现与处理 | 结论 |
| --- | --- | --- | --- |
| 1 | ACP 生命周期与并发 | 确认 Trae ACP 单进程单 session；改为每个 CodyWork 会话独立 child process。 | PASS |
| 2 | Native id 与恢复 | fixture 在不同 child process 中产生重复 id；加入 PID，验证并发 native id 区分。 | PASS |
| 3 | 设置与迁移兼容 | 旧表只含 Codex command；增加无损迁移、默认 `codex` 以及双命令保存。 | PASS |
| 4 | 权限语义 | 初版仅保存 mode；将 YOLO/只读映射为 ACP permission option 的自动 allow/reject，并补回归测试。 | PASS |
| 5 | UI、构建、回归边界 | Runtime 选择器生产构建通过；执行 `git diff --check` 与定向 20 tests。完整 `pnpm verify` 被环境 Git 版本阻塞。 | PASS（环境阻塞项已记录） |

## 健康检查

- `pnpm --filter @codywork/server build`：PASS。
- `pnpm --filter @codywork/web build`：PASS。
- `pnpm --filter @codywork/server exec vitest run --testTimeout=20000`：PASS，162 tests。
- `pnpm --filter @codywork/server build`：PASS。
- `pnpm --filter @codywork/web build`：PASS。
- `git diff --check`：PASS。
- 本地服务健康检查、密码认证和 Trae ACP 初始化探针：PASS。
- 浏览器 console error/warn：BLOCKED。
- 服务端异常日志：BLOCKED（未启动服务）。
- 刷新/重连后的最终状态：BLOCKED。

## 清理

自动化测试创建的一次性临时目录由测试清理；未修改或清理任何真实 Workspace、基线仓库或 Demand Worktree。
