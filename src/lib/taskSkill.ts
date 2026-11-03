import type { TaskDefinition } from "../../shared/protocol";

export function taskSkillLabel(task: TaskDefinition): string {
  return task.skillName ?? (task.skillPath ? "이전 기록의 스킬 이름 없음" : "없음");
}
