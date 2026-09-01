import { describe, expect, it } from "vitest";
import { fallbackTaskPlan, parseTaskPlan, TASK_PLAN_OUTPUT_SCHEMA } from "./task-planner.js";

describe("task planner", () => {
  it("uses only the supported array keywords in the structured output schema", () => {
    const taskItems = TASK_PLAN_OUTPUT_SCHEMA.properties.tasks.items;
    expect(taskItems.properties.dependsOn).toEqual({ type: "array", items: { type: "string" } });
  });

  it("adds planning, verification, and reporting around a write plan", () => {
    const tasks = parseTaskPlan(JSON.stringify({ tasks: [{
      id: "build-ui",
      title: "UI 구현",
      description: "픽셀 UI를 구현합니다.",
      kind: "implementation",
      access: "read",
      agentRole: "builder",
      dependsOn: [],
      order: 1,
    }] }));
    expect(tasks.map((task) => task.kind)).toEqual(["coordinate", "implementation", "verification", "report"]);
    expect(tasks.find((task) => task.id === "build-ui")).toMatchObject({ access: "write", dependsOn: ["plan"] });
    expect(tasks.find((task) => task.kind === "verification")?.dependsOn).toContain("build-ui");
    expect(tasks.at(-1)?.dependsOn).toEqual(expect.arrayContaining(["build-ui", "verify"]));
  });

  it("keeps independent read tasks parallel after planning", () => {
    const tasks = parseTaskPlan(JSON.stringify({ tasks: [
      { id: "research-a", title: "A 조사", description: "A를 읽습니다.", kind: "research", access: "read", agentRole: "researcher", dependsOn: [], order: 1 },
      { id: "research-b", title: "B 조사", description: "B를 읽습니다.", kind: "research", access: "read", agentRole: "documenter", dependsOn: [], order: 2 },
    ] }));
    expect(tasks.filter((task) => task.kind === "research").every((task) => task.dependsOn.includes("plan"))).toBe(true);
    expect(tasks.some((task) => task.kind === "verification")).toBe(false);
  });

  it("rejects unknown dependencies and reserved task IDs", () => {
    expect(() => parseTaskPlan(JSON.stringify({ tasks: [{
      id: "work", title: "작업", description: "작업", kind: "research", access: "read", agentRole: "researcher", dependsOn: ["missing"], order: 1,
    }] }))).toThrow("알 수 없는 의존성");
    expect(() => parseTaskPlan(JSON.stringify({ tasks: [{
      id: "plan", title: "작업", description: "작업", kind: "research", access: "read", agentRole: "researcher", dependsOn: [], order: 1,
    }] }))).toThrow("ID가 올바르지 않습니다");
  });

  it("uses a safe deterministic fallback for write requests", () => {
    const tasks = fallbackTaskPlan("화면을 수정하고 기능을 구현해줘", "visual", "C:/skills/imagegen/SKILL.md");
    expect(tasks.map((task) => task.id)).toEqual(["plan", "inspect", "implement", "verify", "report"]);
    expect(tasks.find((task) => task.id === "implement")).toMatchObject({
      kind: "design",
      access: "write",
      agentRole: "visual",
      skillPath: "C:/skills/imagegen/SKILL.md",
    });
  });

  it("honors explicit no-write language before matching mutation keywords", () => {
    const tasks = fallbackTaskPlan("구조를 분석해서 알려줘. 파일은 수정하지 마.", "builder");
    expect(tasks.map((task) => task.id)).toEqual(["plan", "research", "report"]);
    expect(tasks.every((task) => task.access === "read")).toBe(true);
    expect(tasks.find((task) => task.id === "research")?.agentRole).toBe("researcher");
  });
});
