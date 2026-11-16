# Collaboration card transport fix — 2026-11-15

## Scope and environment

CodyWebCore base `df28a255`, CodyWork base `785c1b64`, branch `codex/collaboration-wire-fix`; Core 0.45.0 with the committed pnpm patch. Existing Fast and beforeStart guards are retained. Target branch: **main**.

Local production web/server build at `http://127.0.0.1:43475`, disposable SQLite and Git worktrees. Deterministic test Runtime and Feishu provider, real browser, real Work command gateway/projection/outbox. This verifies product flow, not actual model behavior. Synthetic accounts/identities only. No external app secrets in fixtures or this report.

## Root cause and fix

Actual Feishu peer card delivery removed callback `value.codywork_collaboration` and supplied `custom_action_id` instead. Both bots therefore remained waiting for peers, despite successful outbound delivery.

Core now encodes bounded, validated events as UTF-8/base64url text envelopes and decodes both card bodies and flattened message-detail link elements. Ambiguous/malformed envelopes are rejected. Work emits a normal Markdown “协作状态” link with the envelope in its fragment; no peer URL is fetched. Host sender, participant slot, topic, batch and authorization checks remain required. Original callback payloads remain readable when present. No public origin falls back to the same text envelope.

## Automated verification

- Core: `pnpm test` **362 passed** (329 core + 33 Vue), `pnpm build` passed.
- Work: `pnpm verify` passed: **280 server + 200 web tests**, network script, typecheck and production builds.
- After updating pipeline fixtures to real flattened/link shapes: targeted collaboration/pipeline suite **17 passed**.
- New coverage includes join/reply/done/stop, UTF-8, stripped callbacks, flattened message details, two independent hosts, two rounds, spoofed sender rejection, duplicate delivery/restart recovery and stop propagation.
- Work's patch was rebuilt with its previous Fast/queue-guard changes intact; lockfile frozen to the new patch hash.

## Browser verification

| Case | Result | Observation |
|---|---|---|
| E2E-001 | PASS (fixture) | Wrong password rejected; correct password restored Workspace. |
| E2E-004 | PASS (fixture) | Demand + existing conversation URL retained after reload. |
| E2E-007 | PASS (fixture) | Submitted message immediately appeared with “正在发送…” before delayed response. |
| E2E-008 | PASS for messages (fixture) | User then assistant response, Worked terminal state, no duplicate user/assistant after refresh. Test adapter emits separate tool IDs; native tool reconciliation was not revalidated here. |
| E2E-011 | PASS (fixture) | Two browser tabs read same conversation; message from second tab persisted after reload. |
| E2E-016 | PASS desktop; narrow viewport NOT RUN | 1280px page had no horizontal overflow; both tabs reported zero warn/error console entries. Server log had no application errors. |
| E2E-028 | PARTIAL / external BLOCKED | UI enabled saved group config, showed waiting participant then “达成一致”, both participants’ done judgments, and retained state after refresh. Browser stop was attempted after rapid fixture completion; active-stop coverage is automated only. Full cross-host real bot exchange awaits the other maintainer's update. |
| E2E-019 | PARTIAL | Login rejection checked; sender/slot/topic/batch and read-only boundary regression automated. Other security scenarios not repeated in browser. |
| E2E-020 | PARTIAL / external BLOCKED | Authorized real-group transport probes verified callback loss and normal Markdown link preservation. Private chat/attachments/interactive approval/unbind/full two-bot discussion not repeated live in this fix iteration. |

Screenshot: local `/tmp/cody-wire-evidence/collaboration-completed.png` (synthetic data only).

## Actual provider transport evidence

Under explicit authorization, a few clearly labeled transport-only cards were sent in the original discussion topic, without mentioning bots or invoking business/model actions. V2 collapsible content was not preserved in the tested message-detail response; rejected that approach. A legacy Markdown note link preserved an encoded envelope of **12,862 characters** exactly, including Chinese payload. A final probe used the actual built Core serializer/parser and a valid synthetic decision envelope: **10,286 characters**, send/read both returned code 0, parsed event exactly matched the source. These are transport checks; they do not prove an unupdated remote bot can decode the new protocol.

## Rollout and limitations

Deploy user's CN instance from merged main; other bot maintainer must update both sender and receiver to this protocol. After both sides update, explicitly start a new discussion batch (for example `/协作重开` while mentioning both bots). Already-sent stripped cards cannot recover missing payload by themselves. Existing discussions/data are not replayed or reset during deployment.

CodyWeb cross-product live verification is BLOCKED: no configured isolated remote-channel environment for this feature. Core contract tests cover reusable changes.

## Cleanup

Temporary browser tabs closed. Disposable local server stopped; both temporary fixture roots, SQLite databases, worktrees and local harness files removed after verification. Production transport test cards remain as labeled audit evidence; no real bindings, allowlists or business conversations changed for tests.


## Deployment — 2026-11-16

- Core [PR #11](https://github.com/CodyCodeAgent/CodyWebCore/pull/11) merged into main: `a9ed604cf582c35c1b9c77c0f369c2837961eac1`.
- Work [PR #17](https://github.com/CodyCodeAgent/CodyWork/pull/17) merged into main: `5043d8bf5366efddf809befdef9b92daa629125e` (deployed functional build).
- CN production staged on the target server with frozen offline install, typecheck, 17 targeted tests and production build; all passed. Cutover observed zero active/awaiting-approval conversations.
- Existing main fast-forwarded from `785c1b64`, SQLite online backup plus environment/dependencies/dist backups retained in restricted deployment directory `.runtime/deployments/collaboration-wire-5043d8bf5366/`. No historical discussion was replayed.
- systemd `codywork.service` active/running, PID 3001064, started 2026-11-16 10:31:45 CST. `/api/health` returned ok. Bot reconnected at 10:32:55 CST with empty last_error.
- SQLite quick_check=ok; Workspaces 4, Demands 46, Conversations 116, channel accounts 1, bindings 14 and collaboration sessions 1 unchanged across cutover. Service environment bytes unchanged. Live web index and collaboration server module exactly matched staged build. Working tree clean on main.
- Other bot is maintained externally; no claim of completed real two-bot acceptance until that maintainer updates. User requested this one-sided deployment now.

![Isolated saved group configuration](assets/2026-11-15-collaboration-wire-settings.png)
