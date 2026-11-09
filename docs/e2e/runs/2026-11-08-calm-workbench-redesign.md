# Calm workbench redesign — 2026-11-08

## Scope and references
Cloud checkout of `feat/responsive-workbench`, base `28308d020d757d40d8602b66f733f608e8b0a428`. Mac attachment failed; no Mac files or existing preview changed.

Reviewed Sites/software-engineering guidance and real design references:
- https://linear.app/now/behind-the-latest-design-refresh — lower navigation emphasis and consistent headers/actions.
- https://www.assistant-ui.com/elements/thread — conversation-first canvas, quiet composer and toolbars; opened in Chrome.
- https://ui.shadcn.com/blocks/sidebar — grouped navigation and responsive disclosure.

Kept Vue and existing conversation Core runtime, rather than introducing a React design system or rewriting state. Unified stroke icons, neutral graphite/mist palette, restrained blue, lower visual density. Desktop uses three columns and compact action menu; narrow layouts keep conversation first with project/history/detail drawers and collapsed runtime options. No dependency changes.

## Verification
- Frontend: 139 tests in 29 files passed.
- Production build passed, including TypeScript compilation; existing large-chunk warning remains.
- `git diff --check` passed.
- Full `pnpm verify` NOT passed: backend 249 passed, 5 failed (Unix socket EPERM in followup fixtures plus dashboard-cache freshness test). Retry with approved execution mode had same failures; no test weakened.
- Actual Chrome screenshots reviewed at approximately 1200 px desktop and 500 px narrow viewport by resizing native window. Fixed old dark Demand background, purple accents and spaced-apart desktop actions discovered in screenshot review.
- Narrow navigation/history drawers open; Escape closes and returns to conversation; runtime options expand; synthetic message returns `CODEX_FIXTURE_OK`; Normal-mode approval displays and Allow once completes as `APPROVED`.

## Explicit limits
Preview uses actual Node server/SQLite and deterministic repository Codex test fixture, NOT an authenticated production model. A synthetic workspace was inserted only into `/tmp/codywork-redesign-preview.db` after workspace creation hit the fixture's sandbox-policy expectation; workspace creation is NOT an E2E pass. Default YOLO prompts require fixture marker EXPECT_YOLO; this is test fixture behavior, not a changed application policy.

Pause/stop: running UI and stop control appeared, but fixture interrupt does not emit completion, so end-to-end stop is unverified. Refresh loses fixture-only history because fixture state persistence was not configured. Real-model persistence is unverified here.

Chrome organization policy blocks DevTools; respected restriction. No 390 px device emulation, real iPhone, soft keyboard, image upload, complex Demand, or live-runtime verification this round. Backend capability/security controls unchanged. No tunnels, deployment, merge, or push.
