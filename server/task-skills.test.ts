import { describe, expect, it } from "vitest";
import type { SkillInfo, TaskDefinition } from "../shared/protocol.js";
import { assignTaskSkills } from "./task-skills.js";

const frontend: SkillInfo = { name: "frontend-feature-delivery", description: "Implement frontend UI features", path: "frontend", enabled: true };
const qa: SkillInfo = { name: "run-evals", description: "Run verification and tests", path: "qa", enabled: true };
const tasks: TaskDefinition[] = [
  { id: "research", title: "조사", description: "자료 조사", kind: "research", access: "read", agentRole: "researcher", dependsOn: [], order: 1 },
  { id: "build", title: "frontend 구현", description: "frontend UI 기능 구현", kind: "implementation", access: "write", agentRole: "builder", dependsOn: [], order: 2 },
  { id: "verify", title: "결과 검증", description: "테스트를 실행합니다", kind: "verification", access: "write", agentRole: "qa", dependsOn: [], order: 3 },
];

describe("team skill assignment", () => {
  it("assigns verification skills in auto mode and preserves a compatible role", () => {
    const result = assignTaskSkills(tasks, [frontend, qa], "auto", null);
    expect(result.find((task) => task.id === "build")?.skillName).toBe(frontend.name);
    expect(result.find((task) => task.id === "verify")).toMatchObject({ skillName: qa.name, skillPath: qa.path });
    expect(result.find((task) => task.id === "research")?.skillPath).toBeUndefined();
  });

  it("manual mode assigns the chosen skill only to a compatible task", () => {
    const result = assignTaskSkills(tasks, [frontend, qa], "manual", qa);
    expect(result.filter((task) => task.skillPath).map((task) => task.id)).toEqual(["verify"]);
    expect(assignTaskSkills(tasks, [frontend, qa], "manual", null).every((task) => !task.skillPath)).toBe(true);
    expect(assignTaskSkills(tasks.slice(0, 2), [qa], "manual", qa).every((task) => !task.skillPath)).toBe(true);
  });
});
