# Agent Note: CodyWork ships Codex-first behind a runtime seam

Status: proposed

English | [中文](2026-08-22-codywork-codex-first-runtime.zh.md)

## Problem

Exposing several unfinished runtimes made CodyWork look configurable while producing different behavior, fake conversations, and provider-specific settings. The product needs one reliable vertical slice before it can promise runtime choice.

## Proposal

CodyWork ships Codex App Server as its only enabled runtime. The frontend has no provider selector, the server never falls back to a fake agent, Workspace initialization and Skill installation use Codex, and the database stores only Codex connection configuration. The existing `ConversationRuntimeAdapter` and normalized event model remain as an internal seam, not as a user-visible multi-provider feature.

## Enforcement boundary

CodyWork compiles CSR instructions and effective roots. Codex receives the bundle through base/developer instructions and receives the authority boundary through cwd, runtime roots, sandbox policy, writable roots, and approval policy. If the installed App Server cannot enforce the requested boundary, conversation creation fails. Yolo only removes approvals inside the demand roots.

## Compatibility

The SQLite migration preserves workspaces, demands, conversations, events, and the saved Codex command while deleting legacy provider credentials and selection fields. Legacy data-path environment variables remain accepted so an existing local installation opens the same Workspace registry.

## Acceptance criteria

- No CodyWork UI or production server path references another runtime.
- Runtime creation always produces a real `CodexRuntimeAdapter`.
- Connection testing performs a real App Server initialize handshake.
- Empty Workspace initialization is performed by Codex and revalidated by CodyWork.
- Skills are discovered from Codex project and user roots.
- Product surfaces consistently display the CodyWork brand.
- Codex adapter, policy, Workspace, demand, Skills, conversation, build, and browser flows pass.

## Reintroduction rule

Another runtime may be proposed only after it implements the protocol, normalized events, resume semantics, and exact-root enforcement with the same conformance evidence. Adding it does not automatically justify a provider selector.
