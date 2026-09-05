# 2026-09-05 Feishu channel regression

## Scope

- CodyWebCore Channel Runtime and Feishu provider contract.
- CodyWork Feishu adapter, durable SQLite state, browser cross-view, diagnostics and recovery.
- Dedicated production Feishu app against `http://10.37.222.12:3001`.
- Existing CodyWork Workspace, Demand, Conversation and native Codex Thread.
- Automated verification plus browser/Feishu end-to-end evidence.

## Release under test

- CodyWebCore: `v0.38.7` (`4c71aad`).
- CodyWork: `v0.2.4`, with Server and Web both pinned to Core `v0.38.7`.
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
| Allowlisted topic binding | Pass | A structured `@Cody Work PING` root message in the temporary topic group opened the binding card; selecting `AI Hub` / `钱效相关问题查询` / `飞书会话` preserved the first message and produced exactly one `PONG`. |
| Topic continuity | Pass | A second structured mention in the same topic reused the same topic conversation key, binding and native Thread, then produced exactly one `TOPICCONTINUITYOK`. |
| Unmentioned group message | Pass | Marker `[E2E-GROUP-UNMENTIONED-AFTER-ALLOW]` produced no bot reply and zero Inbox rows after the group was allowlisted. |
| Browser cross-view order | Pass | The production CodyWork Conversation showed the two user messages and two assistant replies in order, with no duplicated transcript or terminal overlay. |
| Automated release gate | Pass | Typecheck passed; server 18 files / 112 tests and web 11 files / 42 tests passed; Core runtime `0.38.7` was verified; both production builds completed. |

## Production topic evidence

The temporary topic group `CodyWork E2E Topic 20260905` was added to the production allowlist for this authorized test.

- Root and follow-up Inbox records completed with distinct Turn IDs and the same topic-scoped binding, conversation key and native Thread.
- Every new outbound delivery reached `sent` in one attempt; no new pending, retry or dead-letter row was created.
- The account remained `connected`, with zero reconnect attempts and no last error after the test.
- The production Conversation deep link showed `飞书已绑定 · 话题` and a healthy long connection.
- Full owner identifiers, credentials and message IDs are intentionally omitted from this durable report.

## Cleanup requiring separate confirmation

The test group remains allowlisted and available so evidence is not destroyed during verification. Removing the allowlist entry, deleting the temporary Feishu group, or unbinding its topic binding changes production access/state and must only happen after explicit cleanup confirmation.

## Release-gate assertions

- Cards expose an exact Workspace/Demand/Conversation deep link when `CODYWORK_PUBLIC_ORIGIN` is configured.
- Browser binding metadata masks the owner identity.
- Diagnostics persist reconnect count, next reconnect time and last disconnect details. Because the current Feishu SDK does not expose the raw WebSocket close code, the UI reports that limitation instead of inventing a value.
- Structured audit records include all available correlation identifiers without credential material.
- Full typecheck, server tests, web tests, Core-version verification and production builds must pass before tagging and deployment.

## Known pre-existing production residue

- One historical failed Inbox row and one historical dead-letter `update_card` from an obsolete SVG/card experiment remain visible for diagnosis.
- They are not part of the current regression and must not be retried, because replaying stale external delivery is unsafe.
