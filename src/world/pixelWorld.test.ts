import { describe, expect, it } from "vitest";
import {
  REST_SPOTS,
  ROLE_ORDER,
  STATIONS,
  characterFrame,
  createBlockedTiles,
  directionBetween,
  findPath,
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
  it("uses the authored typing and reading frame ranges", () => {
    expect([3, 4]).toContain(characterFrame("editing", false, 0.5));
    expect([5, 6]).toContain(characterFrame("reading", false, 0.5));
    expect([0, 1, 2]).toContain(characterFrame("idle", true, 0.5));
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
