import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createIssueExport } from "./export-file.js";

const scratch = path.resolve(".cache"), roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) { expect(path.dirname(await realpath(root))).toBe(await realpath(scratch)); await rm(root, { recursive: true, force: true }); } });
async function setup() {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "issue-export-")); roots.push(root);
  const project = path.join(root, "project"); await mkdir(project); return { root, project };
}
const bytes = new TextEncoder().encode("synthetic document");
const noop = async () => {};
describe.skipIf(process.platform !== "win32")("new issue export file on local Windows", () => {
  it("atomically creates the selected project file and removes the temporary name", async () => {
    const { project } = await setup(), file = path.join(project, "new.md");
    expect(await createIssueExport(project, file, bytes, noop)).toEqual({ cleanupWarning: false });
    expect(await readFile(file, "utf8")).toBe("synthetic document");
    expect(await readdir(project)).toEqual(["new.md"]);
  });
  it("rejects existing files, project escapes and reserved paths without modifying them", async () => {
    const { root, project } = await setup(), existing = path.join(project, "existing.md");
    await writeFile(existing, "original");
    await expect(createIssueExport(project, existing, bytes, noop)).rejects.toMatchObject({ code: "FILE_EXISTS" });
    await expect(createIssueExport(project, path.join(root, "outside.md"), bytes, noop)).rejects.toMatchObject({ code: "PATH_INVALID" });
    await expect(createIssueExport(project, path.join(project, ".git", "output.md"), bytes, noop)).rejects.toMatchObject({ code: "PATH_INVALID" });
    expect(await readFile(existing, "utf8")).toBe("original"); expect(await readdir(project)).toEqual(["existing.md"]);
  });
  it("refuses a file created during the final check, preserving the competing content", async () => {
    const { project } = await setup(), file = path.join(project, "race.md");
    await expect(createIssueExport(project, file, bytes, async () => { await writeFile(file, "other writer", { flag: "wx" }); })).rejects.toMatchObject({ code: "FILE_EXISTS" });
    expect(await readFile(file, "utf8")).toBe("other writer"); expect(await readdir(project)).toEqual(["race.md"]);
  });
  it("rejects a temporary file changed during the final check", async () => {
    const { project } = await setup(), file = path.join(project, "changed.md");
    await expect(createIssueExport(project, file, bytes, async () => {
      const temp = (await readdir(project)).find(name => name.startsWith(".auto-codex-export-"));
      expect(temp).toBeDefined(); await writeFile(path.join(project, temp!), "modified synthetic bytes");
    })).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(await readdir(project)).toEqual([]);
  });
  it("removes temporary data on cancellation and rejects a linked output directory", async () => {
    const { root, project } = await setup(), controller = new AbortController();
    await expect(createIssueExport(project, path.join(project, "cancel.md"), bytes, async () => { controller.abort(); }, controller.signal)).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(await readdir(project)).toEqual([]);
    const outside = path.join(root, "outside"); await mkdir(outside);
    await symlink(outside, path.join(project, "link"), "junction");
    await expect(createIssueExport(project, path.join(project, "link", "escape.md"), bytes, noop)).rejects.toMatchObject({ code: "PATH_INVALID" });
    expect(await readdir(outside)).toEqual([]);
  });
});
