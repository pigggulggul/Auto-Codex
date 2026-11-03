import { describe, expect, it } from "vitest";
import type { SkillInfo } from "../shared/protocol.js";
import path from "node:path";
import { projectSkills, researchSkills } from "./skill-discovery.js";

describe("folderless skill discovery", () => {
  it("includes enabled user, system, and admin skills only", () => {
    const skill = (name: string, scope?: string, enabled = true): SkillInfo => ({ name, description: "synthetic", path: name, scope, enabled });
    expect(researchSkills([skill("user", "User"), skill("system", "system"), skill("admin", "admin"), skill("repo", "repo"), skill("unknown"), skill("disabled", "user", false)]).map((s) => s.name)).toEqual(["user", "system", "admin"]);
  });
});

describe("app skills available to other projects", () => {
  it("prefers project skills and appends only known app skills with verified paths", async () => {
    const root = process.cwd(), project = path.join(root, ".cache", "synthetic-other-project");
    const make = (name: string, skillPath: string, scope = "repo"): SkillInfo => ({ name, path: skillPath, scope, enabled: true, description: "synthetic" });
    const valid = path.join(root, ".agents", "skills", "mobile-app-delivery", "SKILL.md");
    const selected = make("frontend-feature-delivery", "project-frontend");
    const result = await projectSkills([
      { cwd: project, skills: [make("mobile-app-delivery", valid), selected] },
      { cwd: root, skills: [make("mobile-app-delivery", valid), make("frontend-feature-delivery", valid), make("unknown-skill", valid), make("run-evals", valid)] },
      { cwd: path.join(root, "other"), skills: [make("mobile-app-delivery", valid)] },
      { skills: [make("ambiguous-origin", valid)] },
    ], project, root);
    expect(result.map((s) => [s.name, s.path, s.scope])).toEqual([
      ["frontend-feature-delivery", "project-frontend", "repo"],
      ["mobile-app-delivery", valid, "app"],
    ]);
  });

  it("prefers a local project skill even when an app skill appears earlier in its catalog", async () => {
    const root = process.cwd(), project = path.join(root, ".cache", "synthetic-project");
    const name = "mobile-app-delivery";
    const make = (skillPath: string): SkillInfo => ({ name, path: skillPath, scope: "repo", enabled: true, description: "synthetic" });
    const appPath = path.join(root, ".agents", "skills", name, "SKILL.md");
    const localPath = path.join(project, ".agents", "skills", name, "SKILL.md");
    const result = await projectSkills([{ cwd: project, skills: [make(appPath), make(localPath)] }, { cwd: root, skills: [make(appPath)] }], project, root);
    expect(result.map((skill) => skill.path)).toEqual([localPath]);
  });
});
