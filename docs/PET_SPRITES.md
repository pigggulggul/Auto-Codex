# Pet sprite contract

The first build ships with a CSS fallback pet so App Server integration can be tested without final art.

Place the eventual Codex pet spritesheet under `public/pets/` and configure its metadata in `src/lib/petCatalog.ts`.

Required semantic states:

| State | Meaning |
|---|---|
| idle | No active turn |
| connecting | Bridge or App Server startup |
| thinking | Reasoning or planning |
| reading | Repository exploration or read tool |
| editing | File change in progress |
| running | Command or generic tool execution |
| waitingApproval | User decision required |
| success | Turn completed |
| error | Turn or bridge failed |

The renderer must not assume a particular atlas layout. A catalog entry supplies the image URL, frame width and height, row/column mapping, FPS, and whether a state loops. Missing assets fall back to the CSS character.

Always pair animation with a visible text label and honor `prefers-reduced-motion`.

