import type { SkillInfo, SkillRole } from "./protocol.js";

export const SKILL_ROLE_LABELS: Record<SkillRole, string> = {
  general: "Coordinator",
  builder: "Builder",
  researcher: "Researcher",
  documenter: "Documenter",
  visual: "Visual Designer",
  qa: "QA Inspector",
  integrator: "Integrator",
};

export const SKILL_ROLE_DESCRIPTIONS: Record<SkillRole, string> = {
  general: "범용 요청과 작업 조율",
  builder: "코드 작성·수정과 기능 구현",
  researcher: "자료 조사·브라우징·출처 확인",
  documenter: "PDF·문서·표·발표자료 작업",
  visual: "이미지·시각화·스프라이트 작업",
  qa: "테스트·검토·검증과 릴리스 준비",
  integrator: "외부 서비스·MCP·배포 연결",
};

const SKILL_ROLE_TERMS: Record<Exclude<SkillRole, "general">, string[]> = {
  builder: [
    "frontend", "backend", "fullstack", "feature", "code", "coding", "developer", "architecture", "implement",
    "개발", "코드", "구현", "기능", "화면", "프론트", "백엔드", "리팩터링", "버그", "수정",
  ],
  researcher: [
    "research", "browser", "web", "source", "citation", "search", "조사", "리서치", "검색", "출처", "브라우징", "자료",
  ],
  documenter: [
    "pdf", "document", "docx", "word", "spreadsheet", "excel", "csv", "presentation", "slides", "ppt", "문서", "보고서", "엑셀", "발표자료",
  ],
  visual: [
    "image", "imagegen", "visual", "visualize", "sprite", "illustration", "design", "chart", "이미지", "그림", "스프라이트", "시각화", "차트", "디자인",
  ],
  qa: [
    "test", "testing", "eval", "review", "verify", "validation", "quality", "release", "readiness", "테스트", "검증", "리뷰", "점검", "릴리스",
  ],
  integrator: [
    "mcp", "connector", "integration", "deploy", "hosting", "site", "supabase", "api", "배포", "호스팅", "연동", "통합", "외부 서비스",
  ],
};

const PROMPT_ROLE_TERMS: Record<Exclude<SkillRole, "general">, string[]> = {
  builder: ["개발", "코드", "구현", "기능", "화면", "만들어", "만들고", "수정", "고쳐", "리팩터링", "버그", "frontend", "backend", "fullstack"],
  researcher: ["조사", "분석", "설명", "요약", "리서치", "검색", "출처", "자료", "찾아", "찾고", "브라우저", "웹에서", "research", "analyze", "explain", "summary", "sources", "citations"],
  documenter: ["pdf", "문서", "보고서", "워드", "엑셀", "스프레드시트", "발표자료", "슬라이드", "docx", "xlsx", "ppt"],
  visual: ["이미지", "그림", "스프라이트", "시각화", "차트", "디자인", "캐릭터", "image", "sprite", "visualize", "illustration"],
  qa: ["테스트", "검증", "리뷰", "점검", "확인해", "품질", "배포 전", "test", "review", "verify", "audit"],
  integrator: ["배포", "호스팅", "연동", "통합", "mcp", "api", "supabase", "외부 서비스", "deploy", "hosting"],
};

export const AUTO_DEFAULT_SKILL_NAMES: Record<Exclude<SkillRole, "general">, string[]> = {
  builder: [
    "fullstack-feature-delivery",
    "frontend-feature-delivery",
    "backend-feature-delivery",
    "service-architecture-and-slicing",
    "web-product-planning",
  ],
  researcher: ["deep-research", "control-in-app-browser", "browser"],
  documenter: ["pdf", "documents", "spreadsheets", "presentations"],
  visual: ["imagegen", "visualize", "hatch-pet"],
  qa: ["run-evals", "service-release-readiness", "review-agent"],
  integrator: ["sites-building", "plugin-management"],
};

function normalized(text: string): string {
  return text.toLocaleLowerCase();
}

function skillText(skill: Pick<SkillInfo, "name" | "description" | "shortDescription">): string {
  return normalized(`${skill.name} ${skill.description} ${skill.shortDescription ?? ""}`);
}

export function classifySkill(skill: Pick<SkillInfo, "name" | "description" | "shortDescription">): SkillRole {
  const text = skillText(skill);
  const priority: Array<Exclude<SkillRole, "general">> = ["visual", "documenter", "qa", "researcher", "integrator", "builder"];
  for (const role of priority) {
    if (SKILL_ROLE_TERMS[role].some((term) => text.includes(term))) return role;
  }
  return "general";
}

export function inferPromptRole(prompt: string): { role: SkillRole; evidence: string[] } | null {
  const text = normalized(prompt)
    .replace(/(?:파일(?:을|은)?\s*)?(?:수정|변경)하지\s*(?:마|말아|말고|말)/g, " ")
    .replace(/(?:do not|don't|without)\s+(?:modify|change)(?:ing)?/g, " ")
    .replace(/no\s+file\s+changes?/g, " ");
  let best: { role: SkillRole; evidence: string[] } | null = null;
  for (const role of Object.keys(PROMPT_ROLE_TERMS) as Array<Exclude<SkillRole, "general">>) {
    const evidence = PROMPT_ROLE_TERMS[role].filter((term) => text.includes(term));
    if (!best || evidence.length > best.evidence.length) best = { role, evidence };
  }
  return best && best.evidence.length > 0 ? best : null;
}

export function autoSkillAllowed(skill: SkillInfo): boolean {
  const name = skill.name.toLocaleLowerCase();
  return !name.includes("skill-creator") && !name.includes("skill_creator") && !name.includes("skill-installer") && !name.includes("skill_installer");
}

export function shortSkillIdentifier(name: string): string {
  return name.includes(":") ? name.split(":").at(-1) ?? name : name;
}
