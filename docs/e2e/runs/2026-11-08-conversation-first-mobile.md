# Conversation-first mobile iteration — 2026-11-08

## Scope

Branch `feat/responsive-workbench`, starting commit `e0e9af70`, existing draft PR #6. Working tree was clean before this iteration. This iteration is saved locally, not committed/pushed as part of this run.

Product direction: one shared Vue/Core conversation and data model, distinct presentation for mobile and desktop. Mobile has a single compact project/context/history strip; details and tools are opened on demand. Model/reasoning/collaboration/permission settings use Core's public controls slot for an accessible disclosure, retaining the current permission label while collapsed. Image attachment, errors, send and stop remain available. Desktop retains navigation + sessions + conversation columns, directly visible tools and all selectors, with more restrained spacing and readable content width. No Core fork or dependencies added.

## Verification environment

Mac mini, native Chrome UI through CUA. Production build served only at `http://127.0.0.1:43210`, using the previously isolated `/tmp/codywork-responsive.WB0efr` database and synthetic three-repository Demand. No real workspace, scheduled task, external sharing or permissions modified. Real iPhone/Safari/soft keyboard is for subsequent user testing, not claimed here.

## Browser evidence

- 390 × 844: transcript now occupies the space previously consumed by a second header and permanently visible selectors. Project, current context/details, history and notifications remain reachable in the top strip.
- Runtime settings expand to reveal collaboration, submission policy, model, reasoning and permission; closing returns to the compact composer. Current permission remains `Normal` in the collapsed control.
- Context drawer exposes the Demand title/path/link, runtime, code report, follow-up, share, toolbox, bind and new-session actions. Opening follow-up closes the native modal and reaches its settings page without trapping focus; no task was created.
- Found and fixed an existing history-navigation defect: returning from follow-up settings to the same Demand URL previously left settings visible because the Demand/session were already selected. Route restoration now reopens a Demand when the active page is not chat. Actual browser Back after follow-up restored the correct transcript and URL.
- History drawer displays the three existing synthetic sessions. Selecting the second session closes the drawer, restores the trigger focus and loads the selected session URL/history.
- Mobile `MOBILE FOCUS QA...` prompt: immediately rendered once, showed Thinking and stop control, completed with `FOCUS OK`, and remained exactly once after reload.
- Desktop 1280 × 844 and full-width window: all three columns, header tools, settings and conversation visible. `DESKTOP FOCUS QA...` immediately rendered once, showed running state and stop, completed with `DESKTOP OK`.
- A second Chrome tab opened the same full session URL and displayed both completed mobile/desktop turns in order. Original tab also retained both turns. No duplicated user/assistant entries observed.
- 360 × 844: no visible horizontal clipping of top navigation, message bubbles or composer. Project drawer exposes the full navigation; Escape returns focus to its trigger. Composer collapse and restore both work. These are emulated viewports, not real-device keyboard tests.
- Console reported 0 messages in the tested reload/run; DevTools Issues explicitly reported 0 page errors / 0 breaking changes, with existing form-field `id`/`name` improvement notices (counts grow across remounts). These notices were not presented as a zero-warning audit.

## Automated checks

Final `npx --offline pnpm@11.7.0 verify` exited 0. Server: 254 tests / 34 files. Web: 139 tests / 29 files. Type checks, service-network tests and production build passed. `git diff --check` passed. Log: `/tmp/codywork-conversation-first-final.log`.

One header source-contract assertion needed updating for the explicit drawer-close handler. Typecheck also caught an extra argument on a zero-argument toolbox handler; corrected before the final passing run. Vite's existing >500 kB bundle warning remains.

## Case coverage and limitations

E2E-001/004/007/008/011/016 have the targeted current-run evidence above, but are **not claimed as complete PASS** for the entire guide: password login, exhaustive stress/duplicate-submit states, browser-only transport fault injection, and every page/dialog remain uncovered. Follow-up navigation was tested, not task execution. New destructive Demand/cleanup, attachment upload, stop execution, all approval branches and external-channel flows were not rerun this iteration. Earlier reports contain additional coverage but do not substitute for a full new regression gate.

No merge, deployment, tunnel, LAN binding or security change. The local preview was left running for review; it is tool-managed, not a durable installed service, and the loopback URL is not reachable from a phone. Existing synthetic data was retained; prior denied cleanup was not bypassed.
