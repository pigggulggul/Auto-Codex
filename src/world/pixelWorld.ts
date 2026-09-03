import type { AgentRole, PetState } from "../../shared/protocol";

export const TILE_SIZE = 16;
export const WORLD_COLS = 32;
export const WORLD_ROWS = 18;
export const CANVAS_WIDTH = WORLD_COLS * TILE_SIZE * 2;
export const CANVAS_HEIGHT = WORLD_ROWS * TILE_SIZE * 2;
// Character art uses square 256px source cells in a 2x4 sheet. The service
// renders those cells in a 3:4 character box: 24x32 logical pixels, or 48x64
// at default zoom.
export const CHARACTER_FRAME_WIDTH = 256;
export const CHARACTER_FRAME_HEIGHT = 256;
export const CHARACTER_DRAW_WIDTH = TILE_SIZE * 1.5;
export const CHARACTER_DRAW_HEIGHT = TILE_SIZE * 2;
export const CHARACTER_FRAME_COLUMNS = 2;
export const CHARACTER_SHEET_COLUMNS = 2;
export const CHARACTER_STATE_ROWS = 4;
export const ASSET_PIXEL_DENSITY = 2;
export const PET_FRAME_SIZE = TILE_SIZE * 2;

const CHARACTER_ROW_BY_STATE: Partial<Record<PetState, number>> = {
  editing: 2,
  running: 2,
  waitingApproval: 2,
  connecting: 3,
  thinking: 3,
  reading: 3,
};

export type TilePoint = { col: number; row: number };
export type Direction = "down" | "up" | "right" | "left";

export const ROLE_ORDER: AgentRole[] = [
  "researcher",
  "builder",
  "documenter",
  "visual",
  "integrator",
  "coordinator",
  "qa",
  "general",
];

export const ROLE_LABELS: Record<AgentRole, string> = {
  coordinator: "Coordinator",
  general: "Generalist",
  builder: "Builder",
  researcher: "Researcher",
  documenter: "Documenter",
  visual: "Visual Designer",
  qa: "QA Inspector",
  integrator: "Integrator",
};

export const ROLE_COLORS: Record<AgentRole, string> = {
  researcher: "#5d8fc7",
  builder: "#d98f55",
  documenter: "#9a78c3",
  visual: "#cf6f93",
  integrator: "#5bafa5",
  coordinator: "#d3ad4d",
  qa: "#67a867",
  general: "#8a8176",
};

export const STATIONS: Record<AgentRole, TilePoint> = {
  researcher: { col: 3, row: 4 },
  builder: { col: 10, row: 4 },
  documenter: { col: 17, row: 4 },
  visual: { col: 24, row: 4 },
  integrator: { col: 3, row: 15 },
  coordinator: { col: 10, row: 15 },
  qa: { col: 17, row: 15 },
  general: { col: 24, row: 15 },
};

export const REST_SPOTS: Record<AgentRole, TilePoint> = {
  researcher: { col: 3, row: 8 },
  builder: { col: 7, row: 9 },
  documenter: { col: 11, row: 8 },
  visual: { col: 13, row: 10 },
  integrator: { col: 19, row: 8 },
  coordinator: { col: 21, row: 10 },
  qa: { col: 25, row: 8 },
  general: { col: 28, row: 9 },
};

export type FurniturePlacement = {
  id: string;
  asset: string;
  col: number;
  row: number;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  ownerRole?: AgentRole;
  blocks?: boolean;
  mirrored?: boolean;
};

export type FurnitureVisualRect = { x: number; y: number; width: number; height: number };

export type RoomLayout = {
  id: string;
  col: number;
  row: number;
  width: number;
  height: number;
  floorIndex: number;
  role?: AgentRole;
};

// The world is still a compact 32x18 canvas, but the floor plan is organized
// as rooms and a connected central lounge so the scene reads like a building
// rather than a flat sheet of terrain.
export const ROOM_LAYOUTS: RoomLayout[] = [
  { id: "research-room", role: "researcher", col: 1, row: 1, width: 7, height: 5, floorIndex: 7 },
  { id: "builder-room", role: "builder", col: 8, row: 1, width: 7, height: 5, floorIndex: 3 },
  { id: "documenter-room", role: "documenter", col: 15, row: 1, width: 7, height: 5, floorIndex: 5 },
  { id: "visual-room", role: "visual", col: 22, row: 1, width: 9, height: 5, floorIndex: 8 },
  { id: "lounge-room", col: 14, row: 6, width: 5, height: 6, floorIndex: 8 },
  { id: "integrator-room", role: "integrator", col: 1, row: 12, width: 7, height: 5, floorIndex: 3 },
  { id: "coordinator-room", role: "coordinator", col: 8, row: 12, width: 7, height: 5, floorIndex: 5 },
  { id: "qa-room", role: "qa", col: 15, row: 12, width: 7, height: 5, floorIndex: 8 },
  { id: "general-room", role: "general", col: 22, row: 12, width: 9, height: 5, floorIndex: 7 },
];

const TOP_ROLES: AgentRole[] = ["researcher", "builder", "documenter", "visual"];
const BOTTOM_ROLES: AgentRole[] = ["integrator", "coordinator", "qa", "general"];

function workstationFurniture(role: AgentRole, deskCol: number, deskRow: number): FurniturePlacement[] {
  return [
    {
      id: `${role}-desk`,
      asset: "DESK/DESK_FRONT.png",
      col: deskCol,
      row: deskRow,
      width: 48,
      height: 32,
      footprintW: 3,
      footprintH: 2,
      ownerRole: role,
      blocks: true,
    },
    {
      id: `${role}-pc`,
      asset: "PC/PC_FRONT_OFF.png",
      col: deskCol + 1,
      row: deskRow,
      width: 16,
      height: 32,
      footprintW: 1,
      footprintH: 1,
      ownerRole: role,
    },
    {
      id: `${role}-chair`,
      asset: "CUSHIONED_CHAIR/CUSHIONED_CHAIR_FRONT.png",
      col: deskCol + 1,
      row: deskRow + 2,
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      ownerRole: role,
    },
  ];
}

export const FURNITURE: FurniturePlacement[] = [
  ...TOP_ROLES.flatMap((role, index) => workstationFurniture(role, 2 + index * 7, 2)),
  ...BOTTOM_ROLES.flatMap((role, index) => workstationFurniture(role, 2 + index * 7, 13)),
  { id: "lounge-sofa-top", asset: "SOFA/SOFA_FRONT.png", col: 15, row: 7, width: 32, height: 16, footprintW: 2, footprintH: 1, blocks: true },
  { id: "lounge-table", asset: "COFFEE_TABLE/COFFEE_TABLE.png", col: 15, row: 9, width: 32, height: 32, footprintW: 2, footprintH: 2, blocks: true },
  { id: "lounge-sofa-bottom", asset: "SOFA/SOFA_BACK.png", col: 15, row: 11, width: 32, height: 16, footprintW: 2, footprintH: 1, blocks: true },
  { id: "whiteboard", asset: "WHITEBOARD/WHITEBOARD.png", col: 16, row: 2, width: 32, height: 32, footprintW: 2, footprintH: 1 },
  { id: "books-left", asset: "DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png", col: 5, row: 2, width: 32, height: 32, footprintW: 2, footprintH: 1 },
  { id: "books-right", asset: "DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png", col: 25, row: 2, width: 32, height: 32, footprintW: 2, footprintH: 1 },
  { id: "plant-nw", asset: "PLANT/PLANT.png", col: 1, row: 2, width: 16, height: 32, footprintW: 1, footprintH: 2, blocks: true },
  { id: "plant-ne", asset: "LARGE_PLANT/LARGE_PLANT.png", col: 28, row: 2, width: 32, height: 48, footprintW: 2, footprintH: 3, blocks: true },
  { id: "plant-sw", asset: "PLANT_2/PLANT_2.png", col: 1, row: 14, width: 16, height: 32, footprintW: 1, footprintH: 2, blocks: true },
  { id: "plant-se", asset: "FLOWER/FLOWER.png", col: 29, row: 14, width: 16, height: 32, footprintW: 1, footprintH: 2, blocks: true },
  { id: "coffee", asset: "COFFEE/COFFEE.png", col: 15, row: 10, width: 16, height: 16, footprintW: 1, footprintH: 1 },
  { id: "clock", asset: "CLOCK/CLOCK.png", col: 20, row: 2, width: 16, height: 32, footprintW: 1, footprintH: 1 },
  { id: "clock-builder", asset: "CLOCK/CLOCK.png", col: 13, row: 2, width: 16, height: 32, footprintW: 1, footprintH: 1 },
  { id: "lounge-plant-left", asset: "PLANT_2/PLANT_2.png", col: 14, row: 7, width: 16, height: 32, footprintW: 1, footprintH: 2 },
  { id: "lounge-plant-right", asset: "PLANT/PLANT.png", col: 17, row: 7, width: 16, height: 32, footprintW: 1, footprintH: 2 },
  { id: "clock-qa", asset: "CLOCK/CLOCK.png", col: 20, row: 14, width: 16, height: 32, footprintW: 1, footprintH: 1 },
  { id: "whiteboard-qa", asset: "WHITEBOARD/WHITEBOARD.png", col: 15, row: 14, width: 32, height: 32, footprintW: 2, footprintH: 1 },
];

export const ASSET_ROOT = "/generated-pixel-assets";
export const FLOOR_ASSETS = Array.from({ length: 9 }, (_, index) => `${ASSET_ROOT}/floors/floor_${index}.png`);
export const CHARACTER_ASSETS = Array.from({ length: 5 }, (_, index) => `${ASSET_ROOT}/characters/char_${index}.png`);
export const PET_ASSETS = [`${ASSET_ROOT}/pets/claudio/pet.png`, `${ASSET_ROOT}/pets/gitcat/pet.png`];
export const WALL_ASSET = `${ASSET_ROOT}/walls/wall_0.png`;
export const CARPET_ASSETS = Array.from({ length: 3 }, (_, index) => `${ASSET_ROOT}/carpets/carpet_${index}.png`);

export function furnitureAssetPath(asset: string): string {
  return `${ASSET_ROOT}/furniture/${asset}`;
}

export function furnitureVisualRect(
  item: FurniturePlacement,
  naturalWidth = item.width * ASSET_PIXEL_DENSITY,
  naturalHeight = item.height * ASSET_PIXEL_DENSITY,
): FurnitureVisualRect {
  const width = naturalWidth / ASSET_PIXEL_DENSITY;
  const height = naturalHeight / ASSET_PIXEL_DENSITY;
  const footprintWidth = item.footprintW * TILE_SIZE;
  return {
    x: item.col * TILE_SIZE + (footprintWidth - width) / 2,
    y: (item.row + item.footprintH) * TILE_SIZE - height,
    width,
    height,
  };
}

export function tileKey(point: TilePoint): string {
  return `${point.col},${point.row}`;
}

export function createBlockedTiles(): Set<string> {
  const blocked = new Set<string>();
  for (let col = 0; col < WORLD_COLS; col += 1) {
    blocked.add(tileKey({ col, row: 0 }));
    blocked.add(tileKey({ col, row: WORLD_ROWS - 1 }));
  }
  for (let row = 0; row < WORLD_ROWS; row += 1) {
    blocked.add(tileKey({ col: 0, row }));
    blocked.add(tileKey({ col: WORLD_COLS - 1, row }));
  }
  for (const item of FURNITURE) {
    if (!item.blocks) continue;
    for (let row = item.row; row < item.row + item.footprintH; row += 1) {
      for (let col = item.col; col < item.col + item.footprintW; col += 1) {
        blocked.add(tileKey({ col, row }));
      }
    }
  }
  return blocked;
}

export function isWalkable(point: TilePoint, blocked = createBlockedTiles()): boolean {
  return point.col > 0
    && point.row > 0
    && point.col < WORLD_COLS - 1
    && point.row < WORLD_ROWS - 1
    && !blocked.has(tileKey(point));
}

export function findPath(start: TilePoint, target: TilePoint, blocked = createBlockedTiles()): TilePoint[] {
  if (!isWalkable(start, blocked) || !isWalkable(target, blocked)) return [];
  if (start.col === target.col && start.row === target.row) return [];

  const queue: TilePoint[] = [start];
  let cursor = 0;
  const startKey = tileKey(start);
  const previous = new Map<string, string | null>([[startKey, null]]);
  const points = new Map<string, TilePoint>([[startKey, start]]);
  const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    for (const [dc, dr] of offsets) {
      const next = { col: current.col + dc, row: current.row + dr };
      const key = tileKey(next);
      if (previous.has(key) || !isWalkable(next, blocked)) continue;
      previous.set(key, tileKey(current));
      points.set(key, next);
      if (next.col === target.col && next.row === target.row) {
        const result: TilePoint[] = [];
        let stepKey: string | null = key;
        while (stepKey && stepKey !== startKey) {
          const point = points.get(stepKey);
          if (!point) break;
          result.unshift(point);
          stepKey = previous.get(stepKey) ?? null;
        }
        return result;
      }
      queue.push(next);
    }
  }
  return [];
}

export function directionBetween(from: TilePoint, to: TilePoint): Direction {
  if (to.col > from.col) return "right";
  if (to.col < from.col) return "left";
  if (to.row < from.row) return "up";
  return "down";
}

export function characterFrame(state: PetState, moving: boolean, elapsedSeconds: number): number {
  return Math.floor(elapsedSeconds / characterFrameDuration(state, moving)) % CHARACTER_FRAME_COLUMNS;
}

export function characterFrameDuration(state: PetState, moving: boolean): number {
  if (moving) return 0.16;
  if (state === "idle" || state === "success" || state === "error") return 0.68;
  if (state === "thinking" || state === "reading" || state === "connecting") return 0.42;
  return 0.28;
}

export function characterStateRow(state: PetState, moving: boolean): number {
  if (moving) return 1;
  return CHARACTER_ROW_BY_STATE[state] ?? 0;
}

export function pointCenter(point: TilePoint): { x: number; y: number } {
  return {
    x: point.col * TILE_SIZE + TILE_SIZE / 2,
    y: point.row * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function isRuntimeActive(status: string): boolean {
  return status === "working" || status === "waitingApproval" || status === "ready";
}
