import type { SkillInfo } from "../shared/protocol.js";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { shortSkillIdentifier } from "../shared/skill-catalog.js";

export type SkillEntry = { cwd?: string; skills: SkillInfo[] };
const APP_SKILL_NAMES = new Set(["frontend-feature-delivery", "backend-feature-delivery", "product-ui-ux-design", "mobile-app-delivery", "run-evals"]);
const pathKey = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);

/** Folderless mode must not inherit repository-scoped or unknown-scope instructions. */
export function researchSkills(skills: SkillInfo[]): SkillInfo[] {
  const globalScopes = new Set(["user", "system", "admin"]);
  return skills.filter((skill) => skill.enabled && typeof skill.scope === "string" && globalScopes.has(skill.scope.toLowerCase()));
}

/** Prefer the selected project's catalog; append only known, physically contained app skills. */
export async function projectSkills(entries: SkillEntry[], project: string, appRoot: string): Promise<SkillInfo[]> {
  const sameRoot = pathKey(project) === pathKey(appRoot);
  const discovered = entries.filter((entry) => entry.cwd ? pathKey(entry.cwd) === pathKey(project) : sameRoot).flatMap((entry) => entry.skills);
  if (sameRoot) return discovered;
  const root = await realpath(appRoot);
  const fromAppRoot = (skill: SkillInfo) => {
    const name = shortSkillIdentifier(skill.name).toLowerCase();
    return skill.scope?.toLowerCase() === "repo" && APP_SKILL_NAMES.has(name)
      && pathKey(skill.path) === pathKey(path.join(root, ".agents", "skills", name, "SKILL.md"));
  };
  const selected = discovered.filter((skill) => !fromAppRoot(skill));
  const isLocalProjectSkill = (skill: SkillInfo) => skill.scope?.toLowerCase() === "repo"
    && pathKey(skill.path).startsWith(`${pathKey(project)}${path.sep}`);
  selected.sort((left, right) => Number(isLocalProjectSkill(right)) - Number(isLocalProjectSkill(left)));
  const names = new Set(selected.map((skill) => shortSkillIdentifier(skill.name).toLowerCase()));
  const result = [...selected];
  const appEntries = [...entries, { cwd: appRoot, skills: discovered.filter(fromAppRoot) }];
  for (const entry of appEntries) {
    if (!entry.cwd || pathKey(entry.cwd) !== pathKey(appRoot)) continue;
    for (const skill of entry.skills) {
      const name = shortSkillIdentifier(skill.name).toLowerCase();
      if (!skill.enabled || skill.scope?.toLowerCase() !== "repo" || !APP_SKILL_NAMES.has(name) || names.has(name)) continue;
      const expected = path.join(root, ".agents", "skills", name, "SKILL.md");
      let actual: string;
      try { actual = await realpath(skill.path); } catch { continue; }
      if (pathKey(actual) !== pathKey(expected)) continue;
      result.push({ ...skill, scope: "app" });
      names.add(name);
    }
  }
  return result;
}
