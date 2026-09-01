import type { SkillInfo, SkillRole } from "../../shared/protocol";
import { classifySkill, SKILL_ROLE_DESCRIPTIONS, SKILL_ROLE_LABELS } from "../../shared/skill-catalog";

export type CharacterId =
  | "coordinator"
  | "builder"
  | "researcher"
  | "documenter"
  | "visual"
  | "qa"
  | "integrator";

export type CharacterPresentation = {
  id: CharacterId;
  role: SkillRole;
  label: string;
  description: string;
};

export type CharacterAssignments = {
  roles: Partial<Record<SkillRole, CharacterId>>;
  skills: Record<string, CharacterId>;
};

export const CHARACTER_PRESENTATIONS: Record<CharacterId, CharacterPresentation> = {
  coordinator: { id: "coordinator", role: "general", label: "Coordinator", description: SKILL_ROLE_DESCRIPTIONS.general },
  builder: { id: "builder", role: "builder", label: "Builder", description: SKILL_ROLE_DESCRIPTIONS.builder },
  researcher: { id: "researcher", role: "researcher", label: "Researcher", description: SKILL_ROLE_DESCRIPTIONS.researcher },
  documenter: { id: "documenter", role: "documenter", label: "Documenter", description: SKILL_ROLE_DESCRIPTIONS.documenter },
  visual: { id: "visual", role: "visual", label: "Visual Designer", description: SKILL_ROLE_DESCRIPTIONS.visual },
  qa: { id: "qa", role: "qa", label: "QA Inspector", description: SKILL_ROLE_DESCRIPTIONS.qa },
  integrator: { id: "integrator", role: "integrator", label: "Integrator", description: SKILL_ROLE_DESCRIPTIONS.integrator },
};

export const CHARACTER_OPTIONS = Object.values(CHARACTER_PRESENTATIONS);

const DEFAULT_CHARACTER_BY_ROLE: Record<SkillRole, CharacterId> = {
  general: "coordinator",
  builder: "builder",
  researcher: "researcher",
  documenter: "documenter",
  visual: "visual",
  qa: "qa",
  integrator: "integrator",
};

const CHARACTER_IDS = new Set<CharacterId>(Object.keys(CHARACTER_PRESENTATIONS) as CharacterId[]);
const STORAGE_PREFIX = "auto-codex.character-assignments.";

export function emptyCharacterAssignments(): CharacterAssignments {
  return { roles: {}, skills: {} };
}

export function characterForRole(role: SkillRole, assignments: CharacterAssignments): CharacterId {
  return assignments.roles[role] && CHARACTER_IDS.has(assignments.roles[role] as CharacterId)
    ? assignments.roles[role] as CharacterId
    : DEFAULT_CHARACTER_BY_ROLE[role];
}

export function characterForSelection(skill: SkillInfo | null, role: SkillRole, assignments: CharacterAssignments): CharacterId {
  if (skill?.path && CHARACTER_IDS.has(assignments.skills[skill.path])) return assignments.skills[skill.path];
  return characterForRole(role, assignments);
}

export function roleForSkill(skill: SkillInfo | null): SkillRole {
  return skill ? classifySkill(skill) : "general";
}

export function roleLabel(role: SkillRole): string {
  return SKILL_ROLE_LABELS[role];
}

function storageKey(projectPath: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectPath)}`;
}

export function loadCharacterAssignments(projectPath: string | null): CharacterAssignments {
  if (!projectPath || typeof window === "undefined") return emptyCharacterAssignments();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(projectPath)) ?? "null") as Partial<CharacterAssignments> | null;
    if (!parsed) return emptyCharacterAssignments();
    const roles: Partial<Record<SkillRole, CharacterId>> = {};
    for (const [role, character] of Object.entries(parsed.roles ?? {})) {
      if (CHARACTER_IDS.has(character as CharacterId)) roles[role as SkillRole] = character as CharacterId;
    }
    const skills: Record<string, CharacterId> = {};
    for (const [path, character] of Object.entries(parsed.skills ?? {})) {
      if (CHARACTER_IDS.has(character as CharacterId)) skills[path] = character as CharacterId;
    }
    return { roles, skills };
  } catch {
    return emptyCharacterAssignments();
  }
}

export function saveCharacterAssignments(projectPath: string | null, assignments: CharacterAssignments): void {
  if (!projectPath || typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(projectPath), JSON.stringify(assignments));
}
