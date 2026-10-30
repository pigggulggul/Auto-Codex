# Architecture

```text
React/Vite Atelier common workspace (127.0.0.1:4780 development)
           |
           | WebSocket: normalized client messages
           v
Node bridge (127.0.0.1:4781)
           +-- production static UI (--serve), same origin /ws
           +-- Atelier worker: SQLite v4 + private files/artifact copies
           +-- conversation store: history.json v1
           |
           | stdio JSONL / JSON-RPC
           v
codex app-server
           |
           +-- optional selected local project cwd
           +-- skills/list
           +-- model/list
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

- collects workspace mode (project or folderless research), project path when needed, prompt, routing mode, model/reasoning effort, and approval decision
- renders the pixel world, role pets, connection, normalized activity, task graph, outputs, and errors
- lets the user switch between the pixel view and a large readable result view
- manages user-facing conversation IDs while the bridge maps them to App Server threads
- uses the generated campus and state sheets under `public/world/`; generated decoration never changes execution truth
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
- `workspace.mode`
- `workspace.network`
- `conversation.new`
- `conversation.select`
- `conversation.rename` (bounded plain title, expectedTitle, correlated durable result)
- `skills.refresh`
- `models.refresh`
- `turn.start`
- `turn.interrupt`
- `approval.resolve`

Bridge to renderer:

- `bridge.state`
- `conversation.state`
- `conversation.rename.result` (save acknowledgment, never an execution result)
- `run.state`
- `project.selected`
- `skills.list`
- `models.list`
- `turn.state`
- `assistant.text`
- `activity.event`
- `approval.request`
- `protocol.event`
- `error`

Manual routing defaults to repository-scoped skills. The renderer can expand the list to all enabled Codex skills. Auto routing may select a concrete skill from the available list, but falls back to a role and its default character when no suitable skill is available.

## Security decisions

- Both servers bind to loopback.
- WebSocket Host/Origin/path are restricted to loopback production and the local development UI.
- Project paths are resolved by Node and must be existing directories.
- Static files must resolve inside the actual dist root before and after reading; a dist junction to an external target is rejected with 403.
- The renderer submits only an approval request ID and decision.
- The bridge never exposes `command/exec`, `process/spawn`, or `thread/shellCommand` to the renderer.
- Coordinator/research/report turns use `readOnly`; implementation/design/integration/verification turns use `workspaceWrite`.
- Network access is disabled by default for every turn.
- Each team Task receives an ephemeral App Server thread so outputs and events cannot be confused with another Task.
- Folderless research mode never supplies a project cwd and forces every task to `readOnly`; network access must be explicitly enabled for that mode.
- Solo conversations persist their thread IDs and call `thread/resume` after an App Server restart. Team Auto tasks remain ephemeral and receive prior user/assistant context through bounded history.
- The bridge saves project-associated transcripts, per-request task results and the selected conversation in `.local-data/history.json` using serialized atomic writes. The static server never serves that directory.
- Restored in-progress work becomes interrupted history. No approval IDs, trust decisions or network grants are restored; saved data never authorizes tool execution.

## Atelier common flow and ownership

The Atelier layout is the default when no explicit browser preference exists. The legacy layout is a compatibility view over the same hooks, state and bridge; switching layouts does not start, interrupt or duplicate work. Pixel, results and operations remain accessible. The original `atelier/atelier` application is preserved as source/reference and a separate test target; its HTTP server/database is not a required production process.

`src/features/atelier` presents four starting points and eight editors. `shared/atelier` owns deterministic design, scope, snapshot, review and revision rules. `server/atelier/worker.ts` serializes bounded persistence/byte operations independently of existing approval/interrupt processing. Public requests use strict `atelier.*` v1 schemas, project ownership and optimistic project.version. Files and long payloads use 256KiB chunks, a 1MiB frame ceiling, per-file 15MiB and legacy JSON 90MiB limits. Renderer paths, command text, permission grants and restored runtime IDs are not authority.

The proposal adapter shares the App Server process/admission boundary but enforces readOnly, network off and no approval escalation. Validated candidates retain source revision/target IDs and only explicit selected application changes the domain. Production freezes snapshot/selection/file hashes in InputManifest, stages selected source bytes and enters the existing Team/Solo execution path with workspaceWrite, network off by default and existing pending approval correlation. Semantic production scope does not expand writable roots. Existing maximum eight tasks/read parallelism three/writer and QA exclusivity remain.

P, binding, snapshot, generation and actual conversation/message/run/task/thread/turn IDs have separate meanings. A durable idempotency key returns the same generation; ambiguous dispatch after restart is interrupted with unknown outcome and never automatically replayed. Solo has no fabricated Team IDs. history and SQLite do not have a shared atomic transaction; dispatch/runtime journals and explicit failure states preserve that limitation.

ArtifactManifest captures only actual observed fileChange paths, verified workspace bytes and recognized command exit records. Bound checks compare cwd, runtime IDs, checkpoint/final hashes and later change ordering. Immutable private copies retain the original snapshot result after later workspace edits. HTML/SVG/scripts are text; verified raster images use local Blob URLs. Run completion, artifact verification, observed checks and human visual/behavior reviews remain separate. Human behavior evidence is distinct from command exit codes; AI/external opinions never set a user verdict. Revision snapshots retain the confirmed plan and source review criteria, reset judgments and mark prior matches for regression review.

Conversation names are local metadata. First-request excerpts require no model call; manual names retain titleSource=user in the compatible v1 archive. Rename validates fields/length, expected title and existing ID, performs serialized disk persistence before acknowledging, and leaves runtime/thread ownership unchanged. Failures preserve the UI draft and do not claim a saved name.

## Persistence contracts and unsupported proposals

`.local-data/atelier/atelier.sqlite` user_version=4 stores projects/revisions/files/snapshots/settings/proposals/bindings/generations/artifact_manifests. Attachment bytes and immutable artifacts are private subdirectories; transfers and exact-path operation journals support bounded recovery. Existing v1/v2/v3 migrations create consistent SQLite copies before advancing the respective existing schema. A migration DB copy is not a backup of attachment/artifact bytes.

Legacy atelier-backup v1 preserves manual projects and restores into a new P; runtime-result projects cannot be silently down-exported. Full offline backup/restore requires the stopped DB+bytes set, separate history and workspace. See [operations](OPERATIONS.md) for recovery order. Integrated AI backup/ID remapping, automated AI review, executable previews and external service integrations remain proposals, not supported APIs. [Stage 8](atelier/STAGE8_ACCEPTANCE.md) maps acceptance to current evidence and untested environments.
