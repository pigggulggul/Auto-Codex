import { afterEach, describe, expect, it, vi } from "vitest";
import { link, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, link: vi.fn() };
});
import { createIssueExport } from "./export-file.js";

const scratch = path.resolve(".cache"), roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) {
    expect(path.dirname(await realpath(root))).toBe(await realpath(scratch));
    await rm(root, { recursive: true, force: true });
  }
});

describe("issue export when atomic publication is unavailable", () => {
  for (const code of ["EPERM", "EACCES", "ENOTSUP"]) it(`reports ${code} without publishing a partial file`, async () => {
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(path.join(scratch, "issue-export-permission-")); roots.push(root);
    const project = path.join(root, "project"); await mkdir(project);
    if (process.platform !== "win32") {
      await expect(createIssueExport(project, path.join(project, "new.md"), new TextEncoder().encode("synthetic"), async () => {})).rejects.toMatchObject({ code: "PATH_INVALID" });
      expect(link).not.toHaveBeenCalled(); expect(await readdir(project)).toEqual([]); return;
    }
    vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error("synthetic private path"), { code }));
    let checked = false;
    const result = createIssueExport(project, path.join(project, "new.md"), new TextEncoder().encode("synthetic"), async () => { checked = true; });
    await expect(result).rejects.toMatchObject({ code: "STORAGE_FAILED", message: expect.stringContaining("지원하지 않거나 권한이 없습니다") });
    expect(checked).toBe(true); expect(link).toHaveBeenCalledTimes(1);
    expect(await readdir(project)).toEqual([]);
  });
});
