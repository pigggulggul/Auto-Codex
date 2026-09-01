import { randomUUID } from "node:crypto";
import type {
  AgentRole,
  AgentSnapshot,
  AgentStatus,
  ExecutionMode,
  PetState,
  RunSnapshot,
  RunStatus,
  TaskDefinition,
  TaskNode,
  TaskStatus,
} from "../shared/protocol.js";

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["completed", "failed", "blocked", "interrupted"]);
const FAILED_DEPENDENCY_STATUSES = new Set<TaskStatus>(["failed", "blocked", "interrupted"]);
const ACTIVE_TASK_STATUSES = new Set<TaskStatus>(["running", "waitingApproval"]);

const AGENT_NAMES: Record<AgentRole, string> = {
  coordinator: "Coordinator",
  general: "Generalist",
  builder: "Builder",
  researcher: "Researcher",
  documenter: "Documenter",
  visual: "Visual Designer",
  qa: "QA Inspector",
  integrator: "Integrator",
};

const LEGAL_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  queued: new Set(["ready", "blocked", "interrupted"]),
  ready: new Set(["running", "blocked", "interrupted"]),
  running: new Set(["waitingApproval", "completed", "failed", "interrupted"]),
  waitingApproval: new Set(["running", "failed", "interrupted"]),
  completed: new Set(),
  failed: new Set(),
  blocked: new Set(),
  interrupted: new Set(),
};

export type TaskTransitionPatch = Partial<
  Pick<TaskNode, "threadId" | "turnId" | "resultSummary" | "error" | "startedAt" | "completedAt" | "attempt">
>;

export type CreateRunInput = {
  prompt: string;
  mode: ExecutionMode;
  tasks: TaskDefinition[];
  id?: string;
  now?: string;
};

function hasCycle(tasks: readonly TaskDefinition[]): boolean {
  const dependencies = new Map<string, string[]>();
  for (const task of tasks) {
    dependencies.set(task.id, [...new Set([...(dependencies.get(task.id) ?? []), ...task.dependsOn])]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const dependencyId of dependencies.get(taskId) ?? []) {
      if (dependencies.has(dependencyId) && visit(dependencyId)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  return tasks.some((task) => visit(task.id));
}

export function validateTaskPlan(tasks: readonly TaskDefinition[]): string[] {
  const issues: string[] = [];
  if (tasks.length === 0) issues.push("작업 계획에는 하나 이상의 작업이 필요합니다.");
  if (tasks.length > 8) issues.push("한 실행에서 작업은 최대 8개까지 허용됩니다.");

  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id.trim()) issues.push("모든 작업에는 비어 있지 않은 ID가 필요합니다.");
    if (ids.has(task.id)) issues.push(`중복 작업 ID: ${task.id}`);
    ids.add(task.id);
    if (!task.title.trim()) issues.push(`작업 ${task.id || "(ID 없음)"}의 제목이 비어 있습니다.`);
    if (!task.description.trim()) issues.push(`작업 ${task.id || "(ID 없음)"}의 설명이 비어 있습니다.`);
    if (task.dependsOn.includes(task.id)) issues.push(`작업 ${task.id}가 자기 자신을 의존합니다.`);
  }

  for (const task of tasks) {
    for (const dependencyId of task.dependsOn) {
      if (!ids.has(dependencyId)) issues.push(`작업 ${task.id}의 알 수 없는 의존성: ${dependencyId}`);
    }
  }
  if (hasCycle(tasks)) issues.push("작업 의존성에 순환이 있습니다.");
  return [...new Set(issues)];
}

function agentStatus(tasks: readonly TaskNode[]): AgentStatus {
  if (tasks.some((task) => task.status === "waitingApproval")) return "waitingApproval";
  if (tasks.some((task) => task.status === "running")) return "working";
  if (tasks.some((task) => task.status === "failed" || task.status === "blocked")) return "error";
  if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) return "completed";
  if (tasks.some((task) => task.status === "ready")) return "ready";
  return "idle";
}

function agentActivity(status: AgentStatus, currentTask: TaskNode | undefined, previous: AgentSnapshot): PetState {
  if (status === "waitingApproval") return "waitingApproval";
  if (status === "completed") return "success";
  if (status === "error") return "error";
  if (status === "ready") return "idle";
  if (status !== "working" || !currentTask) return "idle";
  if (previous.currentTaskId !== currentTask.id) return "thinking";
  return previous.activity === "success" || previous.activity === "error" || previous.activity === "idle"
    ? "thinking"
    : previous.activity;
}

function synchronizeAgents(agents: readonly AgentSnapshot[], tasks: readonly TaskNode[]): AgentSnapshot[] {
  return agents.map((agent) => {
    const assigned = tasks.filter((task) => task.agentId === agent.id);
    const current = assigned.find((task) => ACTIVE_TASK_STATUSES.has(task.status)) ?? null;
    const status = agentStatus(assigned);
    return {
      ...agent,
      status,
      activity: agentActivity(status, current ?? undefined, agent),
      currentTaskId: current?.id ?? null,
      threadId: current?.threadId ?? null,
      turnId: current?.turnId ?? null,
    };
  });
}

function deriveRunStatus(tasks: readonly TaskNode[], previous: RunStatus): RunStatus {
  if (previous === "interrupted") return "interrupted";
  if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) return "completed";
  if (tasks.length > 0 && tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))) return "failed";

  const active = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  if (active.some((task) => task.kind === "coordinate")) return "planning";
  if (active.length > 0 && active.every((task) => task.kind === "verification" || task.kind === "report")) {
    return "verifying";
  }
  return "running";
}

export function refreshRun(run: RunSnapshot, now = new Date().toISOString()): RunSnapshot {
  const byId = new Map(run.tasks.map((task) => [task.id, task]));
  let changed = true;
  let tasks = run.tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn] }));

  while (changed) {
    changed = false;
    const currentById = new Map(tasks.map((task) => [task.id, task]));
    tasks = tasks.map((task) => {
      if (task.status !== "queued") return task;
      const dependencies = task.dependsOn.map((id) => currentById.get(id) ?? byId.get(id));
      if (!task.runAfterFailure && dependencies.some((dependency) => dependency && FAILED_DEPENDENCY_STATUSES.has(dependency.status))) {
        changed = true;
        return { ...task, status: "blocked", completedAt: now, error: "선행 작업이 완료되지 않았습니다." };
      }
      const dependenciesReady = task.runAfterFailure
        ? dependencies.every((dependency) => dependency && TERMINAL_TASK_STATUSES.has(dependency.status))
        : dependencies.every((dependency) => dependency?.status === "completed");
      if (dependenciesReady) {
        changed = true;
        return { ...task, status: "ready" };
      }
      return task;
    });
  }

  const status = deriveRunStatus(tasks, run.status);
  return {
    ...run,
    status,
    completedAt: status === "completed" || status === "failed" || status === "interrupted" ? now : null,
    tasks,
    agents: synchronizeAgents(run.agents, tasks),
  };
}

export function createRunSnapshot(input: CreateRunInput): RunSnapshot {
  const issues = validateTaskPlan(input.tasks);
  if (issues.length > 0) throw new Error(issues.join("\n"));

  const id = input.id ?? randomUUID();
  const now = input.now ?? new Date().toISOString();
  const roles = [...new Set(input.tasks.map((task) => task.agentRole))];
  const agents: AgentSnapshot[] = roles.map((role) => ({
    id: `${id}:${role}`,
    role,
    name: AGENT_NAMES[role],
    status: "idle",
    activity: "idle",
    taskIds: input.tasks.filter((task) => task.agentRole === role).map((task) => task.id),
    currentTaskId: null,
    threadId: null,
    turnId: null,
  }));
  const agentByRole = new Map(agents.map((agent) => [agent.role, agent.id]));
  const tasks: TaskNode[] = input.tasks.map((task) => ({
    ...task,
    dependsOn: [...task.dependsOn],
    agentId: agentByRole.get(task.agentRole)!,
    status: "queued",
    attempt: 0,
    threadId: null,
    turnId: null,
    startedAt: null,
    completedAt: null,
  }));

  return refreshRun({
    id,
    prompt: input.prompt,
    mode: input.mode,
    status: "planning",
    createdAt: now,
    completedAt: null,
    tasks,
    agents,
  }, now);
}

export function selectStartableTaskIds(run: RunSnapshot, maxParallel = 3): string[] {
  if (maxParallel < 1) return [];
  const active = run.tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  if (active.some((task) => task.access === "write")) return [];

  const capacity = Math.max(0, maxParallel - active.length);
  if (capacity === 0) return [];
  const ready = run.tasks.filter((task) => task.status === "ready").sort((a, b) => a.order - b.order);
  if (ready.length === 0) return [];

  if (active.length > 0) return ready.filter((task) => task.access === "read").slice(0, capacity).map((task) => task.id);
  if (ready[0].access === "write") return [ready[0].id];
  return ready.filter((task) => task.access === "read").slice(0, capacity).map((task) => task.id);
}

export function transitionTask(
  run: RunSnapshot,
  taskId: string,
  nextStatus: TaskStatus,
  patch: TaskTransitionPatch = {},
  now = new Date().toISOString(),
): RunSnapshot {
  const task = run.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`알 수 없는 작업 ID: ${taskId}`);
  if (!LEGAL_TRANSITIONS[task.status].has(nextStatus)) {
    throw new Error(`허용되지 않는 작업 상태 전환: ${task.status} -> ${nextStatus}`);
  }

  const tasks = run.tasks.map((candidate) => {
    if (candidate.id !== taskId) return candidate;
    return {
      ...candidate,
      ...patch,
      status: nextStatus,
      attempt: nextStatus === "running" && candidate.status === "ready" ? candidate.attempt + 1 : (patch.attempt ?? candidate.attempt),
      startedAt: nextStatus === "running" && !candidate.startedAt ? now : (patch.startedAt ?? candidate.startedAt),
      completedAt: TERMINAL_TASK_STATUSES.has(nextStatus) ? (patch.completedAt ?? now) : (patch.completedAt ?? candidate.completedAt),
    };
  });
  return refreshRun({ ...run, tasks }, now);
}

export function updateTask(run: RunSnapshot, taskId: string, patch: TaskTransitionPatch): RunSnapshot {
  if (!run.tasks.some((task) => task.id === taskId)) throw new Error(`알 수 없는 작업 ID: ${taskId}`);
  const tasks = run.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task);
  return refreshRun({ ...run, tasks });
}

export function updateAgentActivity(run: RunSnapshot, agentId: string, activity: PetState): RunSnapshot {
  if (!run.agents.some((agent) => agent.id === agentId)) return run;
  return {
    ...run,
    agents: run.agents.map((agent) => agent.id === agentId ? { ...agent, activity } : agent),
  };
}

export function interruptRun(run: RunSnapshot, now = new Date().toISOString()): RunSnapshot {
  const tasks = run.tasks.map((task) =>
    TERMINAL_TASK_STATUSES.has(task.status)
      ? task
      : { ...task, status: "interrupted" as const, completedAt: now, error: task.error ?? "사용자가 실행을 중단했습니다." },
  );
  return refreshRun({ ...run, status: "interrupted", completedAt: now, tasks }, now);
}
