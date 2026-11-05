import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { isAllowedSelectedDrive, localDrives } from "./selected-document.js";

export const MAX_ANALYSIS_SOURCE_BYTES = 1024 * 1024;
export class AnalysisSourceError extends Error {
  constructor(readonly code: "PATH_INVALID" | "LIMIT_EXCEEDED" | "STALE_INPUT" | "INTERRUPTED" | "INVALID_TEXT", message: string) { super(message); }
}
const fail = (code: AnalysisSourceError["code"], message: string): never => { throw new AnalysisSourceError(code, message); };
const excludedDirectory = /^(?:\.git|\.local-data|\.cache|\.codex|\.aws|\.ssh|node_modules|dist|build|coverage|\.next|\.turbo|\.vite|\.venv|venv|__pycache__|secrets|credentials)$/i;
// Sensitive directories cannot become visible by selecting a project nested
// inside them. Generated-directory exclusions remain relative to the project.
const excludedProjectAncestor = /^(?:\.git|\.local-data|\.aws|\.ssh|secrets|credentials)$/i;
const excludedName = /(?:^|[._-])(?:\.env[^/\\]*|secret(?:s)?|credentials?|passwords?|passwd|private[._-]?key|tokens?|api[._-]?key|id[._-]rsa)(?:[._-]|$)/i;

/** Copies only an explicitly selected local project file; it neither executes nor transmits the text. */
export async function readAnalysisSource(projectPath: string, selectedPath: string, signal?: AbortSignal): Promise<{ relativePath: string; bytes: number; sha256: string; text: string }> {
  const abort = () => { if (signal?.aborted) fail("INTERRUPTED", "자료 읽기가 취소되었습니다."); };
  abort();
  if (process.platform !== "win32" || !path.isAbsolute(projectPath) || !path.isAbsolute(selectedPath) || selectedPath.startsWith("\\\\")) return fail("PATH_INVALID", "로컬 Windows 프로젝트 안의 자료만 선택할 수 있습니다.");
  const project = path.resolve(projectPath), target = path.resolve(selectedPath), root = path.parse(project).root, relative = path.relative(project, target);
  const components = relative.split(path.sep).filter(Boolean);
  const projectComponents = project.slice(root.length).split(path.sep).filter(Boolean);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.length > 1024 || target.slice(root.length).includes(":") || ![".md", ".txt"].includes(path.extname(target).toLowerCase()) || projectComponents.some(component => excludedProjectAncestor.test(component) || /^\.env/i.test(component)) || excludedDirectory.test(path.basename(project)) || components.some((component, index) => excludedDirectory.test(component) || /^\.env/i.test(component) || /(?:^|\.)env(?:\.|$)/i.test(component) || (index === components.length - 1 && excludedName.test(component)))) return fail("PATH_INVALID", "프로젝트 안의 허용된 Markdown 또는 텍스트 자료를 선택하세요. 비밀·설정·생성 경로는 제외됩니다.");
  let drives: Set<string>;
  try { drives = await localDrives(signal); } catch { abort(); return fail("PATH_INVALID", "로컬 드라이브를 확인할 수 없습니다."); }
  if (!isAllowedSelectedDrive(root, drives)) return fail("PATH_INVALID", "네트워크 또는 확인할 수 없는 드라이브의 자료는 선택할 수 없습니다.");
  let handle;
  try {
    const inspect = async () => {
      let current = root;
      const parts = target.slice(root.length).split(path.sep).filter(Boolean);
      for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        const info = await lstat(current, { bigint: true }); abort();
        if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory() || index === parts.length - 1 && (!info.isFile() || info.nlink !== 1n)) fail("PATH_INVALID", "링크나 일반 파일이 아닌 자료는 선택할 수 없습니다.");
      }
      if ((await realpath(project)).toLowerCase() !== project.toLowerCase() || (await realpath(target)).toLowerCase() !== target.toLowerCase()) fail("PATH_INVALID", "프로젝트 또는 자료의 실제 경로가 변경되었습니다.");
      return { file: await lstat(target, { bigint: true }), project: await lstat(project, { bigint: true }) };
    };
    const before = await inspect();
    if (before.file.size > BigInt(MAX_ANALYSIS_SOURCE_BYTES)) return fail("LIMIT_EXCEEDED", "자료 하나는 1 MiB 이하여야 합니다.");
    handle = await open(target, constants.O_RDONLY);
    const opened = await handle.stat({ bigint: true }), named = await inspect();
    const same = (a: typeof opened, b: typeof opened) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
    const sameDirectory = (a: typeof opened, b: typeof opened) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
    if (!opened.isFile() || opened.dev === 0n || opened.ino === 0n || opened.birthtimeNs <= 0n || !before.project.isDirectory() || before.project.dev === 0n || before.project.ino === 0n || before.project.birthtimeNs <= 0n || !same(before.file, opened) || !same(opened, named.file) || !sameDirectory(before.project, named.project)) return fail("STALE_INPUT", "자료나 프로젝트가 읽는 중 변경되어 다시 선택해야 합니다.");
    const buffer = Buffer.alloc(Number(opened.size)); let offset = 0;
    while (offset < buffer.length) { abort(); const result = await handle.read(buffer, offset, buffer.length - offset, offset); if (!result.bytesRead) return fail("STALE_INPUT", "자료가 읽는 중 변경되었습니다."); offset += result.bytesRead; }
    const firstHash = createHash("sha256").update(buffer).digest("hex"), verification = createHash("sha256"), chunk = Buffer.alloc(Math.min(buffer.length || 1, 64 * 1024)); offset = 0;
    while (offset < buffer.length) { abort(); const result = await handle.read(chunk, 0, Math.min(chunk.length, buffer.length - offset), offset); if (!result.bytesRead) return fail("STALE_INPUT", "자료가 읽는 중 변경되었습니다."); verification.update(chunk.subarray(0, result.bytesRead)); offset += result.bytesRead; }
    const after = await handle.stat({ bigint: true }), final = await inspect();
    if (firstHash !== verification.digest("hex") || !same(opened, after) || !same(after, final.file) || !sameDirectory(before.project, final.project)) return fail("STALE_INPUT", "자료나 프로젝트가 읽는 중 변경되어 다시 선택해야 합니다.");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { return fail("INVALID_TEXT", "UTF-8 텍스트 자료만 선택할 수 있습니다."); }
    if (text.includes("\0")) return fail("INVALID_TEXT", "바이너리로 보이는 자료는 선택할 수 없습니다.");
    abort();
    return { relativePath: relative.split(path.sep).join("/"), bytes: buffer.length, sha256: firstHash, text };
  } catch (error) {
    if (error instanceof AnalysisSourceError) throw error;
    if (signal?.aborted) return fail("INTERRUPTED", "자료 읽기가 취소되었습니다.");
    return fail("PATH_INVALID", "선택한 자료를 안전하게 읽을 수 없습니다.");
  } finally { await handle?.close(); }
}
