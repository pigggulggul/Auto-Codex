import type { AgentRole, SkillRole, TaskAccess, TaskDefinition, TaskKind } from "../shared/protocol.js";
import { validateTaskPlan } from "./orchestration.js";

const KINDS = new Set<TaskKind>([
  "coordinate", "research", "design", "implementation", "verification", "integration", "report",
]);
const ROLES = new Set<AgentRole>([
  "coordinator", "general", "builder", "researcher", "documenter", "visual", "qa", "integrator",
]);
const WRITING_KINDS = new Set<TaskKind>(["design", "implementation", "verification", "integration"]);

export const TASK_PLAN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "kind", "access", "agentRole", "dependsOn", "order"],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9-]{1,30}$" },
          title: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: "string", minLength: 1, maxLength: 500 },
          kind: { type: "string", enum: [...KINDS].filter((kind) => kind !== "coordinate" && kind !== "report") },
          access: { type: "string", enum: ["read", "write"] },
          agentRole: { type: "string", enum: [...ROLES].filter((role) => role !== "coordinator") },
          dependsOn: { type: "array", items: { type: "string" } },
          order: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
    },
  },
} as const;

function accessFor(kind: TaskKind, requested: TaskAccess): TaskAccess {
  if (WRITING_KINDS.has(kind)) return "write";
  return kind === "research" || kind === "report" || kind === "coordinate" ? "read" : requested;
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function parseTask(value: unknown, index: number): TaskDefinition {
  if (!value || typeof value !== "object") throw new Error(`계획의 ${index + 1}번째 작업이 객체가 아닙니다.`);
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string" || !/^[a-z][a-z0-9-]{1,30}$/.test(task.id) || task.id === "plan") {
    throw new Error(`계획의 ${index + 1}번째 작업 ID가 올바르지 않습니다.`);
  }
  if (typeof task.title !== "string" || !task.title.trim()) throw new Error(`작업 ${task.id}의 제목이 비어 있습니다.`);
  if (typeof task.description !== "string" || !task.description.trim()) throw new Error(`작업 ${task.id}의 설명이 비어 있습니다.`);
  if (typeof task.kind !== "string" || !KINDS.has(task.kind as TaskKind) || task.kind === "coordinate" || task.kind === "report") {
    throw new Error(`작업 ${task.id}의 종류가 올바르지 않습니다.`);
  }
  if (typeof task.agentRole !== "string" || !ROLES.has(task.agentRole as AgentRole) || task.agentRole === "coordinator") {
    throw new Error(`작업 ${task.id}의 역할이 올바르지 않습니다.`);
  }
  if (task.access !== "read" && task.access !== "write") throw new Error(`작업 ${task.id}의 접근 유형이 올바르지 않습니다.`);
  if (!Array.isArray(task.dependsOn) || !task.dependsOn.every((id) => typeof id === "string")) {
    throw new Error(`작업 ${task.id}의 의존성 형식이 올바르지 않습니다.`);
  }
  if (typeof task.order !== "number" || !Number.isInteger(task.order)) throw new Error(`작업 ${task.id}의 순서가 올바르지 않습니다.`);
  return {
    id: task.id,
    title: task.title.trim().slice(0, 80),
    description: task.description.trim().slice(0, 500),
    kind: task.kind as TaskKind,
    access: accessFor(task.kind as TaskKind, task.access),
    agentRole: task.agentRole as AgentRole,
    dependsOn: [...new Set(task.dependsOn as string[])],
    order: task.order,
  };
}

function addControlTasks(tasks: TaskDefinition[]): TaskDefinition[] {
  const used = new Set(["plan", ...tasks.map((task) => task.id)]);
  const withPlanDependency = tasks.map((task) => ({
    ...task,
    dependsOn: task.dependsOn.length > 0 ? [...task.dependsOn] : ["plan"],
  }));
  const writeTasks = withPlanDependency.filter((task) => task.access === "write");
  let executionTasks = withPlanDependency;

  let verification = executionTasks.find((task) => task.kind === "verification");
  if (writeTasks.length > 0 && !verification) {
    const id = uniqueId("verify", used);
    used.add(id);
    verification = {
      id,
      title: "결과 검증",
      description: "완료된 변경을 검사하고 관련 타입 검사, 테스트, 빌드를 실행해 오류와 회귀를 확인합니다.",
      kind: "verification",
      access: "write",
      agentRole: "qa",
      dependsOn: executionTasks.map((task) => task.id),
      order: Math.max(...executionTasks.map((task) => task.order), 0) + 1,
    };
    executionTasks = [...executionTasks, verification];
  } else if (verification) {
    const dependencies = executionTasks
      .filter((task) => task.id !== verification?.id && task.kind !== "report")
      .map((task) => task.id);
    executionTasks = executionTasks.map((task) => task.id === verification?.id
      ? { ...task, access: "write", agentRole: "qa", dependsOn: [...new Set([...task.dependsOn, ...dependencies])] }
      : task);
  }

  const reportId = uniqueId("report", used);
  const report: TaskDefinition = {
    id: reportId,
    title: "결과 종합 보고",
    description: "모든 작업의 성공, 실패, 차단 원인과 검증 결과를 빠짐없이 종합해 사용자에게 최종 보고합니다.",
    kind: "report",
    access: "read",
    agentRole: "coordinator",
    dependsOn: executionTasks.map((task) => task.id),
    order: Math.max(...executionTasks.map((task) => task.order), 0) + 1,
    runAfterFailure: true,
  };
  return [
    {
      id: "plan",
      title: "요청 분석 및 역할 배정",
      description: "사용자 요청을 독립적인 작업으로 나누고 역할, 의존성, 안전한 실행 순서를 결정합니다.",
      kind: "coordinate",
      access: "read",
      agentRole: "coordinator",
      dependsOn: [],
      order: 0,
    },
    ...executionTasks,
    report,
  ];
}

export function parseTaskPlan(text: string): TaskDefinition[] {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(clean) as { tasks?: unknown };
  if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0 || parsed.tasks.length > 5) {
    throw new Error("Coordinator가 반환한 작업 배열의 크기가 올바르지 않습니다.");
  }
  const tasks = parsed.tasks.map(parseTask);
  const issues = validateTaskPlan(tasks);
  if (issues.length > 0) throw new Error(issues.join("\n"));
  const expanded = addControlTasks(tasks);
  const expandedIssues = validateTaskPlan(expanded);
  if (expandedIssues.length > 0) throw new Error(expandedIssues.join("\n"));
  return expanded;
}

function readOnlyRequest(prompt: string): boolean {
  const lower = prompt.toLocaleLowerCase();
  const explicitReadOnlySignals = [
    "읽기 전용",
    "수정하지 마",
    "수정하지마",
    "수정하지 말",
    "변경하지 마",
    "변경하지마",
    "변경하지 말",
    "파일을 건드리지",
    "파일은 건드리지",
    "do not modify",
    "don't modify",
    "without modifying",
    "read-only",
    "read only",
    "no file changes",
  ];
  if (explicitReadOnlySignals.some((signal) => lower.includes(signal))) return true;
  const readSignals = ["설명", "알려", "조사", "분석", "검토", "리뷰", "요약", "explain", "research", "review", "analyze"];
  const writeSignals = ["만들", "구현", "수정", "추가", "삭제", "바꿔", "작성", "개발", "build", "implement", "fix", "create", "update"];
  return readSignals.some((signal) => lower.includes(signal)) && !writeSignals.some((signal) => lower.includes(signal));
}

export function fallbackTaskPlan(prompt: string, preferredRole: SkillRole = "builder", skillPath?: string): TaskDefinition[] {
  if (readOnlyRequest(prompt)) {
    const readRole = preferredRole === "researcher" || preferredRole === "documenter" || preferredRole === "qa"
      ? preferredRole
      : "researcher";
    return addControlTasks([{
      id: "research",
      title: "요청 조사 및 분석",
      description: "프로젝트와 관련 자료를 읽고 근거가 있는 답을 정리합니다.",
      kind: "research",
      access: "read",
      agentRole: readRole,
      dependsOn: [],
      order: 1,
      skillPath,
    }]);
  }
  return addControlTasks([
    {
      id: "inspect",
      title: "현황 조사",
      description: "관련 코드와 구조를 읽고 변경 범위, 제약, 위험 요소를 확인합니다.",
      kind: "research",
      access: "read",
      agentRole: "researcher",
      dependsOn: [],
      order: 1,
    },
    {
      id: "implement",
      title: "요청 구현",
      description: "조사 결과와 프로젝트 규칙에 따라 사용자 요청을 구현합니다.",
      kind: preferredRole === "integrator" ? "integration" : preferredRole === "visual" ? "design" : "implementation",
      access: "write",
      agentRole: preferredRole === "general" ? "builder" : preferredRole,
      dependsOn: ["inspect"],
      order: 2,
      skillPath,
    },
  ]);
}
