# 2026-09-05 Feishu channel regression

## Scope

- CodyWebCore Channel Runtime and Feishu provider contract.
- CodyWork Feishu adapter, durable SQLite state, browser cross-view, diagnostics and recovery.
- Dedicated production Feishu app against `http://10.37.222.12:3001`.
- Existing CodyWork Workspace, Demand, Conversation and native Codex Thread.
- Automated verification plus browser/Feishu end-to-end evidence.

## Release under test

- CodyWebCore: `v0.38.7` (`4c71aad`).
- CodyWork: `v0.2.2`, with Server and Web both pinned to Core `v0.38.7`.
- Browser: Safari/Chrome through computer-use automation.
- Persistence: production SQLite channel tables; transcript remains native Codex Thread state.
- Secrets: configured through the CodyWork credential flow and never copied into this report.

## Completed production evidence

| Case | Result | Evidence |
| --- | --- | --- |
| Existing-session binding | Pass | A private Feishu conversation was bound to the existing CodyWork Conversation and native Thread. |
| First-message preservation | Pass | The message held during binding was submitted after binding and appeared exactly once. |
| Private text and multi-round continuity | Pass | Multiple private-chat turns appeared in the same browser Conversation with matching order and no second transcript. |
| FIFO queue | Pass | Two messages submitted while a Turn was active retained FIFO order. |
| Browser-origin interactive bridge | Pass | `requestUserInput` and tool approval created Feishu cards; resolving in Feishu converged in the browser. |
| Feishu-origin interactive bridge | Pass | Requests triggered from Feishu appeared in the browser and browser resolution converged in Feishu. |
| Commands and failure recovery | Pass | `/status`, `/stop`, `/unbind`, rebind, stale-request expiration and explicit `/retry` were exercised. No failed message was silently replayed. |
| Restart recovery | Pass | Service restart recovered durable binding, Inbox/Outbox state and native Thread projection without restarting Codex App Server as a recovery mechanism. |
| Rich post and inbound image | Pass | A Feishu rich-post image was downloaded to the bound Demand's controlled attachment directory and processed successfully. |
| Inbound file | Pass | A test file was written only below `docs/.channel-attachments/` and the agent returned `CHANNEL_FILE_E2E_OK`. |
| Outbound local image | Pass | A controlled local raster image in assistant Markdown became one Feishu card plus one real image, without leaking the local path. |
| Rebind idempotency | Pass | Rebinding the same native session submitted the new first message once (`REBOUND_OK`) and did not replay old Inbox content. |
| Secret redaction | Pass | App Secret was absent from API responses, UI diagnostics, logs and this evidence file. |
| Long-connection recovery | Pass | Provider reconnect and CodyWork process restart recovered without browser WebSocket participation. |
| Group default deny | Pass | A structured bot mention from a non-allowlisted group reached the backend but was rejected before binding/submission; an unmentioned message was ignored. |
| Automated release gate | Pass | Typecheck passed; server 18 files / 112 tests and web 11 files / 41 tests passed; Core runtime `0.38.7` was verified; both production builds completed. |

## Pending action-time confirmation

The temporary topic group `CodyWork E2E Topic 20260905` exists and its chat ID has been identified. The following state-changing checks are intentionally pending fresh user confirmation at execution time:

1. Add the temporary group to the account allowlist and save production settings.
2. Send a new structured `@Cody Work` root message and verify exactly one `GROUP_MENTION_OK` response.
3. Reply inside the topic and verify the same topic-scoped binding and native Thread continuity.
4. Verify an unmentioned root message and a message mentioning only another recipient are ignored.
5. Remove the temporary allowlist entry and delete the temporary group, with cleanup confirmed separately.

## Release-gate assertions

- Cards expose an exact Workspace/Demand/Conversation deep link when `CODYWORK_PUBLIC_ORIGIN` is configured.
- Browser binding metadata masks the owner identity.
- Diagnostics persist reconnect count, next reconnect time and last disconnect details. Because the current Feishu SDK does not expose the raw WebSocket close code, the UI reports that limitation instead of inventing a value.
- Structured audit records include all available correlation identifiers without credential material.
- Full typecheck, server tests, web tests, Core-version verification and production builds must pass before tagging and deployment.

## Known pre-existing production residue

- One historical failed Inbox row and one historical dead-letter `update_card` from an obsolete SVG/card experiment remain visible for diagnosis.
- They are not part of the current regression and must not be retried, because replaying stale external delivery is unsafe.
