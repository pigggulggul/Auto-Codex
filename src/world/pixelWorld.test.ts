import { describe, expect, it } from "vitest";
import {
  CHARACTER_DRAW_HEIGHT,
  CHARACTER_DRAW_WIDTH,
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  CHARACTER_SHEET_COLUMNS,
  CHARACTER_STATE_ROWS,
  REST_SPOTS,
  ROLE_ORDER,
  FURNITURE,
  ROOM_LAYOUTS,
  STATIONS,
  characterFrame,
  characterFrameDuration,
  characterStateRow,
  characterWalkFrame,
  createBlockedTiles,
  directionBetween,
  findPath,
  furnitureVisualRect,
  furnitureSortDepth,
  isWalkable,
  tileKey,
  roomDoorTiles,
  idleWanderTargets,
  isCommonArea,
} from "./pixelWorld";

describe("pixel world navigation", () => {
  it("keeps every runtime station walkable", () => {
    const blocked = createBlockedTiles();
    for (const role of ROLE_ORDER) {
      expect(isWalkable(STATIONS[role], blocked), role).toBe(true);
    }
  });

  it("finds a collision-free path from each rest spot to its station", () => {
    const blocked = createBlockedTiles();
    for (const role of ROLE_ORDER) {
      const path = findPath(REST_SPOTS[role], STATIONS[role], blocked);
      expect(path.length, role).toBeGreaterThan(0);
      expect(path.at(-1)).toEqual(STATIONS[role]);
      expect(path.every((point) => !blocked.has(tileKey(point))), role).toBe(true);
    }
  });

  it("does not route through furniture or exterior walls", () => {
    const blocked = createBlockedTiles();
    const desk = FURNITURE.find((item) => item.id === "researcher-desk")!;
    expect(findPath(REST_SPOTS.researcher, { col: desk.col, row: desk.row }, blocked)).toEqual([]);
    expect(findPath({ col: 0, row: 5 }, { col: 4, row: 5 }, blocked)).toEqual([]);
  });

  it("connects all offices through wide corridor-facing doors and blocks their walls", () => {
    const blocked = createBlockedTiles();
    for (const room of ROOM_LAYOUTS.filter((candidate) => candidate.role)) {
      expect(roomDoorTiles(room)).toHaveLength(2);
      expect(roomDoorTiles(room).every((door) => isWalkable(door, blocked)), room.id).toBe(true);
      expect(isWalkable({ col: room.col, row: room.row + 3 }, blocked), room.id).toBe(false);
      const route = findPath(STATIONS[room.role!], { col: 12, row: 12 }, blocked);
      expect(route.length, room.id).toBeGreaterThan(0);
      expect(route.some((point) => roomDoorTiles(room).some((door) => tileKey(door) === tileKey(point))), room.id).toBe(true);
    }
  });

  it("keeps idle agents and every wander destination outside offices with return routes", () => {
    const blocked = createBlockedTiles();
    expect(new Set(Object.values(REST_SPOTS).map(tileKey)).size).toBe(ROLE_ORDER.length);
    for (const role of ROLE_ORDER) {
      const rest = REST_SPOTS[role];
      expect(isCommonArea(rest), role).toBe(true);
      expect(findPath(STATIONS[role], rest, blocked).at(-1), role).toEqual(rest);
      const candidates = idleWanderTargets(role, blocked);
      expect(candidates.length).toBeGreaterThan(1);
      for (const target of candidates) {
        expect(isCommonArea(target), role).toBe(true);
        expect(isWalkable(target, blocked), role).toBe(true);
        expect(ROOM_LAYOUTS.filter((room) => room.role).some((room) => target.col >= room.col && target.col < room.col + room.width && target.row >= room.row && target.row < room.row + room.height), role).toBe(false);
        if (tileKey(rest) !== tileKey(target)) expect(findPath(rest, target, blocked).at(-1), role).toEqual(target);
      }
    }
  });
});

describe("pixel character animation", () => {
  it("ties alternating footfalls to travelled distance", () => {
    expect([0, 4, 8, 12, 16, 24].map(characterWalkFrame)).toEqual([0, 0, 1, 1, 0, 1]);
    expect(characterWalkFrame(-1)).toBe(0);
  });
  it("preserves the square source aspect and enough room for character detail", () => {
    expect(CHARACTER_FRAME_WIDTH).toBe(256);
    expect(CHARACTER_FRAME_HEIGHT).toBe(256);
    expect(CHARACTER_FRAME_WIDTH * CHARACTER_SHEET_COLUMNS).toBe(512);
    expect(CHARACTER_FRAME_HEIGHT * CHARACTER_STATE_ROWS).toBe(1024);
    expect(CHARACTER_DRAW_WIDTH / CHARACTER_DRAW_HEIGHT).toBe(CHARACTER_FRAME_WIDTH / CHARACTER_FRAME_HEIGHT);
    expect(CHARACTER_DRAW_HEIGHT).toBeGreaterThanOrEqual(40);
  });

  it("maps runtime activity onto the four authored state rows", () => {
    expect(characterStateRow("idle", false)).toBe(0);
    expect(characterStateRow("idle", true)).toBe(1);
    expect(characterStateRow("editing", false)).toBe(2);
    expect(characterStateRow("reading", false)).toBe(3);
    expect(characterStateRow("success", false)).toBe(0);
    expect(characterStateRow("error", false)).toBe(0);
    expect([0, 1]).toContain(characterFrame("idle", true, 0.5));
  });

  it("uses state-specific frame timing in both canvas and CSS renderers", () => {
    expect(characterFrameDuration("idle", false)).toBe(0.68);
    expect(characterFrameDuration("thinking", false)).toBe(0.42);
    expect(characterFrameDuration("editing", false)).toBe(0.28);
    expect(characterFrameDuration("idle", true)).toBe(0.16);
  });

  it("resolves four-connected movement direction", () => {
    expect(directionBetween({ col: 2, row: 2 }, { col: 3, row: 2 })).toBe("right");
    expect(directionBetween({ col: 2, row: 2 }, { col: 2, row: 1 })).toBe("up");
  });

  it("cycles every authored runtime state through more than one frame", () => {
    const states = ["idle", "connecting", "thinking", "reading", "editing", "running", "waitingApproval", "success", "error"] as const;
    for (const state of states) {
      const frames = new Set([0, 0.33, 0.73, 1.31].map((time) => characterFrame(state, false, time)));
      expect(frames.size, state).toBeGreaterThan(1);
    }
  });
});

describe("furniture visuals", () => {
  it("draws each monitor above its desk but behind the chair and seated agent", () => {
    for (const role of ROLE_ORDER) {
      const desk = FURNITURE.find((item) => item.id === `${role}-desk`)!;
      const pc = FURNITURE.find((item) => item.id === `${role}-pc`)!;
      const chair = FURNITURE.find((item) => item.id === `${role}-chair`)!;
      expect(furnitureSortDepth(pc)).toBeGreaterThan(furnitureSortDepth(desk));
      expect(furnitureSortDepth(pc)).toBeLessThan(furnitureSortDepth(chair));
    }
  });
  it("uses one PC overlay per clear desk and no extra cup below the coffee table", () => {
    for (const role of ROLE_ORDER) {
      expect(FURNITURE.filter((item) => item.ownerRole === role && item.id.endsWith("-desk"))).toHaveLength(1);
      expect(FURNITURE.filter((item) => item.ownerRole === role && item.id.endsWith("-pc"))).toHaveLength(1);
    }
    expect(FURNITURE.some((item) => item.id === "coffee")).toBe(false);
    expect(FURNITURE.find((item) => item.id === "lounge-table")?.footprintH).toBe(1);
  });
  it("honors per-room size limits and bottom-aligns each footprint", () => {
    for (const item of FURNITURE) {
      const rect = furnitureVisualRect(item);
      expect(rect.width, item.id).toBe(item.width);
      expect(rect.height, item.id).toBe(item.height);
      expect(rect.y + rect.height, item.id).toBe((item.row + item.footprintH) * 16);
    }
  });

  it("fits visible artwork proportionally instead of sizing transparent padding", () => {
    const sofa = FURNITURE.find((item) => item.id === "lounge-sofa-top")!;
    const rect = furnitureVisualRect(sofa, 150, 100);
    expect(rect.width).toBeLessThanOrEqual(sofa.width);
    expect(rect.height).toBeLessThanOrEqual(sofa.height);
    expect(rect.width / rect.height).toBe(1.5);
    expect(rect.width).toBeGreaterThan(48);
  });

  it("keeps every workstation visual inside its assigned room", () => {
    for (const item of FURNITURE.filter((candidate) => candidate.ownerRole)) {
      const room = ROOM_LAYOUTS.find((candidate) => candidate.role === item.ownerRole)!;
      const rect = furnitureVisualRect(item);
      expect(rect.x, item.id).toBeGreaterThanOrEqual(room.col * 16);
      expect(rect.y, item.id).toBeGreaterThanOrEqual(room.row * 16);
      expect(rect.x + rect.width, item.id).toBeLessThanOrEqual((room.col + room.width) * 16);
      expect(rect.y + rect.height, item.id).toBeLessThanOrEqual((room.row + room.height) * 16);
    }
  });
});
