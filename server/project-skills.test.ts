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
});
