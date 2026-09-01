# Architecture

```text
React/Vite pixel office (127.0.0.1:4780)
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
           +-- task별 thread/start, turn/start, turn/interrupt
           +-- item and approval events
```

Team Auto 실행 흐름:

```text
user prompt
    |
    v
Coordinator planning turn (readOnly + outputSchema)
    |
    v
Bridge plan validation / safe fallback
    |
    +-- independent read tasks ----+  최대 3개 병렬
    +-- independent read tasks ----+
    |
    v
exclusive workspace-write task       다른 active task와 겹치지 않음
    |
    v
exclusive QA verification
    |
    v
Coordinator settled report           실패·차단도 수집
```

Renderer의 Pixel 테마와 Coordinator 역할은 별개입니다. 캐릭터는 실제 App Server 이벤트를 표시하는 시각화이며 권한이나 실행 정책을 바꾸지 않습니다.

## Responsibilities

Renderer:

- collects project path, prompt, routing mode, and approval decision
- renders connection, pet state, selected skill, timeline, and errors
- never executes commands or decides which permission details are valid

Bridge:

- owns App Server child process and JSON-RPC request IDs
- validates project paths and controls Run/Task/Agent/thread/turn state
- validates task count, IDs, dependencies, and DAG cycles
- schedules only independent read tasks concurrently and serializes workspace writers
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
- `run.state`
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
- Coordinator/research/report turns use `readOnly`; implementation/design/integration/verification turns use `workspaceWrite`.
- Network access is disabled by default for every turn.
- Each team Task receives an ephemeral App Server thread so outputs and events cannot be confused with another Task.
