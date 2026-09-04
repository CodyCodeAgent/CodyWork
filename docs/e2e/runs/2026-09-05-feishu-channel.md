# 2026-09-05 Feishu channel regression

## Scope

- Production build served by `@codywork/server` on an isolated loopback port.
- Isolated SQLite database and disposable Git repository/worktree.
- Chrome-driven UI verification for login, Workspace restore, repository discovery,
  Demand creation, realtime conversation, refresh recovery, and Feishu settings.
- Core and CodyWork automated verification suites.

## Environment

- CodyWebCore: `v0.38.1`
- CodyWork dependency: exact `v0.38.1` Git tag
- Browser: Chrome through computer-use automation
- Database: disposable SQLite fixture
- Authentication: local test password

No production credentials were used in the local phase. The disposable Feishu
account used a fake App ID and secret and was removed with the fixture.

## Results

| Case | Result | Evidence |
| --- | --- | --- |
| Login and route restoration | Pass | Password login succeeded; direct refresh restored Workspace, Demand, conversation, and settings routes. |
| Workspace and repository discovery | Pass | Disposable Workspace discovered the nested `sample-app` Git repository. |
| Repository search during Demand creation | Pass | Searching `sample` reduced the list to one match and preserved the selected repository. |
| Demand/worktree creation | Pass | Demand `Feishu channel E2E` and its isolated worktree were created from the selected repository. |
| Realtime connection | Pass | Conversation view reached `Realtime connected`; no HTTP polling was needed for connection state. |
| Optimistic user message | Pass | The user bubble appeared immediately with `正在发送…` before the assistant response. |
| Native Codex response | Pass | The same conversation completed with `本地 E2E 通过`. |
| Refresh convergence | Pass | Refresh restored exactly one user item, one assistant item, and one worked marker. |
| Feishu default-deny validation | Pass | Enabling without a user allowlist produced a clear blocking error. |
| Credential persistence and redaction | Pass | Disabled account persisted after refresh; the secret field was blank and no secret appeared in the response/UI. |
| Diagnostics surface | Pass | Binding, pending Inbox, failed Inbox, pending Outbox, and dead-letter counters rendered. |
| Full automated verification | Pass | Server/web typecheck, 29 test files / 130 tests, Core `v0.38.1` version check, and both production builds passed. Core itself passed 20 files / 233 tests before tagging. |

## Production acceptance still required

The deployed phase must use the dedicated real Feishu app to verify private chat,
group/topic policy, binding cards, multi-round continuity, browser/channel
cross-view, image/file delivery, approval/question bridging, stop/unbind/retry,
provider reconnect, and process-restart recovery. Record that evidence separately
after deployment; a local fake credential cannot prove Feishu transport behavior.
