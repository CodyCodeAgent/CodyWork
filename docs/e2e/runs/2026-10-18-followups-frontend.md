# CodyWork E2E 回归记录：定时跟进前端

- 日期：2026-10-18
- 执行者：Codex frontend task
- 代码 revision：bb56c89 + working tree (concurrent backend changes present)
- Core 版本：v0.43.1
- 环境与 URL：local automated checks only; no browser server started
- 浏览器与视口：not run
- SQLite 数据库 / 测试 Workspace：no browser fixtures created

## 结论

Frontend implementation is available for integration. Latest pnpm verify passes. Required browser E2E has not been run by this frontend task; no browser passes claimed. No commit, deployment, or external notification performed.

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001, E2E-004, E2E-007, E2E-008, E2E-011, E2E-016 | NOT RUN | no isolated browser run performed | main integration browser pass still required |
| E2E-017, E2E-018 | NOT RUN | no isolated browser run performed | settings/navigation affected |
| Followup create/edit/actions/runs/refresh, conversation links, notification retry | NOT RUN | component tests only | component mocks are unit tests, not browser evidence |

## 发现并修复的问题

Frontend protects against late workspace/run responses, retains edits after failed saves, confirms cancellation, sends expectedRevision, and keeps run outcomes separate from delivery outcomes. Focused component tests cover these behaviors. No browser defects claimed.

Follow-up iteration: task status `needs_attention` is displayed as 待人工处理, is editable, and permits resume with expectedRevision. `failed` remains a run outcome, not a terminal task status. Source and optional background history anchors reuse workbenchUrl with workspace/conversation/demand context. Tests cover demand/workspace links, query encoding, stale navigation query removal, missing background history, and a transient failed run.

Notification retry iteration: added `retry-notification` and 重试通知（不重新检查） for the current completed run with failed/dead-letter delivery or a needs_attention task's interrupted notification with a recorded result. The endpoint receives expectedRevision; the UI never calls run-now for retry. Historical failures, paused/cancelled tasks, and interrupted executions do not expose retry. Tests use mocked API calls only, assert duplicate-click suppression, and verify delivery/revision refresh after admission. All 18 focused component tests pass; frontend typecheck passes. No actual notification sent.

Delivery-state correction: retry eligibility now recognizes actual outbox states `failed`, `dead_letter`, and `retry_wait` independently of run.status. Parameterized tests cover all three delivery states across completed/pending/failed/needs_attention results, active pending checks, expired task notifications, and nonretryable delivery states. Current-run matching, paused/cancelled protection, revision checks, and notification-only dispatch remain in place. No backend files edited. Latest pnpm verify passes: 221 server tests, 116 frontend tests (35 focused component tests), both typechecks, service-network checks, and both builds. Browser E2E remains NOT RUN in this frontend task.

## 未解决问题与阻塞

Earlier verification failed with `invalid current Codex sandbox policy`, then `scripts/codywork-service.sh: line 31: entries[@]: unbound variable`. Main fixed those issues. Latest delivery-state correction passes full pnpm verify (221 server tests, 116 frontend tests, typechecks, service-network checks, production builds). Required isolated browser E2E, including persistence after refresh and retry delivery without another execution, remains unperformed in this frontend task. No browser test passed in this task.

## 健康检查

- Frontend typecheck: passed.
- Frontend suite: 23 files / 116 tests passed, including 35 FollowupSettings tests. Latest Vite production build passed (existing large chunk warning).
- Browser console / server browser logs / refresh-reconnect: not inspected.
- Latest full verify: passed, including 221 server tests, 116 frontend tests, service-network checks, typechecks and both builds.

## 清理

No browser Workspace, Worktree, database, uploads, or long-running application process created. Existing user/backend files preserved.
