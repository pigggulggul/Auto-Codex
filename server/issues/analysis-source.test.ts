import { afterEach, describe, expect, it } from "vitest";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { MAX_ANALYSIS_SOURCE_BYTES, readAnalysisSource } from "./analysis-source.js";

const scratch = path.resolve(".cache"), roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) { expect(path.dirname(await realpath(root))).toBe(await realpath(scratch)); await rm(root, { recursive: true, force: true }); } });
async function setup() { await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, "analysis-source-")); roots.push(root); const project = path.join(root, "project"); await mkdir(project); return { root, project }; }
describe.skipIf(process.platform !== "win32")("selected project analysis source", () => {
  it("copies only the explicitly selected UTF-8 project file without changing it", async () => {
    const { project } = await setup(), directory = path.join(project, "docs"); await mkdir(directory);
    const file = path.join(directory, "plan.txt"), bytes = Buffer.from("synthetic 한글 😀\n"); await writeFile(file, bytes);
    expect(await readAnalysisSource(project, file)).toEqual({ relativePath: "docs/plan.txt", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), text: bytes.toString("utf8") });
    expect(await readFile(file)).toEqual(bytes);
  });
  it("rejects outside paths, excluded names, links and invalid or oversized content", async () => {
    const { root, project } = await setup(), outside = path.join(root, "outside.txt"); await writeFile(outside, "synthetic");
    await expect(readAnalysisSource(project, outside)).rejects.toMatchObject({ code: "PATH_INVALID" });
    for (const relative of [".env.test.md", "config.env.txt", "credentials.txt", "private-key.md", "node_modules/plan.md", ".git/plan.txt"]) await expect(readAnalysisSource(project, path.join(project, relative))).rejects.toMatchObject({ code: "PATH_INVALID" });
    const target = path.join(project, "bad.txt"), tooLarge = path.join(project, "large.md");
    await writeFile(target, Buffer.from([0xff])); await expect(readAnalysisSource(project, target)).rejects.toMatchObject({ code: "INVALID_TEXT" });
    await writeFile(target, Buffer.from([0x61, 0x00, 0x62])); await expect(readAnalysisSource(project, target)).rejects.toMatchObject({ code: "INVALID_TEXT" });
    await writeFile(tooLarge, Buffer.alloc(MAX_ANALYSIS_SOURCE_BYTES + 1)); await expect(readAnalysisSource(project, tooLarge)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const linked = path.join(project, "hardlink.txt"); await link(outside, linked); await expect(readAnalysisSource(project, linked)).rejects.toMatchObject({ code: "PATH_INVALID" });
    const outsideDir = path.join(root, "outside-dir"); await mkdir(outsideDir); await writeFile(path.join(outsideDir, "plan.md"), "synthetic");
    await symlink(outsideDir, path.join(project, "junction"), "junction");
    await expect(readAnalysisSource(project, path.join(project, "junction", "plan.md"))).rejects.toMatchObject({ code: "PATH_INVALID" });
    const abort = new AbortController(); abort.abort(); await expect(readAnalysisSource(project, target, abort.signal)).rejects.toMatchObject({ code: "INTERRUPTED" });
  });
});
