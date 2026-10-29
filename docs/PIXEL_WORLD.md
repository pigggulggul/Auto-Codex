# Pixel world runtime

The center office renders through Canvas 2D with an original asset set in
`public/generated-pixel-assets/`. The source atlases are generated for Auto
Codex and then rasterized into the exact runtime dimensions used by the world.

## Runtime behavior

- The logical world is a 40 by 24 grid of 16-pixel tiles.
- The floor plan is split into eight role rooms plus a central lounge, with
  continuous floor fills and architectural wall bands/door thresholds drawn
  above the floor layer.
- App Server agent snapshots remain the source of truth for work state.
- Working, ready, and approval-waiting agents pathfind to their assigned desk.
- Idle agents start and rest in the common corridor outside offices. They
  enter their assigned office for active runtime states and return outside
  when work ends. Idle wander targets stay clear of room walls and furniture,
  and avoid another agent's current/destination tiles. Ambient movement is not
  presented as evidence that a Codex action ran.
- Rest areas are outside the role offices. Offices have two-tile entrances
  onto an eight-tile common corridor; drawing and pathfinding share the same
  door coordinates and solid wall boundaries. Pets remain in the common area.
- PC sprites animate only while the corresponding runtime agent is active.
- Completed dependency transitions produce a temporary handoff label; completed
  agents return to the common area instead of entering a colleague's office.
- Clicking an idle agent and then a walkable tile issues a visual-only movement.
- Clicking Claudio or Gitcat displays a short heart interaction.
- Character choices are saved locally in `localStorage` per browser profile.
- Runtime speech bubbles are positioned over the Canvas as regular HTML text,
  so Korean and longer status labels remain readable while the art stays
  pixelated. Full assistant and task output is shown in the separate large
  result view.
- The activity center reads that same assignment map, so its portrait and the
  on-canvas agent always refer to the same character.

## Asset contract

- Character sheets: 512 by 1024 pixels with a regular 2 by 4 grid of 256-pixel
  square cells. Each `idle`, `moving`, `working`, and `thinking` row contains
  two authored frames.
  Runtime sheets use RGBA transparency, a 12px minimum cell margin, and a local
  foot baseline of y=240. The October walking repair replaces the second row
  with genuinely opposite footfalls and counter-swinging arms; asymmetric hair
  and accessories stay on the same side in both frames.
  The authored front-facing pose is retained for every movement direction.
  Character routing never mirrors, rotates or negatively scales the artwork.
  This prevents asymmetric hair, bows and bags switching sides as a path turns.
  The world toolbar includes an explicit animation toggle. It follows
  `prefers-reduced-motion` by default and stores an explicit user choice so the
  sprite frames can be enabled when the system setting is too restrictive.
  Characters now retain their square source cells at 48 by 48 logical pixels
  (96 by 96 at default zoom); transparent cell margins preserve the authored
  body proportions. Portraits also retain the square source aspect.
- Character animation mapping: row 0 is `idle` plus `success`/`error`, row 1 is
  movement, row 2 is `editing`/`running`/`waitingApproval`, and row 3 is
  `connecting`/`thinking`/`reading`. Both Canvas and CSS portraits use the same
  two-frame timing per mapped state.
  In the world, walk frames advance every eight logical pixels travelled,
  so stopping also stops the gait phase; the other states use elapsed time.
- Floors: 32 by 32 source pixels rendered into 16 by 16 logical tiles.
- Furniture: alpha bounds are measured once on image load. The complete visible
  silhouette is fitted proportionally into each placement's size limits,
  centered horizontally and bottom-aligned to its floor footprint. Transparent
  source padding no longer makes a chair, sofa or flower appear too small.
- Furniture and decor use 2x source density; pets are 192 by 192 pixels,
  decoded as 32-pixel source frames and drawn into 24-pixel logical boxes.
- The Canvas backing store follows its CSS dimensions and display pixel ratio
  (up to 3x). Original atlases are sampled directly into that backing store,
  avoiding an intermediate low-resolution character raster. Terrain keeps
  nearest-neighbor sampling; detailed character art uses high-quality sampling.
  Room names use accessible HTML buttons with a minimum 12px font instead of
  tiny text baked into the Canvas. Zoom remains in integer steps and panning
  is clamped to the map boundaries.
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
files. `tools/import-walk-frames.ps1` imports reviewed ImageGen walk A strips
and single opposite-stride B poses, retaining the other rows, preserving aspect,
aligning feet and enforcing transparent gutters. The older opaque-sheet
finalizer and background-removing scripts are legacy tools and must not be run
on the reviewed RGBA sheets. Open `docs/character-animation-preview.html` for
playback, fixed A/B inspection and the complete prop gallery; transparent
canvases are cleared before each frame so poses do not leave ghost limbs.
The current prompts are in `docs/walk-props-repair-prompts.json`.

The bridge and approval boundaries are unchanged. The Canvas renderer receives
only normalized snapshots and never executes commands.

## October 2026 readability repair

The default character's walking frame contained a stray room/background patch.
Built-in ImageGen repaired the atlas with a transparent background; the selected
2x4 output was normalized to 512x1024 and saved in both the reviewed source and
runtime `characters/char_0.png`. The repair prompts are recorded in
`docs/readability-repair-prompts.json`. No change to the other character
identities or animation-state routing was required. Whiteboards were moved
away from desk/monitor silhouettes. Asset loading status lives outside the
playfield, and roster text and portraits are larger.

## Walking and prop repair verification

- `furniture-atlas-v2.png` contains an empty desk, a chair, distinct front/back
  sofas, a coffee table with its single mug/plant, off/on PC poses and one full
  rug. `decor-atlas-v2.png` contains eight complete isolated decorations.
- `props-v2-regions.json` records reviewed per-column cut boundaries. Generated
  object positions do not necessarily obey uniform grid cuts: tall plants and
  shelves previously bled into the sunflower cell or lost pot bottoms.
- PC overlays sort after their desk surface, with monitor/keyboard dimensions
  fitted to the clear tabletop. A separate floor cup was removed from the
  lounge; the table already includes one. The rug is one complete authored
  image rather than a patchwork of nine unrelated teal floor patterns.
- `node tools/verify-pixel-assets.mjs` checks all five opposite planted-foot
  pairs, cell margins, source/runtime parity, all 17 furniture PNG alpha borders
  and different active PC screen content. The old walk pair fails this check
  because its planted-foot centroid barely moves; the repaired pairs cross the
  frame center and shift by at least 20 source pixels.
- `npm test` also runs that bitmap verification. Visual review remains necessary
  for silhouettes, consistent identity, layering and overall composition.
- `spriteRendering.test.ts` exercises the production character draw function
  with all five images, four route headings and both gait phases (80 draws),
  refusing any scale/translation that could flip identity. The actual office
  was also exercised in both horizontal directions and captured frame by frame;
  the earlier raw-atlas-only check missed the runtime direction mirror.
- Offices now have room-sized desks/PCs/chairs, role-specific bookshelves or
  boards, and unobstructed door routes to shared rest positions outside. The central
  lounge holds larger front/back sofas and a centered table without enclosing
  walls or characters congregating between all workstations.
- Scope is R1: local renderer, authored art and deterministic export only. No
  bridge execution, permission, conversation-storage or network change is made
  by this repair. Rebuild with `npm run assets:build`, then typecheck/test/build.
