import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_DOCUMENT_BYTES } from "./document.js";
import { isAllowedSelectedDrive, readSelectedIssueDocument } from "./selected-document.js";

const scratch = path.resolve(".cache"), roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) { expect(path.dirname(await realpath(root))).toBe(await realpath(scratch)); await rm(root, { recursive: true, force: true }); } });
async function setup() { await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, "issue-source-")); roots.push(root); return root; }

describe("selected issue document", () => {
  it("does not allow a mapped drive absent from the local-drive classification", () => {
    expect(isAllowedSelectedDrive("c:\\", new Set(["C:"]))).toBe(true);
    expect(isAllowedSelectedDrive("X:\\", new Set(["C:"]))).toBe(false);
    expect(isAllowedSelectedDrive("\\\\server\\share\\", new Set(["C:"]))).toBe(false);
  });
  it("reads a bounded selected local file without modifying it", async () => {
    const root = await setup(), file = path.join(root, "synthetic.md"), input = Buffer.from("# synthetic\n", "utf8"); await writeFile(file, input);
    if (process.platform !== "win32") { await expect(readSelectedIssueDocument(file)).rejects.toMatchObject({ code: "PATH_INVALID" }); return; }
    expect(await readSelectedIssueDocument(file)).toEqual(input);
    expect(await readFile(file)).toEqual(input);
  });
  it("rejects unsupported names, network paths, oversized files and cancelled reads", async () => {
    const root = await setup(), tooLarge = path.join(root, "large.md"); await writeFile(tooLarge, Buffer.alloc(MAX_DOCUMENT_BYTES + 1));
    const controller = new AbortController(); controller.abort();
    await expect(readSelectedIssueDocument(tooLarge, controller.signal)).rejects.toMatchObject({ code: "INTERRUPTED" });
    await expect(readSelectedIssueDocument(path.join(root, "draft.txt"))).rejects.toMatchObject({ code: "PATH_INVALID" });
    if (process.platform === "win32") {
      await expect(readSelectedIssueDocument("\\\\synthetic\\share\\plan.md")).rejects.toMatchObject({ code: "PATH_INVALID" });
      await expect(readSelectedIssueDocument(path.join(root, ".env.secret.md"))).rejects.toMatchObject({ code: "PATH_INVALID" });
      await expect(readSelectedIssueDocument(tooLarge)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    }
  });
  it("rejects a junction in a selected path", async () => {
    const root = await setup(), target = path.join(root, "target"), junction = path.join(root, "junction"); await mkdir(target); await writeFile(path.join(target, "plan.md"), "synthetic");
    await symlink(target, junction, process.platform === "win32" ? "junction" : "dir");
    await expect(readSelectedIssueDocument(path.join(junction, "plan.md"))).rejects.toMatchObject({ code: "PATH_INVALID" });
  });
});
