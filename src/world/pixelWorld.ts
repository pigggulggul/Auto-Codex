import type { AgentRole, PetState } from "../../shared/protocol";

export const TILE_SIZE = 16;
export const WORLD_COLS = 40;
export const WORLD_ROWS = 24;
export const CANVAS_WIDTH = WORLD_COLS * TILE_SIZE * 2;
export const CANVAS_HEIGHT = WORLD_ROWS * TILE_SIZE * 2;
// Keep the authored square cells square. High-density backing stores sample
// directly from the original atlas rather than magnifying a tiny raster.
export const CHARACTER_FRAME_WIDTH = 256;
export const CHARACTER_FRAME_HEIGHT = 256;
export const CHARACTER_DRAW_WIDTH = 48;
export const CHARACTER_DRAW_HEIGHT = 48;
export const CHARACTER_FRAME_COLUMNS = 2;
export const CHARACTER_SHEET_COLUMNS = 2;
export const CHARACTER_STATE_ROWS = 4;
export const ASSET_PIXEL_DENSITY = 2;
export const PET_FRAME_SIZE = TILE_SIZE * 2;
export const PET_DRAW_SIZE = 24;
export const LOUNGE_RUG = { col: 16, row: 9, width: 7, height: 7 };

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
  researcher: { col: 4, row: 6 },
  builder: { col: 13, row: 6 },
  documenter: { col: 22, row: 6 },
  visual: { col: 31, row: 6 },
  integrator: { col: 4, row: 21 },
  coordinator: { col: 13, row: 21 },
  qa: { col: 22, row: 21 },
  general: { col: 31, row: 21 },
};

export const REST_SPOTS: Record<AgentRole, TilePoint> = {
  researcher: { col: 6, row: 10 },
  builder: { col: 12, row: 10 },
  documenter: { col: 27, row: 10 },
  visual: { col: 33, row: 10 },
  integrator: { col: 6, row: 14 },
  coordinator: { col: 12, row: 14 },
  qa: { col: 27, row: 14 },
  general: { col: 33, row: 14 },
};

export function isCommonArea(point: TilePoint): boolean {
  return point.row >= 10 && point.row <= 14 && point.col >= 2 && point.col <= WORLD_COLS - 3;
}

export function idleWanderTargets(role: AgentRole, blocked = createBlockedTiles()): TilePoint[] {
  const center = REST_SPOTS[role];
  const candidates: TilePoint[] = [];
  for (let row = center.row - 1; row <= center.row + 1; row += 1) {
    for (let col = center.col - 2; col <= center.col + 2; col += 1) {
      const point = { col, row };
      if (isCommonArea(point) && isWalkable(point, blocked)) candidates.push(point);
    }
  }
  return candidates;
}

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

// Each role owns an office; rest spots are in the common corridor. The lounge is open
// to the main corridor, leaving both sides clear for room-to-room traffic.
export const ROOM_LAYOUTS: RoomLayout[] = [
  { id: "research-room", role: "researcher", col: 1, row: 1, width: 9, height: 7, floorIndex: 7 },
  { id: "builder-room", role: "builder", col: 10, row: 1, width: 9, height: 7, floorIndex: 3 },
  { id: "documenter-room", role: "documenter", col: 19, row: 1, width: 9, height: 7, floorIndex: 7 },
  { id: "visual-room", role: "visual", col: 28, row: 1, width: 11, height: 7, floorIndex: 8 },
  { id: "lounge-room", col: 14, row: 9, width: 12, height: 7, floorIndex: 4 },
  { id: "integrator-room", role: "integrator", col: 1, row: 16, width: 9, height: 7, floorIndex: 5 },
  { id: "coordinator-room", role: "coordinator", col: 10, row: 16, width: 9, height: 7, floorIndex: 3 },
  { id: "qa-room", role: "qa", col: 19, row: 16, width: 9, height: 7, floorIndex: 8 },
  { id: "general-room", role: "general", col: 28, row: 16, width: 11, height: 7, floorIndex: 7 },
];

export function roomDoorTiles(room: RoomLayout): TilePoint[] {
  if (!room.role) return [];
  const row = room.row < WORLD_ROWS / 2 ? room.row + room.height : room.row;
  const col = room.col + Math.floor(room.width / 2);
  return [{ col, row }, { col: col + 1, row }];
}

const TOP_ROLES: AgentRole[] = ["researcher", "builder", "documenter", "visual"];
const BOTTOM_ROLES: AgentRole[] = ["integrator", "coordinator", "qa", "general"];

function workstationFurniture(role: AgentRole, deskCol: number, deskRow: number): FurniturePlacement[] {
  return [
    {
      id: `${role}-desk`,
      asset: "DESK/DESK_FRONT.png",
      col: deskCol,
      row: deskRow,
      width: 64,
      height: 40,
      footprintW: 4,
      footprintH: 2,
      ownerRole: role,
      blocks: true,
    },
    {
      id: `${role}-pc`,
      asset: "PC/PC_FRONT_OFF.png",
      col: deskCol + 1,
      row: deskRow,
      width: 36,
      height: 28,
      footprintW: 1,
      footprintH: 1,
      ownerRole: role,
    },
    {
      id: `${role}-chair`,
      asset: "CUSHIONED_CHAIR/CUSHIONED_CHAIR_FRONT.png",
      col: deskCol + 1,
      row: deskRow + 2,
      width: 24,
      height: 24,
      footprintW: 1,
      footprintH: 1,
      ownerRole: role,
    },
  ];
}

export const FURNITURE: FurniturePlacement[] = [
  ...TOP_ROLES.flatMap((role, index) => workstationFurniture(role, 3 + index * 9, 3)),
  ...BOTTOM_ROLES.flatMap((role, index) => workstationFurniture(role, 3 + index * 9, 18)),
  { id: "lounge-sofa-top", asset: "SOFA/SOFA_FRONT.png", col: 17, row: 11, width: 72, height: 36, footprintW: 4, footprintH: 1, blocks: true },
  { id: "lounge-table", asset: "COFFEE_TABLE/COFFEE_TABLE.png", col: 17, row: 13, width: 48, height: 24, footprintW: 4, footprintH: 1, blocks: true },
  { id: "lounge-sofa-bottom", asset: "SOFA/SOFA_BACK.png", col: 17, row: 15, width: 72, height: 28, footprintW: 4, footprintH: 1, blocks: true },
  { id: "lounge-flowers", asset: "PLANT_2/PLANT_2.png", col: 14, row: 11, width: 24, height: 32, footprintW: 2, footprintH: 1, blocks: true },
  { id: "lounge-plant", asset: "LARGE_PLANT/LARGE_PLANT.png", col: 24, row: 11, width: 32, height: 40, footprintW: 2, footprintH: 2, blocks: true },
  { id: "research-books", ownerRole: "researcher", asset: "DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png", col: 8, row: 3, width: 24, height: 48, footprintW: 1, footprintH: 2, blocks: true },
  { id: "research-flowers", ownerRole: "researcher", asset: "PLANT_2/PLANT_2.png", col: 8, row: 6, width: 20, height: 28, footprintW: 1, footprintH: 1, blocks: true },
  { id: "builder-board", ownerRole: "builder", asset: "WHITEBOARD/WHITEBOARD.png", col: 17, row: 3, width: 32, height: 32, footprintW: 1, footprintH: 2 },
  { id: "builder-clock", ownerRole: "builder", asset: "CLOCK/CLOCK.png", col: 17, row: 1, width: 12, height: 12, footprintW: 1, footprintH: 1 },
  { id: "documenter-books", ownerRole: "documenter", asset: "DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png", col: 26, row: 3, width: 24, height: 48, footprintW: 1, footprintH: 2, blocks: true },
  { id: "documenter-board", ownerRole: "documenter", asset: "WHITEBOARD/WHITEBOARD.png", col: 26, row: 6, width: 24, height: 24, footprintW: 1, footprintH: 1 },
  { id: "visual-board", ownerRole: "visual", asset: "WHITEBOARD/WHITEBOARD.png", col: 35, row: 3, width: 40, height: 36, footprintW: 2, footprintH: 2 },
  { id: "visual-plant", ownerRole: "visual", asset: "LARGE_PLANT/LARGE_PLANT.png", col: 36, row: 6, width: 28, height: 40, footprintW: 1, footprintH: 2, blocks: true },
  { id: "integrator-books", ownerRole: "integrator", asset: "DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png", col: 8, row: 18, width: 24, height: 48, footprintW: 1, footprintH: 2, blocks: true },
  { id: "integrator-flowers", ownerRole: "integrator", asset: "PLANT_2/PLANT_2.png", col: 8, row: 21, width: 20, height: 28, footprintW: 1, footprintH: 1, blocks: true },
  { id: "coordinator-board", ownerRole: "coordinator", asset: "WHITEBOARD/WHITEBOARD.png", col: 17, row: 18, width: 32, height: 32, footprintW: 1, footprintH: 2 },
  { id: "coordinator-clock", ownerRole: "coordinator", asset: "CLOCK/CLOCK.png", col: 17, row: 16, width: 12, height: 12, footprintW: 1, footprintH: 1 },
  { id: "qa-board", ownerRole: "qa", asset: "WHITEBOARD/WHITEBOARD.png", col: 26, row: 18, width: 32, height: 32, footprintW: 1, footprintH: 2 },
  { id: "qa-clock", ownerRole: "qa", asset: "CLOCK/CLOCK.png", col: 26, row: 16, width: 12, height: 12, footprintW: 1, footprintH: 1 },
  { id: "general-books", ownerRole: "general", asset: "DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png", col: 37, row: 18, width: 24, height: 48, footprintW: 1, footprintH: 2, blocks: true },
  { id: "general-flowers", ownerRole: "general", asset: "FLOWER/FLOWER.png", col: 37, row: 21, width: 20, height: 28, footprintW: 1, footprintH: 1, blocks: true },
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
  const scale = Math.min(item.width / naturalWidth, item.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  const footprintWidth = item.footprintW * TILE_SIZE;
  return {
    x: item.col * TILE_SIZE + (footprintWidth - width) / 2,
    y: (item.row + item.footprintH) * TILE_SIZE - height,
    width,
    height,
  };
}

export function furnitureSortDepth(item: FurniturePlacement): number {
  const surface = item.ownerRole && item.id.endsWith("-pc")
    ? FURNITURE.find((candidate) => candidate.ownerRole === item.ownerRole && candidate.id.endsWith("-desk"))
    : undefined;
  // A monitor sits ON the desk. Its elevated visual bottom must not sort it
  // behind the tabletop and hide the keyboard/stand.
  return surface ? (surface.row + surface.footprintH) * TILE_SIZE + 1 : (item.row + item.footprintH) * TILE_SIZE;
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
  for (const room of ROOM_LAYOUTS.filter((candidate) => candidate.role)) {
    const doors = new Set(roomDoorTiles(room).map(tileKey));
    for (let col = room.col; col <= room.col + room.width; col++) {
      for (const row of [room.row, room.row + room.height]) if (!doors.has(tileKey({ col, row }))) blocked.add(tileKey({ col, row }));
    }
    for (let row = room.row; row <= room.row + room.height; row++) {
      for (const col of [room.col, room.col + room.width]) blocked.add(tileKey({ col, row }));
    }
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

// One authored footfall per eight logical pixels. The gait pauses when the
// character stops instead of being driven by an unrelated global clock.
export function characterWalkFrame(distance: number): number {
  return Math.floor(Math.max(0, distance) / 8) % CHARACTER_FRAME_COLUMNS;
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
