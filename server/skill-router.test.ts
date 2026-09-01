import { describe, expect, it } from "vitest";
import type { SkillInfo } from "../shared/protocol.js";
import { routeSkill } from "./skill-router.js";

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
});
