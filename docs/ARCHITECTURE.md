# Architecture

```text
React/Vite renderer (127.0.0.1:4780)
           |
           | WebSocket: normalized client messages
           v
Node bridge (127.0.0.1:4781)
           |
           | stdio JSONL / JSON-RPC
           v
codex app-server
           |
           +-- selected local project cwd
           +-- skills/list
           +-- thread/start, turn/start, turn/interrupt
           +-- item and approval events
```

The renderer also uses `shared/skill-catalog.ts` to present the same role vocabulary as the bridge. Character assignments are presentation preferences stored in browser local storage per project path; they do not change Codex permissions or execution policy.

## Responsibilities

Renderer:

- collects project path, prompt, routing mode, and approval decision
- renders connection, pet state, selected skill, timeline, and errors
- never executes commands or decides which permission details are valid

Bridge:

- owns App Server child process and JSON-RPC request IDs
- validates project paths and controls thread state
- discovers skills and performs deterministic role-based auto-routing
- keeps the active role separate from the selected concrete skill so a default character can be shown when no dedicated skill is available
- correlates App Server approval requests with one-time browser decisions
- translates raw notifications into a stable UI event schema

App Server:

- owns Codex authentication, conversation lifecycle, sandboxed execution, file changes, tool calls, and approval requests

## MVP protocol

Renderer to bridge:

- `project.select`
- `skills.refresh`
- `turn.start`
- `turn.interrupt`
- `approval.resolve`

Bridge to renderer:

- `bridge.state`
- `project.selected`
- `skills.list`
- `turn.state`
- `activity.event`
- `approval.request`
- `protocol.event`
- `error`

Manual routing defaults to repository-scoped skills. The renderer can expand the list to all enabled Codex skills. Auto routing may select a concrete skill from the available list, but falls back to a role and its default character when no suitable skill is available.

## Security decisions

- Both servers bind to loopback.
- WebSocket Origin is restricted to local development origins.
- Project paths are resolved by Node and must be existing directories.
- The renderer submits only an approval request ID and decision.
- The bridge never exposes `command/exec`, `process/spawn`, or `thread/shellCommand` to the renderer.
- Codex threads use the `workspace-write` sandbox and network access is disabled by default.
