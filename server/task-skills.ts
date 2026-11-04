import type { SkillInfo, TaskDefinition } from "../shared/protocol.js";
import { classifySkill } from "../shared/skill-catalog.js";
import { routeContextualSkill } from "./skill-context.js";
import { isSkillExcluded } from "./skill-routing-intent.js";

/** Manual mode assigns the selected skill at most once, to a compatible role. */
export function assignTaskSkills(
  tasks: TaskDefinition[], skills: SkillInfo[], mode: "auto" | "manual", selected: SkillInfo | null,
  context: { currentRequest: string; previousRequest: string } = { currentRequest: "", previousRequest: "" },
): TaskDefinition[] {
  let assigned = false;
  return tasks.map((task) => {
    if (task.kind === "coordinate" || task.kind === "report") return task;
    if (mode === "manual") {
      if (!selected || !selected.enabled || assigned || isSkillExcluded(context.currentRequest, selected, skills) || task.agentRole !== classifySkill(selected)) return task;
      assigned = true;
      return { ...task, skillPath: selected.path, skillName: selected.name, skillRationale: "사용자가 선택한 스킬을 같은 역할의 작업에 배정했습니다." };
    }
    const expectedRole = task.agentRole === "general" || task.agentRole === "coordinator" ? undefined : task.agentRole;
    const routed = routeContextualSkill(`${task.title}\n${task.description}`, skills, { ...context, expectedRole });
    if (!routed.skill || (task.agentRole !== routed.role && task.agentRole !== "general")) return task;
    return { ...task, skillPath: routed.skill.path, skillName: routed.skill.name, skillRationale: routed.rationale };
  });
}
