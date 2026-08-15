# CSR Workbench（cody-workbench）

基于 DeepSeek Harness（dsh）的 CSR 工作台：把「CSR + TTADK + Codex + Worktree」的 AI 研发提效思想做成一个可视化 Web 工作台。

> 方案文档：[docs/csr-workbench-plan.md](../docs/csr-workbench-plan.md)

## 架构

```text
apps/workbench-web/      前端（React + Vite），四大模块：工作台/仓库/知识库/需求看板
apps/workbench-server/   服务端（Node.js），确定性操作层 + AI 生成层
  ├─ src/services/csr.ts     确定性操作：git clone / worktree / specs 模板 / docs
  ├─ src/services/ai.ts      AI 生成层：通过 dsh SDK 驱动 headless agent 写 SDD 文档
  ├─ src/db/index.ts         SQLite 元数据（workspaces/repos/demands）
  └─ src/routes/index.ts     HTTP 路由
```

**分工原则**（方案 v1.1）：

- **确定性操作**（初始化/加仓库/切 worktree/建 specs 目录/状态机）→ 服务端直做，不经 AI；
- **生成性操作**（写 spec/plan/tasks/代码/compound）→ dsh 引擎，人机确认制。

## 运行

### 1. 服务端

```sh
cd apps/workbench-server
# 无需 AI：直接启动
npx tsx src/index.ts

# 启用 AI 生成层：需要 DEEPSEEK_API_KEY
DEEPSEEK_API_KEY=sk-xxx npx tsx src/index.ts
```

服务端监听 `http://127.0.0.1:3210`。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `CODY_WORKBENCH_PORT` | `3210` | 服务端端口 |
| `CODY_WORKBENCH_DB` | `~/.cody-workbench/workbench.db` | SQLite 元数据路径 |
| `CODY_WORKBENCH_ROOT` | `~/cody-workbench-workspaces` | 工作台实例根目录 |
| `DEEPSEEK_API_KEY` | 无 | 配置后启用 AI 生成层 |
| `CODY_WORKBENCH_MODEL` | `deepseek-v4-flash` | AI 模型 |
| `CODY_WORKBENCH_CORDIS` | `examples/jsonrpc-agent/cordis.yml` | dsh 运行时配置 |

### 2. 前端

```sh
cd apps/workbench-web
npx vite --port 3211
```

前端监听 `http://localhost:3211`，通过 proxy 转发 `/api` 到服务端。

## API 概览

确定性操作：

- `POST /api/workspaces` 初始化工作台（生成 CSR 骨架 + clone 仓库）
- `GET /api/workspaces` 列出工作台实例
- `POST /api/workspaces/:id/repos` 添加仓库
- `GET /api/workspaces/:id/repos` 仓库状态列表
- `POST /api/workspaces/:id/demands` 新建需求（生成 specs/ 模板）
- `PUT /api/demands/:id/status` 需求状态机流转
- `POST /api/demands/:id/worktrees` 创建 worktree（跨仓库）
- `GET/PUT /api/workspaces/:id/docs/*` 知识库浏览/编辑

AI 生成层：

- `POST /api/demands/:id/sdd/:step` 生成 SDD 文档（spec/plan/tasks/review/test-report）

## 待办

- [ ] compound 知识回流（AI 扫描 → 更新 docs/ → 人确认）
- [ ] 排障检索（SQLite FTS5）+ troubleshoot preset
- [ ] AI 会话区（聊天界面 + 工具调用可视化 + 历史回放）
- [ ] 端到端验证 AI 生成层（需 DEEPSEEK_API_KEY）
