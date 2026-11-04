import type { ConversationMessage, SkillInfo, SkillRole } from "../shared/protocol.js";
import { routeSkill, type RouteResult } from "./skill-router.js";
import { positiveRoutingText } from "./skill-routing-intent.js";

/** Only the last successfully answered user request from this conversation is eligible. */
export function priorUserRequest(messages: readonly ConversationMessage[]): string {
  for (let index = messages.length - 2; index >= 0; index--) {
    const user = messages[index];
    const reply = messages[index + 1];
    if (user.role !== "user") continue;
    return user.status === "completed" && reply?.role === "assistant" && reply.status === "completed" ? user.text.slice(0, 1200) : "";
  }
  return "";
}

const FOLLOW_UP = /(?:이거|이것|이걸|이걸로|이 화면|이 앱|이 기능|그거|그것|그걸|그 화면|이어서|계속|방금|앞서|위에서|더\s*예쁘게|\b(?:it|this|that|continue|previous)\b)/i;
const SPECIFIC_DOMAIN = /(?:모바일|안드로이드|아이폰|스프레드시트|엑셀|피디에프|프론트엔드|프런트엔드|백엔드|이미지|스프라이트|테스트|검증|디자인|시각화|\b(?:android|ios|mobile|spreadsheet|excel|pdf|frontend|backend|image|sprite|test|verify|design|ux)\b)/i;

export function routeContextualSkill(
  taskText: string, skills: SkillInfo[], options: { currentRequest: string; previousRequest: string; expectedRole?: SkillRole },
): RouteResult {
  const direct = routeSkill(taskText, skills, options.expectedRole, options.currentRequest);
  if (!options.previousRequest || !FOLLOW_UP.test(options.currentRequest)
    || SPECIFIC_DOMAIN.test(options.currentRequest) || SPECIFIC_DOMAIN.test(taskText)) return direct;
  const contextual = routeSkill(`${taskText}\n${positiveRoutingText(options.previousRequest)}`, skills, options.expectedRole, options.currentRequest);
  if (!contextual.skill) return direct;
  return { ...contextual, rationale: `현재 작업과 직전 완료된 사용자 요청의 맥락을 참고했습니다. ${contextual.rationale}` };
}
