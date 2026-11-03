import { describe, expect, it } from "vitest";
import type { ConversationMessage, SkillInfo } from "../shared/protocol.js";
import { priorUserRequest, routeContextualSkill } from "./skill-context.js";

const skills: SkillInfo[] = [
  { name: "frontend-feature-delivery", description: "Implement frontend UI features", path: "frontend", enabled: true },
  { name: "mobile-app-delivery", description: "Build mobile Android and iOS apps", path: "mobile", enabled: true },
  { name: "pdf", description: "Read and create PDF files", path: "pdf", enabled: true },
];
const message = (role: "user" | "assistant", text: string, status: ConversationMessage["status"] = "completed"): ConversationMessage => ({ id: `${role}-${text}`, role, text, timestamp: "2026-01-01", status });

describe("conversation-aware skill routing", () => {
  it("uses the last successfully answered user request, not the assistant response", () => {
    const history = [message("user", "모바일 앱 구현"), message("assistant", "PDF라고 잘못 주장")];
    expect(priorUserRequest(history)).toBe("모바일 앱 구현");
    const selected = routeContextualSkill("이 화면을 고쳐줘", skills, { currentRequest: "이 화면을 고쳐줘", previousRequest: priorUserRequest(history) });
    expect(selected.skill?.name).toBe("mobile-app-delivery");
    expect(selected.rationale).toContain("직전 완료된 사용자 요청");
  });

  it("prioritizes a new explicit domain and does not reuse context without a follow-up", () => {
    const options = { currentRequest: "PDF 문서를 만들어줘", previousRequest: "모바일 앱 구현" };
    expect(routeContextualSkill(options.currentRequest, skills, options).skill?.name).toBe("pdf");
    expect(routeContextualSkill("별도의 작업을 진행해줘", skills, { ...options, currentRequest: "별도의 작업을 진행해줘" }).skill).toBeNull();
  });

  it("does not carry failed, interrupted, or unrelated older turns forward", () => {
    const history = [message("user", "모바일 앱"), message("assistant", "완료"), message("user", "다른 요청"), message("assistant", "실패", "failed")];
    expect(priorUserRequest(history)).toBe("");
    expect(priorUserRequest([message("user", "모바일 앱"), message("assistant", "중단", "interrupted")])).toBe("");
    expect(priorUserRequest([])).toBe("");
  });

  it("respects the task role and current task's explicit domain", () => {
    const options = { currentRequest: "이 화면을 수정해줘", previousRequest: "모바일 앱 구현", expectedRole: "builder" as const };
    expect(routeContextualSkill("화면 구현", skills, options).skill?.name).toBe("mobile-app-delivery");
    expect(routeContextualSkill("프론트엔드 구현", skills, options).skill?.name).toBe("frontend-feature-delivery");
    expect(routeContextualSkill("검증", skills, { ...options, expectedRole: "qa" }).skill).toBeNull();
  });
});
