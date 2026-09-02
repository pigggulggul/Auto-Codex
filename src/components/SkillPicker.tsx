import { useState } from "react";
import type { SkillInfo } from "../../shared/protocol";
import { classifySkill, SKILL_ROLE_DESCRIPTIONS, SKILL_ROLE_LABELS } from "../../shared/skill-catalog";
import { shortSkillName } from "../lib/petCatalog";

type Props = {
  skills: SkillInfo[];
  projectPath: string | null;
  mode: "auto" | "manual";
  selectedPath: string;
  disabled: boolean;
  onModeChange: (mode: "auto" | "manual") => void;
  onSkillChange: (path: string) => void;
  onRefresh: () => void;
};

function isProjectSkill(skill: SkillInfo, projectPath: string | null): boolean {
  const scope = skill.scope?.toLowerCase();
  if (scope) return scope === "repo" || scope === "repository" || scope === "project";
  if (!projectPath) return false;
  const normalize = (value: string) => value.replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
  return normalize(skill.path).startsWith(`${normalize(projectPath)}\\`);
}

export function SkillPicker({ skills, projectPath, mode, selectedPath, disabled, onModeChange, onSkillChange, onRefresh }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const enabled = skills.filter((skill) => skill.enabled);
  const projectSkills = enabled.filter((skill) => isProjectSkill(skill, projectPath));
  const visible = showAll ? enabled : projectSkills;
  return (
    <details className="control-section skill-control control-collapsible" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="section-heading">
        <div><span className="eyebrow">03 · ROUTING</span><h2>스킬 배정</h2></div>
        <span className="collapse-glyph" aria-hidden="true">⌄</span>
      </summary>
      <div className="control-section-body">
        <button className="section-refresh-button" type="button" onClick={onRefresh} disabled={disabled}>↻ 스킬 다시 읽기</button>
        <div className="segmented" role="group" aria-label="스킬 선택 방식">
        <button className={mode === "auto" ? "active" : ""} onClick={() => onModeChange("auto")} type="button">✦ Auto</button>
        <button className={mode === "manual" ? "active" : ""} onClick={() => onModeChange("manual")} type="button">Manual</button>
        </div>
        {mode === "auto" ? (
        <p className="helper-copy">업무와 설치된 스킬 설명을 비교해 Task마다 적합한 스킬을 배정합니다.</p>
      ) : (
        <>
          <div className="skill-list compact">
            <button type="button" className={`skill-option ${selectedPath === "" ? "selected" : ""}`} onClick={() => onSkillChange("")}>
              <span className="skill-avatar base">C</span>
              <span><strong>General agent</strong><small>{SKILL_ROLE_DESCRIPTIONS.general}</small></span>
            </button>
            {visible.map((skill) => {
              const role = classifySkill(skill);
              return (
                <button type="button" className={`skill-option ${selectedPath === skill.path ? "selected" : ""}`} onClick={() => onSkillChange(skill.path)} key={skill.path}>
                  <span className="skill-avatar">{skill.name.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{shortSkillName(skill.name)}</strong><small>{SKILL_ROLE_LABELS[role]} · {skill.shortDescription || skill.description}</small></span>
                </button>
              );
            })}
          </div>
          <button type="button" className="skill-scope-toggle" onClick={() => setShowAll((value) => !value)}>
            <span>{showAll ? "프로젝트 스킬만 보기" : "Codex 스킬 전체 보기"}</span><span>{showAll ? ">" : "<"}</span>
          </button>
        </>
        )}
        <div className="skill-count"><span>{enabled.length}</span> enabled skills</div>
      </div>
    </details>
  );
}
