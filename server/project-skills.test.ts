import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routeSkill } from "./skill-router.js";

const names = ["frontend-feature-delivery", "backend-feature-delivery", "product-ui-ux-design", "mobile-app-delivery", "run-evals"];

describe("project skill discovery metadata", () => {
  const skills = names.map((name) => {
    const text = readFileSync(`.agents/skills/${name}/SKILL.md`, "utf8");
    const frontmatter = text.match(/^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/);
    if (!frontmatter || frontmatter[1] !== name) throw new Error(`Invalid skill metadata: ${name}`);
    return { name, description: frontmatter[2], path: name, enabled: true };
  });

  it("routes realistic mobile, frontend, design, and verification tasks using the actual descriptions", () => {
    expect(routeSkill("모바일 앱 화면을 구현해줘", skills).skill?.name).toBe("mobile-app-delivery");
    expect(routeSkill("프론트엔드 화면을 구현해줘", skills).skill?.name).toBe("frontend-feature-delivery");
    expect(routeSkill("화면을 수정해줘", skills).skill?.name).toBe("frontend-feature-delivery");
    expect(routeSkill("UI/UX 디자인을 개선해줘", skills).skill?.name).toBe("product-ui-ux-design");
    expect(routeSkill("결과 검증 테스트를 실행합니다", skills).skill?.name).toBe("run-evals");
  });

  it.each([
    ["백엔드 API 인증 기능을 구현해줘", "backend-feature-delivery"],
    ["REST API에 로그인 권한을 추가해줘", "backend-feature-delivery"],
    ["사용자 로그인 API에 권한 검사를 추가해줘", "backend-feature-delivery"],
    ["백엔드 기능을 수정해줘", "backend-feature-delivery"],
    ["서버에서 유효성 검증을 구현해줘", "backend-feature-delivery"],
    ["Linux 서버에서 유효성 검증을 구현해줘", "backend-feature-delivery"],
    ["데이터베이스 쿼리를 최적화해줘", "backend-feature-delivery"],
    ["모바일 웹 반응형 화면을 개선해줘", "frontend-feature-delivery"],
    ["기존 리액트 화면을 모바일에서 반응형으로 고쳐줘", "frontend-feature-delivery"],
    ["iOS 앱에서 로그인 기능을 만들어줘", "mobile-app-delivery"],
    ["Flutter 앱을 구현해줘", "mobile-app-delivery"],
    ["리액트 네이티브로 채팅 기능을 만들어줘", "mobile-app-delivery"],
    ["화면 디자인을 전문 디자이너처럼 개선해줘", "product-ui-ux-design"],
    ["사용자 경험을 개선하는 새 화면을 디자인해줘", "product-ui-ux-design"],
    ["UI/UX 디자인을 새롭게 개선하고 화면도 구현해줘", "product-ui-ux-design"],
    ["모바일 앱 스킬을 쓰지 말고 웹 화면만 수정해줘", "frontend-feature-delivery"],
    ["mobile-app-delivery 스킬은 사용하지 말고 프론트엔드 화면을 수정해줘", "frontend-feature-delivery"],
    ["안드로이드 앱을 만들지 말고 웹 화면을 수정해줘", "frontend-feature-delivery"],
    ["이 변경 사항의 테스트를 검증해줘", "run-evals"],
    ["테스트하지 말고 화면을 수정해줘", "frontend-feature-delivery"],
  ])("routes %s to %s", (prompt, expected) => {
    expect(routeSkill(prompt, skills).skill?.name).toBe(expected);
  });

  it("does not automatically assign a skill when the request excludes all skills", () => {
    expect(routeSkill("스킬을 사용하지 말고 백엔드 API를 구현해줘", skills).skill).toBeNull();
    expect(routeSkill("이 스킬을 사용하지 말고 백엔드 API를 구현해줘", skills).skill).toBeNull();
    expect(routeSkill("버튼 색상만 빨간색으로 변경해줘", skills).skill).toBeNull();
    expect(routeSkill("BIOS 설정 코드를 수정해줘", skills).skill?.name).not.toBe("mobile-app-delivery");
  });

  it("reports a domain match without claiming the skill name appeared in the prompt", () => {
    const result = routeSkill("데이터베이스 쿼리를 최적화해줘", skills);
    expect(result.skill?.name).toBe("backend-feature-delivery");
    expect(result.rationale).not.toContain("직접 포함");
  });
});
