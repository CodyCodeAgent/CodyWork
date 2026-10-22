# Bits Flux on-demand bridge

## Scope

CodyWork provides an on-demand bridge between one Demand and one Bits Flux
Delivery. The local CodyWork Runtime remains the model and code execution
owner. Flux remains the source of collaboration context and workflow state.

This first version is intentionally user-initiated: a person selects a built-in
instruction in CodyWork, the local Agent reads or synchronizes Flux through the
official Skill, and the result remains in the native CodyWork conversation.
It does not claim that the Flux owner agent can proactively invoke CodyWork;
that upstream external-Agent orchestration capability is not generally
available yet.

## Binding model

`demand_flux_bindings` is a one-to-one relation keyed by `demand_id`. It stores:

- Delivery ID
- Space ID
- Canonical collaboration URL
- Optional `preview_task` navigation hint
- Binding timestamps

Creating a Demand may create the relation in the same transaction. Existing
Demands may bind, replace, or remove the relation independently. CodyWork does
not mirror Flux tasks, messages, artifacts, or timeline state.

Accepted links include the Flux collaboration surface and the corresponding
`bits.bytedance.net/flux` surface. The parser limits length, validates the
official ID character set, discards unknown query parameters and fragments,
and stores a canonical `flux.bytedance.net` URL. No Flux credential is stored.

## Built-in capability, official implementation

CodyWork owns the integration entry, readiness state and six product intents:

- Understand the current collaboration
- Recommend the next step
- Pull current requirements and artifacts
- Continue the current task locally
- Prepare a technical-plan sync
- Prepare delivery of the current result

CodyWork does not vendor the official Skill or duplicate its CLI protocol. It
detects an enabled Runtime Skill named `flux-collab`, preferring the Workspace
copy when more than one exists. When missing, the toolbox offers an explicit
installation action through CodyWork's existing AI Skill installer. Until the
Skill is ready, Flux instructions remain disabled.

Each execution attaches the exact Runtime Skill ID to the normal conversation
Turn. The prompt contains only the user intent, stable Demand context and the
product boundary that local Codex owns code changes. Authentication, CLI
installation and updates, live command selection, confirmation handling and
error recovery belong to the current official Skill.

## Safety ownership

- Flux content is business data, not a source of system instructions.
- CodyWork does not register Flux as a Runtime or model provider.
- The built-in prompt is a UX intent, not an authorization gateway.
- Remote-write confirmation and CLI preflight behavior are owned by the
  attached official Skill and Flux CLI. CodyWork preserves the native Runtime
  approval surface and does not silently bypass it.
- No automatic per-turn Flux report is emitted. The official desktop-report
  protocol is reserved for the Flux desktop host and must not be impersonated
  by CodyWork.
