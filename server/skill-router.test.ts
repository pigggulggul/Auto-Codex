import { describe, expect, it } from "vitest";
import type { SkillInfo } from "../shared/protocol.js";
import { routeSkill } from "./skill-router.js";
import { classifySkill } from "../shared/skill-catalog.js";

const skills: SkillInfo[] = [
  {
    name: "imagegen",
    description: "Generate or edit images, illustrations, and sprites.",
    path: "C:/skills/imagegen/SKILL.md",
    enabled: true,
  },
  {
    name: "spreadsheets",
    description: "Create and analyze Excel, CSV, and spreadsheet files.",
    path: "C:/skills/spreadsheets/SKILL.md",
    enabled: true,
  },
  {
    name: "pdf",
    description: "Read and create PDF files.",
    path: "C:/skills/pdf/SKILL.md",
    enabled: true,
  },
];

describe("routeSkill", () => {
  it("routes Korean image requests using semantic aliases", () => {
    const result = routeSkill("캐릭터 이미지와 스프라이트를 만들어줘", skills);
    expect(result.skill?.name).toBe("imagegen");
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  it("routes spreadsheet work", () => {
    const result = routeSkill("이 CSV를 엑셀 보고서로 정리해줘", skills);
    expect(result.skill?.name).toBe("spreadsheets");
  });

  it("falls back to the general agent when evidence is weak", () => {
    const result = routeSkill("코드를 조금 더 깔끔하게 정리해줘", skills);
    expect(result.skill).toBeNull();
  });

  it("ignores disabled skills", () => {
    const result = routeSkill("PDF 파일을 만들어줘", skills.map((skill) => ({ ...skill, enabled: false })));
    expect(result.skill).toBeNull();
  });

  it("returns the visual role when the action is clear", () => {
    const result = routeSkill("캐릭터 이미지를 만들어줘", skills);
    expect(result.role).toBe("visual");
    expect(result.skill?.name).toBe("imagegen");
  });

  it("does not auto-invoke skill creation", () => {
    const result = routeSkill("새 스킬을 만들어줘", [
      {
        name: "skill-creator",
        description: "Create or update a skill.",
        path: "C:/skills/skill-creator/SKILL.md",
        enabled: true,
      },
    ]);
    expect(result.skill).toBeNull();
  });

  it("does not treat an explicit no-write request as implementation", () => {
    const result = routeSkill("구조를 분석해서 요약해줘. 파일은 수정하지 마.", skills);
    expect(result.role).toBe("researcher");
    expect(result.skill).toBeNull();
  });

  it("classifies document skills by their identity, even when descriptions mention visual QA", () => {
    expect(classifySkill({ name: "pdf:pdf", description: "Read and verify PDF files where visual layout matters" })).toBe("documenter");
    expect(classifySkill({ name: "spreadsheets:Spreadsheets", description: "Analyze and visualize spreadsheet files" })).toBe("documenter");
  });

  it("routes a Korean Excel request to spreadsheets regardless of catalog order", () => {
    const catalog = [
      { name: "pdf:pdf", description: "Read and verify PDF files where visual layout matters", path: "pdf", enabled: true },
      { name: "spreadsheets:Spreadsheets", description: "Create and visualize spreadsheet files", path: "sheet", enabled: true },
    ];
    expect(routeSkill("엑셀 보고서를 만들어줘", catalog).skill?.path).toBe("sheet");
    expect(routeSkill("엑셀 보고서를 만들어줘", catalog.slice(0, 1)).skill).toBeNull();
  });

  it("selects a mobile development skill when the task asks for a mobile app", () => {
    const mobile = { name: "mobile-app-delivery", description: "Build and test mobile apps for Android and iOS", path: "mobile", enabled: true };
    const frontend = { name: "frontend-feature-delivery", description: "Frontend implementation; use a mobile skill for native mobile apps", path: "frontend", enabled: true };
    expect(routeSkill("모바일 앱 기능을 구현해줘", [frontend, mobile]).skill?.path).toBe("mobile");
    expect(routeSkill("프론트엔드 화면을 구현해줘", [mobile, frontend]).skill?.path).toBe("frontend");
  });

  it("routes Korean product design work to the UX skill", () => {
    const design = { name: "product-ui-ux-design", description: "Design product UI and UX", path: "design", enabled: true };
    expect(routeSkill("UI/UX 디자인을 개선해줘", [design]).skill?.path).toBe("design");
    expect(routeSkill("화면 디자인 구현", [design], "visual").skill?.path).toBe("design");
  });

  it("does not confuse a CSS stylesheet with a spreadsheet", () => {
    const frontend = { name: "frontend-feature-delivery", description: "Implement frontend UI features", path: "frontend", enabled: true };
    expect(routeSkill("프론트엔드 stylesheet 수정", [skills[1], frontend]).skill?.path).toBe("frontend");
    expect(routeSkill("프론트엔드 스타일시트 수정", [skills[1], frontend]).skill?.path).toBe("frontend");
  });
});
