# CodyWork 控制面

[English](README.md) | 中文

当前阶段聚焦 Workspace、Dashboard、需求 Worktree 和需求开发对话。需求页是 CodyWork 自研的三栏界面，服务端以 WebSocket 推送归一化 Codex 事件；原生 Codex Thread 是持久消息历史的唯一权威，CodyWork 只保存产品元数据和有界诊断。

```text
apps/workbench-web/      Workspace creation, switching, and automatic restore UI
apps/workbench-server/   Workspace, Dashboard, repository, demand Worktree, and Runtime control plane
  ├─ src/services/workspace.ts      directory inspection, registration, and Git clone
  ├─ src/services/repositories.ts   baseline repository discovery and metrics
  ├─ src/services/demands.ts        multi-repository Worktrees, demand docs, and rollback
  ├─ src/runtime/                    protocol, policy, and Codex App Server Adapter
  ├─ src/services/conversations.ts  native Thread bindings, product metadata, and WebSocket subscriptions
  ├─ src/db/index.ts                 CodyWork metadata
  └─ src/routes/index.ts             HTTP control plane
```

Workspace 是真实文件夹。目录准备完成后，CodyWork 会将该目录作为 Codex 的工作目录。CodyWork 负责确定性的控制面操作，Codex 负责模型循环和原生工具执行。

## 开发运行

```sh
cd apps/workbench-server
npx tsx src/index.ts

cd apps/workbench-web
npx vite --port 3211
```

服务端监听 `http://127.0.0.1:3210`，前端监听 `http://localhost:3211`。

## 生产运行

```sh
pnpm build
pnpm start -- --host 0.0.0.0 --port 3001
```

生产环境只启动一个服务进程，同时提供 API、WebSocket 和构建后的 Vue SPA。

## API

- `GET /api/workspaces`：按最近打开时间列出 Workspace
- `POST /api/workspaces`：检查本地文件夹或 Clone Git，并注册 Workspace；返回 `action: adopted | initialize`
- `GET /api/workspaces/:id`：读取 Workspace 和目录摘要
- `POST /api/workspaces/:id/open`：设为最近打开并返回摘要
- `DELETE /api/workspaces/:id`：移除注册，不删除磁盘文件
- `GET /api/workspaces/:id/dashboard`：读取五组 Dashboard 指标
- `GET /api/workspaces/:id/repositories`：读取 `services/` 下的基线 Repo
- `GET /api/workspaces/:id/demands`：读取需求与 Worktree 映射
- `POST /api/workspaces/:id/demands`：创建多 Repo 需求 Worktree
- `GET /api/workspaces/:id/demands/:demandId`：读取需求开发页壳子元数据
- `GET /api/workspaces/:id/demands/:demandId/conversations`：列出需求下的会话
- `POST /api/workspaces/:id/demands/:demandId/conversations`：创建可恢复会话
- `GET /api/workspaces/:id/conversations/:conversationId/history`：读取归一化原生 Thread 历史
- `POST /api/workspaces/:id/conversations/:conversationId/messages`：发送排队或引导消息
- `POST /api/workspaces/:id/conversations/:conversationId/interrupt`：中断当前 Turn
- `POST /api/workspaces/:id/conversations/:conversationId/permission`：切换只读、Workspace 写入或 Yolo 模式
- `ws://127.0.0.1:3210/api/workspaces/:workspaceId/conversations/:conversationId/events`：实时归一化事件流

创建请求示例：

```json
{
  "source": {
    "type": "git",
    "url": "git@code.byted.org:life_service/basic_marketing_ai_hub.git",
    "destination": "/Users/you/projects/basic_marketing_ai_hub"
  }
}
```

本地目录会先按 CSR 核心结构 `services/`、`docs/`、`specs/`、`worktrees/` 检查。完整目录返回 `adopted`，不会重建；空目录返回 `initialize`，交给 Codex 初始化；非空但不完整的目录会被拒绝，避免覆盖已有内容。服务端不会制造第二套 Workspace Scaffold。

Runtime Adapter 的实现约定见 `src/runtime/protocol.ts`。当前产品只启用 Codex App Server Adapter；Policy Resolver 只允许写入显式声明的 Worktree Root，Prompt 和 Yolo 都不能把权限扩大到 Workspace 外。浏览器通过 WebSocket 接收实时事件，服务端通过本机 stdio JSON-RPC 与 Codex 通信。

## 全局 Codex Runtime 设置

Runtime 配置全局生效，不隶属于某个 Workspace。侧栏的 **Codex Runtime** 页面可覆盖 App Server 启动命令。CodyWork 默认使用 `codex app-server --stdio`、复用本机 Codex 登录状态，并且不保存 API Key。配置变化后，运行中的会话会标记为 `disconnected`，新会话使用新进程。

Codex 通过真实 App Server Thread/Turn API 接入。CodyWork 将 CSR Instruction Bundle 映射为 Base/Developer Instructions，把需求目录映射为工作目录与 Runtime Roots，并转发消息增量、工具、Diff、Goal、审批和中断事件。如果 Codex 无法启动，或无法执行所需协议与策略，会话创建会失败关闭，不会使用 Fake Runtime。

可用环境变量：`CODYWORK_HOST`、`CODYWORK_PORT`、`CODYWORK_DB`、`CODYWORK_WEB_ROOT`、`CODYWORK_PUBLIC_ORIGIN`、`CODY_CODEX_COMMAND`、`CODY_CODEX_MODEL` 和 `CODY_CODEX_INIT_PROMPT`。
