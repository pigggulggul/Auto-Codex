import { useState } from "react";
import type { SkillInfo } from "../../shared/protocol";
import { classifySkill, SKILL_ROLE_DESCRIPTIONS } from "../../shared/skill-catalog";
import {
  CHARACTER_OPTIONS,
  characterForSelection,
  roleLabel,
  type CharacterAssignments,
  type CharacterId,
} from "../lib/characterCatalog";
import { shortSkillName } from "../lib/petCatalog";

type Props = {
  skills: SkillInfo[];
  projectPath: string | null;
  mode: "auto" | "manual";
  selectedPath: string;
  disabled: boolean;
  onModeChange: (mode: "auto" | "manual") => void;
  onSkillChange: (path: string) => void;
  characterAssignments: CharacterAssignments;
  onSkillCharacterChange: (path: string, character: CharacterId) => void;
  onRoleCharacterChange: (role: ReturnType<typeof classifySkill>, character: CharacterId) => void;
  onRefresh: () => void;
};

function isProjectSkill(skill: SkillInfo, projectPath: string | null): boolean {
  const scope = skill.scope?.toLowerCase();
  if (scope) return scope === "repo" || scope === "repository" || scope === "project";
  if (!projectPath) return false;

  const normalize = (value: string) => value.replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
  const skillPath = normalize(skill.path);
  const rootPath = normalize(projectPath);
  return skillPath.startsWith(`${rootPath}\\`);
}

function skillScopeLabel(scope?: string): string {
  switch (scope?.toLowerCase()) {
    case "repo":
    case "repository":
    case "project":
      return "Project";
    case "user":
      return "User";
    case "system":
      return "System";
    case "admin":
      return "Admin";
    default:
      return "Codex";
  }
}

export function SkillPicker({
  skills,
  projectPath,
  mode,
  selectedPath,
  disabled,
  onModeChange,
  onSkillChange,
  characterAssignments,
  onSkillCharacterChange,
  onRoleCharacterChange,
  onRefresh,
}: Props) {
  const [showAllCodexSkills, setShowAllCodexSkills] = useState(false);
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const projectSkills = enabledSkills.filter((skill) => isProjectSkill(skill, projectPath));
  const visibleSkills = showAllCodexSkills ? enabledSkills : projectSkills;
  const shownSkillCount = mode === "auto" || showAllCodexSkills ? enabledSkills.length : projectSkills.length;
  const shownSkillLabel = mode === "auto" || showAllCodexSkills ? " Codex skills" : " project skills";

  return (
    <div className="control-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">02 · ROUTING</span>
          <h2>스킬 배정</h2>
        </div>
        <button className="icon-button" type="button" onClick={onRefresh} disabled={disabled} title="스킬 다시 읽기">↻</button>
      </div>
      <div className="segmented" role="group" aria-label="스킬 선택 방식">
        <button className={mode === "auto" ? "active" : ""} onClick={() => onModeChange("auto")} type="button">
          <span>✦</span> Auto
        </button>
        <button className={mode === "manual" ? "active" : ""} onClick={() => onModeChange("manual")} type="button">
          Manual
        </button>
      </div>
      {mode === "auto" ? (
        <p className="helper-copy">요청과 스킬 설명을 비교해 가장 관련 있는 캐릭터를 배정합니다. 애매하면 기본 Codex가 맡아요.</p>
      ) : (
        <>
          <div className="skill-list">
            <div className="skill-option-row">
              <button
                type="button"
                className={`skill-option ${selectedPath === "" ? "selected" : ""}`}
                onClick={() => onSkillChange("")}
              >
                <span className="skill-avatar base">C</span>
                <span><strong>General agent</strong><small>스킬 없이 Codex에 맡기기 · {SKILL_ROLE_DESCRIPTIONS.general}</small></span>
              </button>
              <select
                className="character-select"
                value={characterForSelection(null, "general", characterAssignments)}
                onChange={(event) => onRoleCharacterChange("general", event.target.value as CharacterId)}
                disabled={disabled}
                aria-label="General agent 캐릭터 배정"
              >
                {CHARACTER_OPTIONS.map((character) => <option key={character.id} value={character.id}>{character.label}</option>)}
              </select>
            </div>
            {visibleSkills.map((skill) => (
              <div className="skill-option-row" key={skill.path}>
                <button
                  type="button"
                  className={`skill-option ${selectedPath === skill.path ? "selected" : ""}`}
                  onClick={() => onSkillChange(skill.path)}
                >
                  <span className="skill-avatar">{skill.name.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{shortSkillName(skill.name)}</strong>
                    <small>{skill.shortDescription || skill.description} · {roleLabel(classifySkill(skill))}{showAllCodexSkills ? ` · ${skillScopeLabel(skill.scope)}` : ""}</small>
                  </span>
                </button>
                <select
                  className="character-select"
                  value={characterForSelection(skill, classifySkill(skill), characterAssignments)}
                  onChange={(event) => onSkillCharacterChange(skill.path, event.target.value as CharacterId)}
                  disabled={disabled}
                  aria-label={`${shortSkillName(skill.name)} 캐릭터 배정`}
                >
                  {CHARACTER_OPTIONS.map((character) => <option key={character.id} value={character.id}>{character.label}</option>)}
                </select>
              </div>
            ))}
          </div>
          {projectSkills.length === 0 && !showAllCodexSkills && (
            <p className="skill-empty">이 프로젝트에 등록된 스킬이 없습니다.</p>
          )}
          <button
            type="button"
            className="skill-scope-toggle"
            aria-expanded={showAllCodexSkills}
            onClick={() => setShowAllCodexSkills((current) => !current)}
          >
            <span>{showAllCodexSkills ? "프로젝트 스킬만 보기" : "Codex 스킬 전체 보기"}</span>
            <span aria-hidden="true">{showAllCodexSkills ? ">" : "<"}</span>
          </button>
        </>
      )}
      <div className="skill-count"><span>{shownSkillCount}</span>{shownSkillLabel}</div>
    </div>
  );
}
