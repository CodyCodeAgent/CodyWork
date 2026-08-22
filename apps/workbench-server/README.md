# CodyWork control plane

English | [中文](README.zh.md)

The current release focuses on Workspace management, Dashboard metrics, demand Worktrees, and demand-development conversations. The demand page is a CodyWork-owned three-column UI. The server streams Codex events over WebSocket and restores message history, Goal, Plan, approvals, permission modes, and multi-conversation metadata.

```text
apps/workbench-web/      Workspace creation, switching, and automatic restore UI
apps/workbench-server/   Workspace, Dashboard, repository, demand Worktree, and Runtime control plane
  ├─ src/services/workspace.ts      directory inspection, registration, and Git clone
  ├─ src/services/repositories.ts   baseline repository discovery and metrics
  ├─ src/services/demands.ts        multi-repository Worktrees, demand docs, and rollback
  ├─ src/runtime/                    protocol, policy, and Codex App Server Adapter
  ├─ src/services/conversations.ts  conversation metadata, persisted events, and WebSocket subscriptions
  ├─ src/db/index.ts                 CodyWork metadata
  └─ src/routes/index.ts             HTTP control plane
```

A Workspace is a real folder. After its directory is ready, CodyWork uses it as the Codex working directory. CodyWork performs deterministic control-plane operations; Codex owns the model loop and native tool execution.

## Run

```sh
cd apps/workbench-server
npx tsx src/index.ts

cd apps/workbench-web
npx vite --port 3211
```

The server listens on `http://127.0.0.1:3210`; the web app listens on `http://localhost:3211`.

## API

- `GET /api/workspaces`: list Workspaces by last-opened time
- `POST /api/workspaces`: inspect a local folder or clone Git, then register the Workspace; returns `action: adopted | initialize`
- `GET /api/workspaces/:id`: read a Workspace and its directory summary
- `POST /api/workspaces/:id/open`: mark a Workspace recently opened and return its summary
- `DELETE /api/workspaces/:id`: remove registration without deleting files
- `GET /api/workspaces/:id/dashboard`: read the five Dashboard metric groups
- `GET /api/workspaces/:id/repositories`: read baseline repositories under `services/`
- `GET /api/workspaces/:id/demands`: list demands and Worktree mappings
- `POST /api/workspaces/:id/demands`: create a multi-repository demand Worktree
- `GET /api/workspaces/:id/demands/:demandId`: read demand-development shell metadata
- `GET /api/workspaces/:id/demands/:demandId/conversations`: list conversations for a demand
- `POST /api/workspaces/:id/demands/:demandId/conversations`: create a recoverable conversation
- `GET /api/workspaces/:id/conversations/:conversationId/history`: read event history
- `POST /api/workspaces/:id/conversations/:conversationId/messages`: send a queued or steering message
- `POST /api/workspaces/:id/conversations/:conversationId/interrupt`: interrupt the active turn
- `POST /api/workspaces/:id/conversations/:conversationId/permission`: switch read-only, Workspace-write, or Yolo mode
- `ws://127.0.0.1:3210/api/workspaces/:workspaceId/conversations/:conversationId/events`: WebSocket event stream with `after` cursor recovery

Example creation request:

```json
{
  "source": {
    "type": "git",
    "url": "git@code.byted.org:life_service/basic_marketing_ai_hub.git",
    "destination": "/Users/you/projects/basic_marketing_ai_hub"
  }
}
```

Local folders are first inspected for the CSR core shape: `services/`, `docs/`, `specs/`, and `worktrees/`. A complete folder returns `adopted` and is not rebuilt. An empty folder returns `initialize` and is initialized by Codex. A non-empty incomplete folder is rejected to avoid overwriting existing content. The server does not manufacture a second Workspace scaffold.

The Runtime Adapter contract lives in `src/runtime/protocol.ts`. The product enables only the Codex App Server Adapter. The Policy Resolver permits writes only in declared Worktree roots and neither prompts nor Yolo can widen access outside the Workspace. Browsers use WebSocket for live events; the server talks to Codex over local stdio JSON-RPC.

## Global Codex Runtime settings

Runtime configuration is global and does not belong to one Workspace. The sidebar's **Codex Runtime** page can override the App Server command. CodyWork defaults to `codex app-server --stdio`, reuses the local Codex login, and stores no API key. Changing the configuration marks active conversations `disconnected`; new conversations use the new process.

Codex is integrated through real App Server Thread/Turn APIs. CodyWork maps the CSR instruction bundle to base and developer instructions, maps the demand directory to the working directory and Runtime roots, and forwards message deltas, tools, diffs, Goal, approvals, and interrupt events. If Codex cannot start or cannot enforce the required protocol and policy, conversation creation fails closed; no fake runtime is used.

Environment variables: `CODYWORK_PORT`, `CODYWORK_DB`, `CODY_CODEX_COMMAND`, `CODY_CODEX_MODEL`, and `CODY_CODEX_INIT_PROMPT`. Legacy `CODY_WORKBENCH_PORT` and `CODY_WORKBENCH_DB` remain only for compatibility with existing local data.
