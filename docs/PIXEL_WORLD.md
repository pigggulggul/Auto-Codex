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

## Asset contract

- Character sheets: 112 by 96 pixels, seven 16 by 32 frames across three rows.
- Floors: 16 by 16 pixels.
- Furniture: the existing manifest dimensions and 16-pixel footprints, with
  original replacement art. The old cactus placement is now an explicitly
  named flower asset with the same 16 by 32 footprint.
- Pets: 96 by 96 pixels, decoded as 16-pixel frames.
- Rendering disables image smoothing and draws at integer zoom levels.
- Floor source-atlas gutters are cropped during export; adjacent floor tiles
  are drawn edge-to-edge without transparent margins.

## Character family

All six character files are derived from one generated base model. They share
the same 16 by 32 frame box, body height, head-to-body ratio, and 7 by 3 sheet
layout; only palette, hair, clothing, and small accessories vary. This keeps
the roster visually coherent while preserving per-role selection.

## Source and regeneration

`tools/generated-inputs/` stores the generated source atlases and
`tools/build-generated-pixel-assets.ps1` deterministically exports the runtime
files. Generated source images are original and do not include Pixel Agents or
MetroCity files.

The bridge and approval boundaries are unchanged. The Canvas renderer receives
only normalized snapshots and never executes commands.
