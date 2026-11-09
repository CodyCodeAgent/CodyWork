# Responsive workbench: second verification round (2026-11-08)

## Scope and environment

Mac mini checkout `CodyWork`, branch `feat/responsive-workbench`, base `5dfd91ac1fedc469d0f237c73086b9e64f369d12`. Changes remain uncommitted. No push, public deployment, tunnel, LAN binding, or security-setting changes.

Test data is isolated in `/tmp/codywork-responsive.WB0efr`: its SQLite database, workspace, three local synthetic Git repositories (`alpha`, `beta`, `gamma`) and their Demand worktrees. Existing user workspaces were not used. Test data is retained; earlier denied cleanup was not retried or bypassed.

## Fixes

- Native history: a just-created, locally owned session may return exactly `list_turns is not supported yet` before its first turn. Track that narrow pending-history state and return an empty snapshot only in that state. Clear it on submission, a turn event, or nonempty history. Generic failures and resumed sessions are not silently converted into empty histories. Added four boundary tests. One actually resumed empty test session also returned HTTP 200 in this run; the fallback deliberately does not assume all resumed sessions are empty.
- Favicon: added same-origin SVG and real ICO resources and explicit index links, including three resource tests. Both requests return HTTP 200.
- Mobile toolbar: grouped existing chat actions inside a native disclosure menu on compact screens, avoiding a wrapped multi-row toolbar consuming the transcript. Desktop actions remain directly visible. No actions were removed.

## Actual browser coverage

Native Chrome UI automation, with real local backend and Codex runtime, not mocked browser responses:

1. Workspace discovery found all three synthetic repositories.
2. Demand creation selected alpha and beta. Searching for alpha retained both selections; clearing search restored the full list. Creation produced isolated branches named `responsive-qa-demand` in both repositories.
3. Add-existing-repository flow offered gamma only. A no-result search showed zero matches and disabled submission; clearing search restored gamma. Adding it updated the sidebar to alpha/beta/gamma and created its isolated branch. All three worktrees were checked clean.
4. Tab A submitted a read-only `pwd` task. Tab B opened the same Demand/session URL, displayed the real approval, and allowed it once. Tab A received the completed command and `QA ONE DONE`.
5. Two subsequent rounds requested the identical answer `SAME`. Both distinct turns remained after reload, in the correct sequence.
6. Stopping our idle test server showed reconnecting UI. Restarting restored real-time connectivity and history in both tabs. A fourth prompt sent from Tab B returned `FOUR DONE`; refresh retained all four rounds, the completed first tool call, and both `SAME` answers without duplicate turn copies.
7. A fresh session created through the UI returned HTTP 200 with an empty native snapshot. After clearing the old console and reloading the final build, there were no console messages and no repeated history/favicon errors in the tested flow.
8. At an emulated 390 × 844 viewport, Enter inserted a newline rather than submitting; Control+Enter submitted the two-line prompt. The real `pwd` approval was reachable, and rejection completed without repeated approval. The assistant ended with `MOBILE DONE.` No file modification or network action was requested.
9. Final mobile toolbar disclosure expanded to expose Runtime, code report, follow-up, share, toolbox, bind, and new-session actions, then closed successfully. Screenshot showed the menu within the viewport without horizontal clipping. Desktop reload showed the actions directly visible and the four-round transcript intact.

The first-round report covers responsive navigation/session drawers, Escape/focus return, selection closure, and 390/768/1280 viewport checks: `2026-11-08-responsive-workbench.md`.

## Automated checks

Final command: `npx --offline pnpm@11.7.0 verify`, exit 0.

- Typecheck: pass.
- Server: 254 tests in 34 files, pass.
- Web: 138 tests in 29 files, pass.
- Network service script tests: pass.
- Production build: pass.
- Existing Vite >500 kB chunk warning remains (including Mermaid); not a build failure.
- `git diff --check`: pass.

Log: `/tmp/codywork-round2-final-verify.log`.

## Preview service and limitations

At the end of verification, the preview was a tool-managed foreground PTY listening only on `127.0.0.1:43210`. Independent checks after browser validation confirmed HTTP 200. It serves the isolated test database. Keep the session alive for the local preview. A detached service-script attempt did not survive the execution environment, so this is **not** a durable installed background service.

`http://127.0.0.1:43210` works on this Mac; it is **not** an iPhone-reachable address. No LAN or public exposure was configured. Service lifetime beyond this managed session/computer wake state is not guaranteed.

Not claimed as tested: real iPhone/Safari/soft-keyboard behavior, complete password-auth flows, every destructive or dirty-worktree Demand branch, every upload/share/scheduling action, every upstream-runtime failure, or exhaustive browser-only WebSocket fault injection. This is targeted integration coverage rather than an assertion that every repository E2E guide case passed. Native history remains the source of truth, not a new web-side message replica.
