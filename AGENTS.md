# CodyWork Agent Instructions

## Product and architecture

- CodyWork is not released yet. Prefer a clean abstraction or a direct refactor over compatibility layers and local patches.
- Keep Workspace, Repository, Demand, Worktree, product navigation, and policy boundaries in CodyWork.
- Keep framework-neutral Codex protocol, runtime, event normalization, conversation reconciliation, composer, and reusable conversation presentation in `@codycodeagent/cody-web-core`.
- Native Codex Thread history is the durable source of truth for conversation messages. Do not add a second message cache or reconstruct ordering in the product UI.
- Preserve unrelated working-tree changes. Never clean, reset, or overwrite a user's repository to prepare a test fixture.

## Mandatory verification for every feature iteration

Every functional change must finish with automated checks **and** end-to-end functional verification. Unit tests, type checks, builds, API calls, or visual inspection alone do not replace E2E verification.

1. Read [the E2E guide](docs/e2e/README.md) and select all cases affected by the change.
2. Run `pnpm verify` before browser verification. Fix failures before continuing.
3. Start a production-like local CodyWork instance with an isolated temporary SQLite database and a disposable test Workspace. Use the deployed environment only when the task explicitly requires deployment verification.
4. Use a real browser through the available computer-use/browser automation capability. Exercise the feature through the UI as a user would. Do not claim an E2E case passed from API responses alone.
5. Always run the P0 smoke cases listed in the E2E guide. Run every additional case whose UI, API, persistence, Runtime, Core contract, or adjacent state can be affected.
6. Verify both the immediate transition and the state after refresh/reconnect. For asynchronous conversation behavior, inspect the page before the model response arrives and again after the terminal event.
7. Check browser console errors, server errors, duplicate UI elements, stale loading/running states, horizontal overflow, keyboard behavior, and persistence after reload.
8. Save a concise run report under `docs/e2e/runs/` using the supplied template. Include environment, revision, cases, result, evidence, defects found, fixes made, and cleanup.
9. Remove disposable Workspaces, Worktrees, temporary databases, uploaded images, and test processes. Never delete or reset a real user repository as cleanup.
10. In the final handoff, state exactly which E2E cases passed, which were blocked, and why. Do not say the feature is complete if required E2E coverage was skipped.

If a feature changes shared Core behavior, first add or update Core-level automated coverage, then verify the affected flow in CodyWork. If CodyWeb consumes the same behavior and its environment is available, also run the corresponding CodyWeb smoke flow; otherwise record that cross-product verification remains blocked rather than assuming it passed.

Documentation-only changes that cannot alter runtime behavior do not require browser execution. Test-case or verification-policy changes must still be reviewed for completeness and internal consistency.
## E2E safety rules

- Use synthetic prompts and disposable repositories whenever possible.
- Do not put real credentials, tokens, cookies, or personal data in test documents, screenshots, URLs, logs, or commits.
- Do not send external messages, approve production actions, modify production data, push branches, create tags, merge, or deploy unless the user explicitly requested that action.
- Destructive UI cases must use isolated fixtures and must assert the confirmation boundary before deletion.
- A blocked external model/network dependency is a valid `BLOCKED` result, not a pass. Capture the visible recovery behavior and preserve evidence.
