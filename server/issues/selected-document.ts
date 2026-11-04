import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_DOCUMENT_BYTES } from "./document.js";

const execFileAsync = promisify(execFile);
const DRIVE_SCRIPT = String.raw`$ErrorActionPreference='Stop'; [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -in @([System.IO.DriveType]::Fixed,[System.IO.DriveType]::Removable,[System.IO.DriveType]::CDRom,[System.IO.DriveType]::Ram) } | ForEach-Object { $_.Name.Substring(0,2).ToUpperInvariant() }`;

export class SelectedDocumentError extends Error {
  constructor(readonly code: "PATH_INVALID" | "LIMIT_EXCEEDED" | "STALE_INPUT" | "INTERRUPTED", message: string) { super(message); }
}
const fail = (code: SelectedDocumentError["code"], message: string): never => { throw new SelectedDocumentError(code, message); };
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) fail("INTERRUPTED", "문서 읽기가 취소되었습니다."); };
export const isAllowedSelectedDrive = (root: string, localDrives: ReadonlySet<string>): boolean => /^[A-Za-z]:\\$/.test(root) && localDrives.has(root.slice(0, 2).toUpperCase());

export async function localDrives(signal?: AbortSignal): Promise<Set<string>> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DRIVE_SCRIPT], {
    encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 4096, signal,
  });
  return new Set(stdout.split(/\r?\n/).map(line => line.trim().toUpperCase()).filter(line => /^[A-Z]:$/.test(line)));
}

/** Read-only bounded copy of one native-selected local file, with no renderer path authority. */
export async function readSelectedIssueDocument(input: string, signal?: AbortSignal): Promise<Uint8Array> {
  checkAbort(signal);
  if (process.platform !== "win32") return fail("PATH_INVALID", "현재 문서 가져오기는 Windows에서만 지원합니다.");
  const normalized = path.resolve(input), root = path.parse(normalized).root;
  if (!/^[A-Za-z]:\\$/.test(root) || !path.isAbsolute(input) || input.startsWith("\\\\") || normalized.slice(root.length).includes(":") || path.extname(normalized).toLowerCase() !== ".md" || /^\.env(?:\.|$)/i.test(path.basename(normalized))) return fail("PATH_INVALID", "로컬 드라이브의 Markdown 문서만 선택할 수 있습니다.");
  let drives: Set<string>;
  try { drives = await localDrives(signal); } catch { checkAbort(signal); return fail("PATH_INVALID", "로컬 드라이브를 확인할 수 없습니다."); }
  checkAbort(signal);
  if (!isAllowedSelectedDrive(root, drives)) return fail("PATH_INVALID", "네트워크 또는 확인할 수 없는 드라이브는 지원하지 않습니다.");
  const inspectPath = async () => {
    let current = root;
    const parts = normalized.slice(root.length).split(path.sep).filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      const info = await lstat(current, { bigint: true }); checkAbort(signal);
      if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory() || index === parts.length - 1 && !info.isFile()) fail("PATH_INVALID", "링크 또는 일반 파일이 아닌 경로는 읽을 수 없습니다.");
    }
    const actual = await realpath(normalized); checkAbort(signal);
    if (actual.toLowerCase() !== normalized.toLowerCase()) fail("PATH_INVALID", "선택한 파일의 실제 경로가 다릅니다.");
    return await lstat(normalized, { bigint: true });
  };
  let handle;
  try {
    const before = await inspectPath();
    if (before.size > BigInt(MAX_DOCUMENT_BYTES)) return fail("LIMIT_EXCEEDED", "문서가 4 MiB 크기 제한을 초과했습니다.");
    handle = await open(normalized, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    const opened = await handle.stat({ bigint: true }), named = await inspectPath();
    const same = (a: typeof opened, b: typeof opened) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
    if (!opened.isFile() || opened.dev === 0n || opened.ino === 0n || opened.birthtimeNs <= 0n || !same(before, opened) || !same(opened, named)) return fail("STALE_INPUT", "문서가 읽는 중 변경되었거나 식별할 수 없습니다. 다시 선택하세요.");
    const buffer = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < buffer.length) { checkAbort(signal); const result = await handle.read(buffer, offset, buffer.length - offset, offset); if (!result.bytesRead) return fail("STALE_INPUT", "문서가 읽는 중 변경되었습니다. 다시 선택하세요."); offset += result.bytesRead; }
    const firstHash = createHash("sha256").update(buffer).digest("hex"), verification = createHash("sha256"), chunk = Buffer.alloc(Math.min(buffer.length || 1, 64 * 1024));
    offset = 0;
    while (offset < buffer.length) { checkAbort(signal); const result = await handle.read(chunk, 0, Math.min(chunk.length, buffer.length - offset), offset); if (!result.bytesRead) return fail("STALE_INPUT", "문서가 읽는 중 변경되었습니다. 다시 선택하세요."); verification.update(chunk.subarray(0, result.bytesRead)); offset += result.bytesRead; }
    const after = await handle.stat({ bigint: true }), afterNamed = await inspectPath();
    if (firstHash !== verification.digest("hex") || !same(opened, after) || !same(after, afterNamed)) return fail("STALE_INPUT", "문서가 읽는 중 변경되었습니다. 다시 선택하세요.");
    return buffer;
  } catch (error) {
    if (error instanceof SelectedDocumentError) throw error;
    if (signal?.aborted) return fail("INTERRUPTED", "문서 읽기가 취소되었습니다.");
    return fail("PATH_INVALID", "선택한 문서를 안전하게 읽을 수 없습니다.");
  } finally { await handle?.close(); }
}
