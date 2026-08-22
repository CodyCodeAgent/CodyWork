# CodyWork Codex Runtime

English | [中文](codywork-runtime.zh.md)

CodyWork supports only Codex App Server. The default command is `codex app-server --stdio` and can be overridden in the global **Codex Runtime** settings.

- CodyWork requires no API key and reuses the local Codex login.
- The connection test starts App Server and completes a real `initialize` handshake.
- Workspace initialization, demand conversations, Goal, Plan, approvals, tool events, diffs, and interrupts use the same Codex Adapter.
- CSR Policy restricts reads and writes to the current Workspace and demand Worktree; Yolo cannot widen access outside the Workspace.
- Missing Codex process or policy capabilities fail closed without a fake runtime.

Environment variables:

- `CODY_CODEX_COMMAND`
- `CODY_CODEX_MODEL`
- `CODY_CODEX_INIT_PROMPT`
- `CODYWORK_PORT`
- `CODYWORK_DB`
