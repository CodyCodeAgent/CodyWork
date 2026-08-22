# CodyWork Design System

> Workspace-first developer console. Page overrides in `pages/` take precedence.

## Product Model

The interface always makes the active scope explicit:

```text
Global → Workspace → Demand → Agent conversation
```

- Global owns the Workspace registry and Runtime adapter settings.
- Workspace owns dashboard, demands, repositories, knowledge and Skills.
- Demand owns isolated Worktrees, documents, conversations, Goal and Plan.
- Every durable scope is represented in the URL and can be shared directly.

## Visual Direction

**Style:** precision productivity console

**Dials:** variance 6/10 · motion 3/10 · density 8/10

- Dark contextual sidebar; light high-legibility work surface.
- Compact information density with clear 8px rhythm.
- Surfaces use thin borders and restrained elevation, not decorative glass.
- Indigo is reserved for focus, selection and primary actions.
- Green, amber and red are semantic statuses and always include text or shape.

## Tokens

| Role | Value |
|---|---|
| Canvas | `#F6F7F9` |
| Surface | `#FFFFFF` |
| Sidebar | `#111318` |
| Primary text | `#171922` |
| Secondary text | `#4D5565` |
| Muted text | `#778195` |
| Border | `#E5E7EB` |
| Primary | `#5B5CF0` |
| Primary hover | `#4B4CDA` |
| Primary soft | `#EFF0FF` |
| Success | `#15825D` |
| Warning | `#A86413` |
| Destructive | `#B64753` |

Typography uses Inter / system UI and `SFMono-Regular` for paths, branches and runtime output. Type scale: 9, 10, 11, 12, 14, 16, 20, 24, 32.

## Navigation

- The Workspace switcher is the persistent context anchor.
- Workspace navigation remains reachable inside every demand.
- Demand pages add a nested contextual item below the selected Demand entry.
- Runtime settings are spatially separated at the bottom as a global concern.
- Use breadcrumbs at three or more levels and preserve browser back behavior.
- Desktop uses a 286px sidebar; narrow screens collapse it to a labeled-icon rail.

## Components

- Buttons and inputs are at least 38px high on desktop and 44px on touch layouts.
- Cards use 12–16px radii, 1px borders and one shared elevation scale.
- Status pills use a label plus semantic color; never color alone.
- Use the shared inline outline icon family at 16–18px with 1.8px strokes.
- One primary action per page header. Secondary actions remain neutral.
- Lists are preferred over oversized cards for scalable management views.

## Motion and Accessibility

- Interaction transitions: 150–200ms using `cubic-bezier(.16,1,.3,1)`.
- Motion communicates state only; no ornamental page reveals.
- Respect `prefers-reduced-motion`.
- Provide a skip link, semantic navigation, visible focus rings and labeled controls.
- Maintain 4.5:1 text contrast and avoid emoji as structural icons.
- Validate at 375, 768, 1024 and 1440px with no horizontal overflow.

## Page Density

- Dashboard: 12-column metric grid; 3 primary metrics and 2 secondary metrics.
- Demand list: status filters + search + structured list rows.
- Knowledge and Skills: master-detail split view, collapsing to one column.
- Demand development: conversation list + event stream + sticky composer.
- Settings: one-column reading flow with provider choices grouped together.

## Anti-patterns

- Do not flatten Global, Workspace and Demand actions into one navigation group.
- Do not use landing-page whitespace or oversized marketing typography.
- Do not hide the Workspace context while inside a demand.
- Do not create fake dashboard data to fill visual space.
- Do not use icon-only navigation without accessible labels.
- Do not expose Runtime permission modes as machine-wide access.
