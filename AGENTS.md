# Auto Codex project instructions

## Mission

Build a Windows-friendly, local-only visual client for Codex App Server. The app must reflect real runtime events, keep approval decisions explicit, and never pretend that a cosmetic animation is proof of an action.

## Architecture

- `src/`: React/Vite renderer. Treat it as untrusted presentation code.
- `server/`: Node bridge. Own Codex App Server process lifecycle, JSON-RPC, path validation, event normalization, and approval correlation.
- `docs/`: protocol decisions, sprite contract, and operational notes.

The browser talks only to `ws://127.0.0.1:4781/ws`. The bridge spawns `codex app-server` and uses newline-delimited JSON on stdio. Do not make the browser parse raw app-server output or execute commands.

## Trust and permission rules

- Bind local services to `127.0.0.1`, never `0.0.0.0`, unless the user explicitly changes the product scope.
- Validate and resolve every project path in the bridge before sending it as `cwd`.
- Reject non-directory paths and paths that disappear during a run.
- Never expose a generic shell endpoint.
- Never call `thread/shellCommand`; it runs outside the thread sandbox.
- An approval response must match a currently pending App Server request ID. Do not accept command, cwd, or permission details supplied by the browser as authoritative.
- Grant only the requested subset of filesystem/network permissions.
- Keep network access disabled by default for Codex turns.
- Do not log tokens, credentials, environment secrets, or raw sensitive file contents.

## Event and UI rules

- Derive activity from App Server notifications such as `turn/*`, `item/*`, and approval requests.
- Keep the raw protocol event available for diagnostics, but render a stable normalized event contract in the UI.
- A skill character represents an explicitly selected or bridge-routed skill. Tool characters represent actual item types.
- If no skill is selected, show the general agent; do not invent a skill label.
- Respect `prefers-reduced-motion` and provide text status alongside animation.

## Development workflow

- Keep protocol parsing and UI state mapping independently testable.
- Run `npm run typecheck`, `npm test`, and `npm run build` for meaningful changes.

## Definition of done

- The bridge starts or reports a clear Codex CLI error.
- A valid local project can start a thread and turn.
- Skills can be listed and one may be selected explicitly or by the deterministic router.
- Runtime events change the pet state and appear in the timeline.
- Approval prompts can be accepted or declined without allowing arbitrary execution.
- Type checks, tests, and production build pass.
