import type { SkillInfo } from "../shared/protocol.js";
import type { SkillRole } from "../shared/protocol.js";
import {
  AUTO_DEFAULT_SKILL_NAMES,
  autoSkillAllowed,
  classifySkill,
  inferPromptRole,
  shortSkillIdentifier,
  SKILL_ROLE_LABELS,
} from "../shared/skill-catalog.js";

export type RouteResult = {
  skill: SkillInfo | null;
  role: SkillRole;
  rationale: string;
  score: number;
};

const TERM_ALIASES: Record<string, string[]> = {
  image: ["image", "photo", "picture", "sprite", "illustration", "이미지", "사진", "그림", "스프라이트"],
  document: ["document", "docx", "word", "문서", "워드"],
  pdf: ["pdf", "피디에프"],
  presentation: ["presentation", "slides", "ppt", "deck", "발표", "슬라이드", "프레젠테이션"],
  spreadsheet: ["spreadsheet", "excel", "xlsx", "csv", "sheet", "엑셀", "스프레드시트", "시트"],
  browser: ["browser", "website", "page", "브라우저", "사이트", "웹페이지"],
  research: ["research", "sources", "citations", "조사", "리서치", "출처"],
  test: ["test", "spec", "vitest", "jest", "테스트"],
  deploy: ["deploy", "hosting", "release", "배포", "호스팅", "릴리즈"],
  security: ["security", "vulnerability", "audit", "보안", "취약점", "감사"],
};

function normalizedTerms(text: string): Set<string> {
  const lower = text.toLocaleLowerCase();
  const result = new Set(
    lower
      .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length > 1),
  );
  for (const [canonical, aliases] of Object.entries(TERM_ALIASES)) {
    if (aliases.some((alias) => lower.includes(alias))) result.add(canonical);
  }
  return result;
}

function skillTerms(skill: SkillInfo): Set<string> {
  const terms = normalizedTerms(`${skill.name} ${skill.description} ${skill.shortDescription ?? ""}`);
  for (const [canonical, aliases] of Object.entries(TERM_ALIASES)) {
    if (aliases.some((alias) => terms.has(alias))) terms.add(canonical);
  }
  return terms;
}

export function routeSkill(prompt: string, skills: SkillInfo[]): RouteResult {
  const available = skills.filter((skill) => skill.enabled && autoSkillAllowed(skill));
  if (available.length === 0) {
    return { skill: null, role: "general", rationale: "자동 선택 가능한 스킬이 없어 기본 에이전트로 진행합니다.", score: 0 };
  }

  const promptTerms = normalizedTerms(prompt);
  const promptRole = inferPromptRole(prompt);
  let best: { skill: SkillInfo; score: number; matches: string[] } | null = null;
  for (const skill of available) {
    const candidateTerms = skillTerms(skill);
    const matches = [...promptTerms].filter((term) => candidateTerms.has(term));
    const name = skill.name.toLocaleLowerCase();
    const directName = prompt.toLocaleLowerCase().includes(name) ? 5 : 0;
    const roleBonus = promptRole && classifySkill(skill) === promptRole.role ? 4 : 0;
    const score = directName + roleBonus + matches.reduce((sum, term) => sum + (TERM_ALIASES[term] ? 3 : 1), 0);
    if (!best || score > best.score) best = { skill, score, matches };
  }

  const bestRole = best ? classifySkill(best.skill) : "general";
  const explicitSkillMatch = best && prompt.toLocaleLowerCase().includes(best.skill.name.toLocaleLowerCase());
  if (best && best.score >= 2 && (!promptRole || bestRole === promptRole.role || explicitSkillMatch)) {
    const evidence = best.matches.slice(0, 3).join(", ");
    return {
      skill: best.skill,
      role: bestRole,
      rationale: evidence
        ? `요청의 핵심어(${evidence})가 ${SKILL_ROLE_LABELS[bestRole]} 역할과 스킬 설명에 일치했습니다.`
        : `요청에 스킬 이름(${best.skill.name})이 직접 포함되어 있습니다.`,
      score: best.score,
    };
  }

  if (promptRole) {
    const preferredNames = AUTO_DEFAULT_SKILL_NAMES[promptRole.role as Exclude<SkillRole, "general">] ?? [];
    const fallback = available.find((skill) => preferredNames.includes(shortSkillIdentifier(skill.name).toLocaleLowerCase()));
    if (fallback) {
      return {
        skill: fallback,
        role: promptRole.role,
        rationale: `${SKILL_ROLE_LABELS[promptRole.role]} 작업으로 판단해 기본 스킬(${fallback.name})을 선택했습니다.`,
        score: best?.score ?? promptRole.evidence.length,
      };
    }
    return {
      skill: null,
      role: promptRole.role,
      rationale: `${SKILL_ROLE_LABELS[promptRole.role]} 작업으로 판단했지만 사용할 수 있는 전용 스킬이 없어 기본 에이전트로 진행합니다.`,
      score: best?.score ?? promptRole.evidence.length,
    };
  }

  return {
    skill: null,
    role: "general",
    rationale: "뚜렷하게 일치하는 스킬이 없어 기본 Coordinator에 맡깁니다.",
    score: best?.score ?? 0,
  };
}
