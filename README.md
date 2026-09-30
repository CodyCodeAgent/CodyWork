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

Every functional iteration must also complete the natural-language browser
regression flow in [`docs/e2e/README.md`](docs/e2e/README.md). The cases are
written so an AI test executor can run and report them end to end.

## Production

```bash
pnpm build
pnpm start -- --host 0.0.0.0 --port 3001
```

The built server is the single production process. It serves the API,
WebSocket endpoint, and the Vue SPA from `apps/workbench-web/dist`.

### Trae network configuration

`scripts/codywork-service.sh` keeps both `no_proxy` and `NO_PROXY` aligned
for the detached CodyWork process and its Trae ACP children. It always adds
the internal direct-route baseline required by Trae (`localhost`, ByteDance,
Trae, and Copilot internal domains), while preserving any operator-provided
rules.

When a development machine needs an outbound proxy, create the ignored,
owner-readable runtime file `.runtime/codywork.network.env`:

```ini
# Keep proxy addresses local; never commit this file.
http_proxy=http://proxy.example:port
https_proxy=http://proxy.example:port
# Optional extra direct-route hosts. The Trae baseline is added automatically.
no_proxy=.byted.org
```

The launcher reads this data-only file rather than sourcing it. Startup logs
only the number of effective direct-route rules; proxy addresses are not
printed.

## Architecture

- `apps/workbench-server`: SQLite-backed Workspace/Demand/Worktree policy API
  and a single Codex App Server host per CodyWork service.
- `apps/workbench-web`: Vue 3 UI for workspace management and the live
  conversation timeline.
- `@codycodeagent/cody-web-core`: framework-neutral Codex protocol, runtime,
  and conversation state primitives shared with CodyWeb.
