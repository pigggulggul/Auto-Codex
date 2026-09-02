# Pixel world runtime

The center office renders through Canvas 2D with an original asset set in
`public/generated-pixel-assets/`. The source atlases are generated for Auto
Codex and then rasterized into the exact runtime dimensions used by the world.

## Runtime behavior

- The logical world is a 32 by 18 grid of 16-pixel tiles.
- The floor plan is split into eight role rooms plus a central lounge, with
  continuous floor fills and architectural wall bands/door thresholds drawn
  above the floor layer.
- App Server agent snapshots remain the source of truth for work state.
- Working, ready, and approval-waiting agents pathfind to their assigned desk.
- Idle agents may wander around their rest area. Ambient movement is not
  presented as evidence that a Codex action ran.
- PC sprites animate only while the corresponding runtime agent is active.
- Completed dependency transitions produce a temporary handoff route and label.
- Clicking an idle agent and then a walkable tile issues a visual-only movement.
- Clicking Claudio or Gitcat displays a short heart interaction.
- Character choices are saved locally in `localStorage` per browser profile.
- The activity center reads that same assignment map, so its portrait and the
  on-canvas agent always refer to the same character.

## Asset contract

- Character sheets: 256 by 256 pixels with a regular 4 by 4 grid of 64-pixel
  square cells. The first two cells of each `idle`, `moving`, `working`, and
  `thinking` row contain authored frames; the remaining cells are transparent.
  Characters render in a 3:4 box at 24 by 32 logical pixels (48 by 64 screen
  pixels at the default world zoom).
- Floors: 32 by 32 source pixels rendered into 16 by 16 logical tiles.
- Furniture: each image is drawn from its intrinsic 2x-density dimensions,
  centered horizontally and bottom-aligned to its 16-pixel floor footprint.
  Duplicate shelves were removed so decor does not bleed into adjacent rooms.
- Furniture and decor use 2x source density; pets are 192 by 192 pixels,
  decoded as 32-pixel source frames and drawn into 16-pixel logical footprints.
- Rendering disables image smoothing and draws at integer zoom levels.
- Floor source-atlas gutters are cropped during export; adjacent floor tiles
  are drawn edge-to-edge without transparent margins.

## Character family

Five selectable characters are original designs. The supplied images guided
only compact proportions, crisp pixel clusters, and the cheerful pastel mood;
their identities, silhouettes, hair, clothing, accessories, and color blocking
were not copied. Every state has two authored frames, so walking, working,
thinking, and ambient idle movement are visible without synthetic frame
shifting.

## Source and regeneration

`tools/generated-inputs/` stores the reviewed runtime-ready source sheets and
`tools/build-generated-pixel-assets.ps1` deterministically exports the runtime
files. `tools/build-character-sprites.py` removes connected generated
backgrounds, aligns feet, and exports 4x4 square sheets with eight active
frames. The QA contact sheet is
`docs/character-sprites-preview.jpg`.

The bridge and approval boundaries are unchanged. The Canvas renderer receives
only normalized snapshots and never executes commands.
