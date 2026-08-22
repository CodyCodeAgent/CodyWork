# CodyWork

CodyWork is a Vue-based development workbench for policy-bound Codex App
Server conversations. It keeps the Workspace → Demand → Worktree flow, while
the chat runtime, protocol compatibility, and conversation reconciliation are
provided by `@codycodeagent/cody-web-core`.

## Development

```bash
pnpm install
pnpm dev
```

The server listens on `127.0.0.1:3210`; the Vue application is served from
`127.0.0.1:3211`.

```bash
pnpm verify
```

## Architecture

- `apps/workbench-server`: SQLite-backed Workspace/Demand/Worktree policy API
  and a single Codex App Server host per CodyWork service.
- `apps/workbench-web`: Vue 3 UI for workspace management and the live
  conversation timeline.
- `@codycodeagent/cody-web-core`: framework-neutral Codex protocol, runtime,
  and conversation state primitives shared with CodyWeb.
