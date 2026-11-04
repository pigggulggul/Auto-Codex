import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { MAX_DOCUMENT_BYTES } from "./document.js";
import { isAllowedSelectedDrive, localDrives } from "./selected-document.js";

export class IssueExportError extends Error {
  constructor(readonly code: "PATH_INVALID" | "FILE_EXISTS" | "VIEW_AUTH_REQUIRED" | "STALE_SELECTION" | "INTERRUPTED" | "OUTCOME_UNKNOWN" | "STORAGE_FAILED", message: string) { super(message); }
}
const fail = (code: IssueExportError["code"], message: string): never => { throw new IssueExportError(code, message); };
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
type Identity = { dev: bigint; ino: bigint; birthtimeNs: bigint };
const sameIdentity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;

/** New files only. An atomic hard-link creates the final name without replacing an existing file. */
export async function createIssueExport(projectPath: string, selectedPath: string, bytes: Uint8Array, beforeCommit: () => Promise<void>, signal?: AbortSignal): Promise<{ cleanupWarning: boolean }> {
  const aborted = () => { if (signal?.aborted) fail("INTERRUPTED", "문서 저장이 취소되었습니다."); };
  aborted();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) return fail("STORAGE_FAILED", "내보낼 문서 크기를 확인할 수 없습니다.");
  if (process.platform !== "win32" || !path.isAbsolute(projectPath) || !path.isAbsolute(selectedPath) || selectedPath.startsWith("\\\\")) return fail("PATH_INVALID", "현재 내보내기는 로컬 Windows 프로젝트만 지원합니다.");
  const project = path.resolve(projectPath), target = path.resolve(selectedPath), root = path.parse(project).root;
  const relative = path.relative(project, target), parts = relative.split(path.sep);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || target.slice(root.length).includes(":") || path.extname(target).toLowerCase() !== ".md" || /^\.env(?:\.|$)/i.test(path.basename(target)) || parts.some(part => /^\.(?:git|local-data)$/i.test(part))) return fail("PATH_INVALID", "프로젝트 안의 새 Markdown 파일을 선택하세요.");
  let drives: Set<string>;
  try { drives = await localDrives(signal); } catch { aborted(); return fail("PATH_INVALID", "로컬 드라이브를 확인할 수 없습니다."); }
  if (!isAllowedSelectedDrive(root, drives)) return fail("PATH_INVALID", "네트워크 또는 확인할 수 없는 드라이브는 지원하지 않습니다.");
  const parent = path.dirname(target), dirs: { path: string; identity: Identity }[] = [];
  const inspect = async (remember: boolean, cleanup = false) => {
    let current = root;
    const subpaths = parent.slice(root.length).split(path.sep).filter(Boolean);
    for (const component of ["", ...subpaths]) {
      if (component) current = path.join(current, component);
      const info = await lstat(current, { bigint: true }); if (!cleanup) aborted();
      if (!info.isDirectory() || info.isSymbolicLink() || info.dev === 0n || info.ino === 0n || info.birthtimeNs <= 0n || !samePath(await realpath(current), current)) fail("PATH_INVALID", "링크 또는 확인할 수 없는 폴더에는 저장할 수 없습니다.");
      if (remember) dirs.push({ path: current, identity: info });
      else { const expected = dirs.find(entry => samePath(entry.path, current)); if (!expected || !sameIdentity(expected.identity, info)) fail("STALE_SELECTION", "저장 폴더가 변경되었습니다. 다시 선택하세요."); }
    }
  };
  let temp = "", identity: Identity | undefined, createdTemp = false, committed = false, cleanupWarning = false;
  try {
    await inspect(true);
    try { await lstat(target); return fail("FILE_EXISTS", "이미 파일이 있습니다. 새 파일 이름을 선택하세요."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    temp = path.join(parent, `.auto-codex-export-${randomUUID()}.tmp`);
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    createdTemp = true;
    try {
      const opened = await handle.stat({ bigint: true }); identity = opened;
      if (!opened.isFile() || opened.nlink !== 1n || opened.dev === 0n || opened.ino === 0n || opened.birthtimeNs <= 0n) fail("STORAGE_FAILED", "임시 파일을 확인할 수 없습니다.");
      await handle.writeFile(bytes); await handle.sync(); aborted();
    } finally { await handle.close(); }
    await inspect(false);
    const tempInfo = await lstat(temp, { bigint: true });
    if (!tempInfo.isFile() || tempInfo.isSymbolicLink() || tempInfo.nlink !== 1n || !identity || !sameIdentity(identity, tempInfo) || tempInfo.size !== BigInt(bytes.byteLength)) fail("STALE_SELECTION", "임시 파일이 변경되어 저장하지 않았습니다.");
    await beforeCommit(); aborted(); await inspect(false); aborted();
    const finalTemp = await lstat(temp, { bigint: true });
    if (!finalTemp.isFile() || finalTemp.isSymbolicLink() || finalTemp.nlink !== 1n || !sameIdentity(tempInfo, finalTemp) || finalTemp.size !== tempInfo.size || finalTemp.mtimeNs !== tempInfo.mtimeNs || finalTemp.ctimeNs !== tempInfo.ctimeNs) fail("STALE_SELECTION", "임시 파일이 변경되어 저장하지 않았습니다.");
    aborted();
    try { await link(temp, target); committed = true; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return fail("FILE_EXISTS", "이미 파일이 있습니다. 새 파일 이름을 선택하세요.");
      if (code && ["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(code)) return fail("STORAGE_FAILED", "파일시스템이 안전한 새 파일 생성을 지원하지 않거나 권한이 없습니다. 저장 위치와 권한을 확인하세요.");
      throw error;
    }
  } catch (error) {
    if (error instanceof IssueExportError) throw error;
    if (signal?.aborted) return fail(committed ? "OUTCOME_UNKNOWN" : "INTERRUPTED", committed ? "저장 결과를 확인할 수 없습니다. 선택한 위치를 확인하세요." : "문서 저장이 취소되었습니다.");
    return fail(committed ? "OUTCOME_UNKNOWN" : "STORAGE_FAILED", committed ? "저장 결과를 확인할 수 없습니다. 선택한 위치를 확인하세요." : "문서를 안전하게 저장하지 못했습니다.");
  } finally {
    if (createdTemp && !identity) cleanupWarning = true;
    if (createdTemp && identity) {
      try {
        await inspect(false, true);
        const named = await lstat(temp, { bigint: true });
        if (!named.isFile() || named.isSymbolicLink() || !sameIdentity(identity, named)) cleanupWarning = true;
        else await unlink(temp);
      } catch { cleanupWarning = true; }
    }
    if (cleanupWarning && !committed) throw new IssueExportError("STORAGE_FAILED", "저장에 실패했고 임시 파일 정리를 확인하지 못했습니다. 선택한 폴더를 확인하세요.");
  }
  return { cleanupWarning };
}
