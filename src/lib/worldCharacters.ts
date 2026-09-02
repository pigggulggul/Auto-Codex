import type { AgentRole } from "../../shared/protocol";
import { CHARACTER_ASSETS, ROLE_ORDER } from "../world/pixelWorld";

export type WorldCharacterAssignments = Partial<Record<AgentRole, number>>;

const STORAGE_KEY = "auto-codex.pixel-world.characters";

export function characterIndexForRole(
  role: AgentRole,
  assignments: WorldCharacterAssignments,
): number {
  const assigned = assignments[role];
  const fallback = Math.max(0, ROLE_ORDER.indexOf(role));
  const index = typeof assigned === "number" ? assigned : fallback;
  return ((index % CHARACTER_ASSETS.length) + CHARACTER_ASSETS.length) % CHARACTER_ASSETS.length;
}

export function loadWorldCharacterAssignments(): WorldCharacterAssignments {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "number"),
    ) as WorldCharacterAssignments;
  } catch {
    return {};
  }
}

export function saveWorldCharacterAssignments(assignments: WorldCharacterAssignments): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
}
