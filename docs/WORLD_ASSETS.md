# Generated pixel world assets

The Canvas office uses the original replacement pack in
`public/generated-pixel-assets/`. The older `public/world/` images remain
available for the legacy campus layer and are not used by the Canvas renderer.

Auto Codex의 실제 픽셀 월드 이미지는 `public/world/`에 있습니다.

| 파일 | 크기 | 용도 |
|---|---:|---|
| `auto-codex-campus.png` | 1536×1024 RGB | 현재 월드의 메인 캠퍼스 배경 |
| `auto-codex-tileset.png` | 1254×1254 RGB | 4×4 바닥·벽·물·다리 타일 시트 |
| `auto-codex-props.png` | 1254×1254 RGBA | 4×4 역할 작업대·가구·야외 소품 시트 |
| `auto-codex-effects.png` | 1254×1254 RGBA | 3×3 런타임 상태 이펙트 시트 |
| `assets.json` | JSON | 크기, grid, 상태별 cell 좌표 |

`auto-codex-campus.png`는 `.metaverse-map`의 배경이며, 기존 CSS 방과 가구는 클릭 영역만 남기고 숨깁니다. Canvas 픽셀 오피스는 논리 타일 16px을 유지하되 캐릭터·가구·바닥을 2배 픽셀 밀도로 내보내 기본 2× 표시에서 세부가 뭉개지지 않게 합니다. `auto-codex-effects.png`는 `idle`, `thinking`, `reading`, `editing`, `running`, `waitingApproval`, `success`, `error`, `handoff` 상태에 매핑됩니다.

새 캐릭터 시트는 built-in ImageGen으로 생성한 뒤 프로젝트의
`tools/build-character-sprites.py`로 256×256 셀, 2열×4행, 총 512×1024 구조로
정렬했습니다. 행 순서는 idle, moving, working, thinking이며 각 행에
애니메이션 프레임 2개를 배치합니다.
제공 이미지는 체형과 픽셀 분위기 참고로만 사용했고, 캐릭터 정체성,
헤어, 의상, 액세서리, 실루엣과 색 구성은 모두 새로 설계했습니다.

```text
Use case: stylized-concept
Asset type: production sprite atlas for a top-down pixel office web game
Input images: Image 1 guides only compact chibi proportions; Images 2-5 guide only cheerful pastel pixel atmosphere. Do not copy any referenced identity, silhouette, hair, clothing, accessory, or color blocking.
Primary request: exactly eight full-body frames of one completely original character in a strict 2-column by 4-row source grid.
Rows: IDLE, MOVING/WALKING, WORKING, THINKING; two readable animation frames per row.
Style: crisp cozy pixel art, readable face, consistent square framing, original hair and outfit.
Constraints: equal cells, aligned feet, transparent background, no labels, borders, watermark, scenery, furniture or shadow.
```

## Generation prompts

네 이미지 모두 built-in ImageGen으로 생성했습니다. 기존 교실 이미지는 색감과 픽셀 밀도 참고용, 사용자가 첨부한 대시보드는 넓은 floorplan 구성 참고용으로만 사용했습니다.

### Campus

```text
Original bright top-down pixel-art AI agent campus with eight connected spaces: quest/planning hall, research library, software build studio, documentation archive, visual design atelier, QA testing arcade, integration/server portal room, and sunny lounge. Add outdoor grass, trees, flowers, a narrow river, paths, desks, computers, shelves, sofas, test equipment and server racks. Landscape 3:2, high three-quarter top-down view, continuous walkable corridors, mint/cream/sky-blue/peach/lavender palette, crisp pixel edges. Environment only: no people, characters, labels, text, logos, UI, watermark, pseudo-text, painterly blur, or isometric diamond grid.
```

### Tileset

```text
Reusable top-down pixel tileset matching the campus in a strict 4x4 grid: grass, flower grass, dirt path, cream stone path, wood floor, blue office tile, lavender checker tile, pink studio tile, teal server floor, shallow water, river edge, wooden bridge, cream wall, window wall, doorway wall, and dark teal trim. Equal cells, plain gutters, repeatable edges, no text, furniture, characters, logos, or watermark.
```

### Props

```text
Transparent 4x4 pixel-art prop sheet: planning table, research desk, developer workstation, documentation desk, visual design desk, QA bench, integration portal/server station, lounge set, bookshelf, plant cluster, office chair, arcade cabinet, whiteboard, meeting table, outdoor bench and bridge. One complete object per equal cell, transparent padding, matching campus palette and viewpoint, no room background, text, characters, logos, watermark, or cropped objects.
```

### Effects

```text
Transparent 3x3 pixel-art status-effect sheet: idle sparkle, thinking cloud, reading book, editing pencil and paper, terminal and gears, approval shield, completion check and stars, error and broken gear, task-handoff envelope and arrow. Equal cells, transparent padding, matching campus palette, no words, characters, background, logos, watermark, or cropped effects.
```
