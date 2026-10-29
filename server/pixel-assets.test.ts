import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("shipped pixel artwork", () => {
  it("contains opposite planted feet and isolated transparent furniture", () => {
    const script = fileURLToPath(new URL("../tools/verify-pixel-assets.mjs", import.meta.url));
    const result = execFileSync(process.execPath, [script], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    expect(result).toContain("PASS: 17 isolated furniture sprites");
  });
});
