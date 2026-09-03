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
  createBlockedTiles,
  directionBetween,
  findPath,
  furnitureVisualRect,
  isWalkable,
  tileKey,
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
    expect(findPath({ col: 3, row: 8 }, { col: 3, row: 2 }, blocked)).toEqual([]);
    expect(findPath({ col: 0, row: 5 }, { col: 4, row: 5 }, blocked)).toEqual([]);
  });
});

describe("pixel character animation", () => {
  it("uses a 512x1024 2x4 atlas and a 3:4 service character box", () => {
    expect(CHARACTER_FRAME_WIDTH).toBe(256);
    expect(CHARACTER_FRAME_HEIGHT).toBe(256);
    expect(CHARACTER_FRAME_WIDTH * CHARACTER_SHEET_COLUMNS).toBe(512);
    expect(CHARACTER_FRAME_HEIGHT * CHARACTER_STATE_ROWS).toBe(1024);
    expect(CHARACTER_DRAW_WIDTH / CHARACTER_DRAW_HEIGHT).toBe(3 / 4);
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
  it("uses intrinsic two-times-density sizes and bottom-aligns each footprint", () => {
    for (const item of FURNITURE) {
      const rect = furnitureVisualRect(item);
      expect(rect.width, item.id).toBe(item.width);
      expect(rect.height, item.id).toBe(item.height);
      expect(rect.y + rect.height, item.id).toBe((item.row + item.footprintH) * 16);
    }
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
