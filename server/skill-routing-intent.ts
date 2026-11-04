import type { SkillInfo } from "../shared/protocol.js";
import { shortSkillIdentifier } from "../shared/skill-catalog.js";

// These patterns only recognize common explicit wording; they are not a general language parser.
const NEGATIVE_CLAUSE = /[^.!?\n,;]{0,200}?(?:사용하지\s*(?:말고|마세요|마|않고)|쓰지\s*(?:말고|마세요|마)|만들지\s*(?:말고|마세요|마)|제외하고|없이)/gi;
const ENGLISH_SKILL_EXCLUSION = /\b(?:do not|don't|never)\s+use\s+[^.!?\n,;]{1,100}/gi;

function negativeClauses(prompt: string): string[] {
  return [...(prompt.match(NEGATIVE_CLAUSE) ?? []), ...(prompt.match(ENGLISH_SKILL_EXCLUSION) ?? [])];
}

export function positiveRoutingText(prompt: string): string {
  return prompt.replace(NEGATIVE_CLAUSE, " ").replace(ENGLISH_SKILL_EXCLUSION, " ");
}

const SKILL_ALIASES: Record<string, RegExp> = {
  "mobile-app-delivery": /모바일\s*앱|mobile\s*app/i,
  "frontend-feature-delivery": /프론트엔드|프런트엔드|front[ -]?end/i,
  "backend-feature-delivery": /백엔드|back[ -]?end/i,
  "product-ui-ux-design": /ui\s*\/?\s*ux|디자인|design/i,
  "run-evals": /검증|테스트|qa|eval/i,
};

/** Restricts bridge assignment only; it cannot prevent independent model behavior. */
export function isSkillExcluded(prompt: string, skill: SkillInfo, catalog: readonly SkillInfo[]): boolean {
  for (const clause of negativeClauses(prompt)) {
    if (!/(?:스킬|skills?)/i.test(clause)) continue;
    const lower = clause.toLocaleLowerCase();
    const matches = catalog.filter(candidate => {
      const name = candidate.name.toLocaleLowerCase();
      const short = shortSkillIdentifier(name);
      return lower.includes(name) || lower.includes(short) || SKILL_ALIASES[short]?.test(clause);
    });
    if (matches.length === 0 || matches.some(candidate => candidate.path === skill.path)) return true;
  }
  return false;
}
