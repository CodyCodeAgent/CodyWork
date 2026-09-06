# Conversation and channel architecture

## Goal

CodyWork has one native Codex Thread per product conversation. The browser and
Feishu are independent ways to submit commands to, and present events from,
that Thread. Neither transport owns execution state and neither may maintain a
second transcript.

## Ownership

| Concern | Owner |
| --- | --- |
| Workspace, Demand, Worktree and write ceilings | CodyWork |
| Native Thread, Turn queue, event normalization and terminal state | Cody Web Core |
| Browser WebSocket lifecycle | browser adapter |
| Feishu connection lifecycle | Feishu provider adapter |
| Feishu Inbox, binding, card projection and durable Outbox | CodyWork channel host using Core contracts |
| Conversation transcript | native Codex Thread only |

## Command path

Every source submits a `ConversationCommand` to `ConversationCommandGateway`.
Stop, approval and question responses use the same gateway as origin-aware
`ConversationAction` values. Commands and actions always carry their origin;
no adapter may call Runtime directly.

```text
Browser command ─┐
                 ├─> ConversationCommandGateway ─> Core SessionManager ─> native Turn
Feishu Inbox  ───┘
```

The conversation's stored permission is the browser/default profile for future
commands. A Feishu binding has an independent default. Applying either profile
to a Turn must never mutate the other source or the conversation's scope.
Workspace search is an immutable read-only ceiling; Demand commands may choose
Normal or YOLO only inside the Demand Worktree's fixed writable roots.

`ConversationService` is the application facade. Product metadata and audit
are isolated in `ConversationRepository`; immutable Workspace/Demand scope
resolution is isolated in `ConversationContextResolver`. Neither repository
stores native transcript events.

## Event path

The Runtime owner emits one normalized event stream. `ConversationEventHub`
fans that stream out without reducing it. Browser serialization converts local
image paths to authenticated URLs only at the browser boundary.

`ConversationProjectionHost` is the only server-side reducer used by channel
presentations. It joins a Core history snapshot with live events using the
owner watermark, then exposes one state per conversation. Channel cards are
derived views of that state; they are not message history.

```text
Core owner events ─> ConversationEventHub ─┬─> browser adapter
                                           └─> ProjectionHost ─> Feishu cards
```

## Channel durability

- Inbox deduplicates external events and records uncertain admission without
  silently resending it.
- Binding maps a remote conversation to a CodyWork conversation and stores its
  execution and notification defaults.
- Turn link records only command-to-native-Turn correlation.
- Presentation stores remote card identity/revision, never assistant history.
- Outbox is the sole owner of retried external side effects.
- `ChannelDeliveryWorker` serializes delivery per account. Delivery failure is
  not provider disconnection and cannot restart Codex App Server.

## CodyWork channel components

`CodyWorkChannelService` is only the composition root. It must remain small and
must not contain provider callbacks, routing policy or event reduction.

| Component | Sole responsibility |
| --- | --- |
| `ChannelAccountManager` | Feishu account/provider lifecycle, reconnect and delivery worker ownership |
| `ChannelRouter` | inbound authorization, private/group/topic routing, binding wizard and slash commands |
| `ChannelBindingService` | Workspace/Demand/conversation selection and durable binding/group defaults |
| `ChannelCommandAdapter` | durable Inbox payload and attachments into the shared command gateway |
| `ChannelAccessService` | signed administrator access requests and allowlist updates |
| `ChannelRequestBridge` | approval/question cards and symmetric browser/Feishu resolution |
| `ChannelProjectionService` | canonical event observation, per-Turn card revisions and terminal convergence |
| `ChannelDeliveryWorker` | serialized durable Outbox delivery for one account |

SQLite remains one database and one synchronous transaction boundary, while
workflow services depend only on the structural `ChannelRepositoryPorts`:
`AccountRepository`,
`BindingRepository`, `InboxRepository`, `ProjectionRepository`,
`OutboxRepository`, `InteractiveRequestRepository`, and `AuditRepository`.
`ChannelStore` is the SQLite compatibility implementation behind those ports;
it is assembled only by the composition root and is not injected into channel
workflow components.

The component boundary is enforced by an architecture test: `ChannelBot`
delegates to these services and may not grow a second message router or
conversation reducer.

For a channel-originated Turn, interactive requests return only to its source
binding. A browser-originated request is mirrored only to bindings whose
`notificationPolicy` is `mirror-requests`; `origin-only` bindings stay silent.

## State machines that must stay separate

1. Codex App Server lifecycle: one process owner; no automatic restart after a
   crash inside the same service lifecycle.
2. Native Turn lifecycle: owned by Core SessionManager.
3. Browser WebSocket lifecycle: reconnect and reload native history.
4. Feishu provider lifecycle: reconnect independently.
5. Inbox/Outbox lifecycle: durable channel admission and delivery retries.

No transition in state machines 3–5 may advance, fail, restart or silently
replay state machines 1–2.

## Extension rule

Adding another channel provider should implement provider I/O and presentation
formatting around the same command gateway, event hub, projection host and
Inbox/Outbox contracts. It must not add source-specific branches to Runtime or
copy the conversation reducer.
