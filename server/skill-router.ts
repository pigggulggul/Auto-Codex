import type { SkillInfo } from "../shared/protocol.js";
import type { SkillRole } from "../shared/protocol.js";
import {
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
  image: ["image", "images", "imagegen", "photo", "picture", "sprite", "illustration", "이미지", "사진", "그림", "스프라이트"],
  document: ["document", "docx", "word", "문서", "워드"],
  pdf: ["pdf", "피디에프"],
  presentation: ["presentation", "slides", "ppt", "deck", "발표", "슬라이드", "프레젠테이션"],
  spreadsheet: ["spreadsheet", "spreadsheets", "excel", "xlsx", "csv", "sheet", "엑셀", "스프레드시트"],
  browser: ["browser", "website", "page", "브라우저", "사이트", "웹페이지"],
  research: ["research", "sources", "citations", "조사", "리서치", "출처"],
  test: ["test", "testing", "verify", "verification", "eval", "spec", "vitest", "jest", "테스트", "검증"],
  deploy: ["deploy", "hosting", "release", "배포", "호스팅", "릴리즈"],
  security: ["security", "vulnerability", "audit", "보안", "취약점", "감사"],
  mobile: ["mobile", "android", "ios", "모바일", "안드로이드", "아이폰", "스마트폰"],
  design: ["design", "ux", "디자인", "사용성"],
  frontend: ["frontend", "front-end", "프론트엔드", "프런트엔드", "화면"],
  backend: ["backend", "back-end", "백엔드"],
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
    if (aliases.some((alias) => /^[a-z0-9-]+$/.test(alias)
      ? new RegExp(`(?:^|[^a-z0-9])${alias}(?=$|[^a-z0-9])`).test(lower)
      : lower.includes(alias))) result.add(canonical);
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

export function routeSkill(prompt: string, skills: SkillInfo[], expectedRole?: SkillRole): RouteResult {
  const available = skills.filter((skill) => skill.enabled && autoSkillAllowed(skill));
  if (available.length === 0) {
    return { skill: null, role: "general", rationale: "자동 선택 가능한 스킬이 없어 기본 에이전트로 진행합니다.", score: 0 };
  }

  const promptTerms = normalizedTerms(prompt);
  const promptRole = expectedRole ? { role: expectedRole, evidence: [] } : inferPromptRole(prompt);
  const formats = ["pdf", "spreadsheet", "presentation"] as const;
  const requestedFormats = formats.filter((format) => promptTerms.has(format));
  let best: { skill: SkillInfo; score: number; matches: string[] } | null = null;
  for (const skill of available) {
    if (expectedRole && classifySkill(skill) !== expectedRole) continue;
    const candidateTerms = skillTerms(skill);
    if (requestedFormats.length && !requestedFormats.some((format) => candidateTerms.has(format))) continue;
    const matches = [...promptTerms].filter((term) => candidateTerms.has(term));
    const name = skill.name.toLocaleLowerCase();
    const directName = prompt.toLocaleLowerCase().includes(name) ? 5 : 0;
    const roleBonus = promptRole && classifySkill(skill) === promptRole.role ? 4 : 0;
    const shortName = shortSkillIdentifier(name);
    const domainBonus = (promptTerms.has("mobile") && shortName === "mobile-app-delivery")
      || (!promptTerms.has("mobile") && promptTerms.has("frontend") && shortName === "frontend-feature-delivery")
      || (promptTerms.has("backend") && shortName === "backend-feature-delivery") ? 8 : 0;
    const score = directName + roleBonus + domainBonus + matches.reduce((sum, term) => sum + (TERM_ALIASES[term] ? 3 : 1), 0);
    if ((directName > 0 || matches.length > 0) && (!best || score > best.score)) best = { skill, score, matches };
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
