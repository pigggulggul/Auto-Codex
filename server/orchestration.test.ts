import { describe, expect, it } from "vitest";
import type { TaskDefinition } from "../shared/protocol.js";
import {
  createRunSnapshot,
  interruptRun,
  selectStartableTaskIds,
  transitionTask,
  validateTaskPlan,
} from "./orchestration.js";

const task = (overrides: Partial<TaskDefinition> & Pick<TaskDefinition, "id">): TaskDefinition => ({
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  description: overrides.description ?? `${overrides.id} 작업`,
  kind: overrides.kind ?? "research",
  access: overrides.access ?? "read",
  agentRole: overrides.agentRole ?? "researcher",
  dependsOn: overrides.dependsOn ?? [],
  order: overrides.order ?? 0,
  skillPath: overrides.skillPath,
  runAfterFailure: overrides.runAfterFailure,
});

describe("orchestration model", () => {
  it("rejects duplicate, unknown, and cyclic dependencies", () => {
    const invalid = [
      task({ id: "a", dependsOn: ["b"] }),
      task({ id: "b", dependsOn: ["a", "missing"] }),
      task({ id: "b" }),
    ];
    const issues = validateTaskPlan(invalid);
    expect(issues).toEqual(expect.arrayContaining([
      "중복 작업 ID: b",
      "작업 b의 알 수 없는 의존성: missing",
      "작업 의존성에 순환이 있습니다.",
    ]));
  });

  it("makes root tasks ready and assigns stable role agents", () => {
    const run = createRunSnapshot({
      id: "run-1",
      now: "2026-09-01T00:00:00.000Z",
      prompt: "조사 후 구현",
      mode: "team",
      tasks: [
        task({ id: "research", order: 1 }),
        task({ id: "build", access: "write", kind: "implementation", agentRole: "builder", dependsOn: ["research"], order: 2 }),
      ],
    });
    expect(run.tasks.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "research", status: "ready" },
      { id: "build", status: "queued" },
    ]);
    expect(run.agents.map((agent) => agent.id)).toEqual(["run-1:researcher", "run-1:builder"]);
  });

  it("starts independent read tasks in parallel up to the limit", () => {
    const run = createRunSnapshot({
      prompt: "병렬 조사",
      mode: "team",
      tasks: [task({ id: "a", order: 1 }), task({ id: "b", order: 2 }), task({ id: "c", order: 3 })],
    });
    expect(selectStartableTaskIds(run, 2)).toEqual(["a", "b"]);
    const withA = transitionTask(run, "a", "running");
    expect(selectStartableTaskIds(withA, 2)).toEqual(["b"]);
  });

  it("never overlaps a workspace writer with another active task", () => {
    const writerFirst = createRunSnapshot({
      prompt: "구현과 조사",
      mode: "team",
      tasks: [
        task({ id: "write", access: "write", kind: "implementation", agentRole: "builder", order: 1 }),
        task({ id: "read", order: 2 }),
      ],
    });
    expect(selectStartableTaskIds(writerFirst)).toEqual(["write"]);
    const writing = transitionTask(writerFirst, "write", "running");
    expect(selectStartableTaskIds(writing)).toEqual([]);

    const readerFirst = createRunSnapshot({
      prompt: "조사 후 구현",
      mode: "team",
      tasks: [
        task({ id: "read", order: 1 }),
        task({ id: "write", access: "write", kind: "implementation", agentRole: "builder", order: 2 }),
      ],
    });
    const reading = transitionTask(readerFirst, "read", "running");
    expect(selectStartableTaskIds(reading)).toEqual([]);
  });

  it("unlocks dependents on success and blocks them on failure", () => {
    const makeRun = () => createRunSnapshot({
      prompt: "조사 후 구현",
      mode: "team",
      tasks: [
        task({ id: "research", order: 1 }),
        task({ id: "build", access: "write", kind: "implementation", agentRole: "builder", dependsOn: ["research"], order: 2 }),
      ],
    });
    const runningSuccess = transitionTask(makeRun(), "research", "running");
    const succeeded = transitionTask(runningSuccess, "research", "completed");
    expect(succeeded.tasks.find((candidate) => candidate.id === "build")?.status).toBe("ready");

    const runningFailure = transitionTask(makeRun(), "research", "running");
    const failed = transitionTask(runningFailure, "research", "failed", { error: "source unavailable" });
    expect(failed.tasks.find((candidate) => candidate.id === "build")).toMatchObject({
      status: "blocked",
      error: "선행 작업이 완료되지 않았습니다.",
    });
    expect(failed.status).toBe("failed");
  });

  it("rejects illegal state transitions and interrupts every unfinished task", () => {
    const run = createRunSnapshot({ prompt: "작업", mode: "team", tasks: [task({ id: "a" }), task({ id: "b" })] });
    expect(() => transitionTask(run, "a", "completed")).toThrow("ready -> completed");
    const interrupted = interruptRun(transitionTask(run, "a", "running"), "2026-09-01T01:00:00.000Z");
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.tasks.every((candidate) => candidate.status === "interrupted")).toBe(true);
  });

  it("runs a settled-dependency report even after another task fails", () => {
    const run = createRunSnapshot({
      prompt: "실패도 보고",
      mode: "team",
      tasks: [
        task({ id: "work", order: 1 }),
        task({ id: "report", kind: "report", agentRole: "coordinator", dependsOn: ["work"], order: 2, runAfterFailure: true }),
      ],
    });
    const running = transitionTask(run, "work", "running");
    const failed = transitionTask(running, "work", "failed", { error: "boom" });
    expect(failed.tasks.find((candidate) => candidate.id === "report")?.status).toBe("ready");
    expect(failed.status).toBe("running");
  });
});
