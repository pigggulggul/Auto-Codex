import { createHash, randomUUID } from "node:crypto";
import type { AnalysisSnapshotRequest, AnalysisSnapshotSummary, AnalysisSourceChunk, AnalysisSourceList, AnalysisSourceMetadata } from "../../shared/issues/sources.js";
import { MAX_ANALYSIS_SOURCE_BYTES } from "./analysis-source.js";

const MAX_SOURCES = 16, MAX_SESSION_BYTES = 4 * 1024 * 1024, MAX_MEMORY = 32 * 1024 * 1024, CHUNK_UNITS = 8192;
type Source = AnalysisSourceMetadata & { text: string; memory: number };
type Segment = { id: string; sourceId: string; start: number; end: number };
type Snapshot = { summary: AnalysisSnapshotSummary; instruction: string; segments: Segment[] };
type Session = { generation: number; projectPath: string; expires: number; items: Source[]; snapshot?: Snapshot; timer: ReturnType<typeof setTimeout>; onAbort: () => void };
export class SourceSessionError extends Error {
  constructor(readonly code: "LIMIT_EXCEEDED" | "NOT_FOUND" | "STALE_INPUT" | "INVALID_INPUT", message: string) { super(message); }
}
const fail = (code: SourceSessionError["code"], message: string): never => { throw new SourceSessionError(code, message); };
export function segmentAnalysisSource(sourceId: string, sha256: string, text: string): Segment[] {
  const segments: Segment[] = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_UNITS);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    const id = `segment_${createHash("sha256").update(JSON.stringify([sourceId, sha256, start, end])).digest("hex")}`;
    segments.push({ id, sourceId, start, end }); start = end;
  }
  return segments;
}

/** Per-socket, bounded, ephemeral source copies. No source bytes are written to disk. */
export class IssueSourceSessions {
  private sessions = new Map<AbortSignal, Session>();
  private memory = 0;
  constructor(private readonly now: () => number) {}
  clear(signal: AbortSignal): void {
    const session = this.sessions.get(signal); if (!session) return;
    clearTimeout(session.timer); signal.removeEventListener("abort", session.onAbort);
    this.sessions.delete(signal); this.memory -= session.items.reduce((total, item) => total + item.memory, 0);
  }
  clearAll(): void { for (const signal of this.sessions.keys()) this.clear(signal); }
  private current(signal: AbortSignal, generation: number, projectPath: string): Session | null {
    const session = this.sessions.get(signal);
    if (!session) return null;
    if (signal.aborted || session.expires <= this.now() || session.generation !== generation || session.projectPath !== projectPath) { this.clear(signal); return null; }
    return session;
  }
  list(signal: AbortSignal, generation: number, projectPath: string): AnalysisSourceList {
    const session = this.current(signal, generation, projectPath);
    return { items: (session?.items ?? []).map(({ id, relativePath, bytes, sha256, projectRevision }) => ({ id, relativePath, bytes, sha256, projectRevision })), totalBytes: session?.items.reduce((total, item) => total + item.bytes, 0) ?? 0 };
  }
  add(signal: AbortSignal, generation: number, projectPath: string, expires: number, projectRevision: number, source: { relativePath: string; bytes: number; sha256: string; text: string }): AnalysisSourceList {
    if (signal.aborted || expires <= this.now()) return fail("STALE_INPUT", "자료 보기 권한이 만료되었습니다.");
    if (!Number.isSafeInteger(projectRevision) || projectRevision < 1 || !Number.isSafeInteger(source.bytes) || source.bytes < 0 || source.bytes > MAX_ANALYSIS_SOURCE_BYTES || typeof source.text !== "string" || source.text.length > MAX_ANALYSIS_SOURCE_BYTES || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.relativePath !== "string" || !source.relativePath || source.relativePath.length > 1024 || source.relativePath.includes("\\") || source.relativePath.split("/").some(part => !part || part === "." || part === ".." || part.includes(":"))) return fail("INVALID_INPUT", "자료 사본의 형식이 올바르지 않습니다.");
    let session = this.current(signal, generation, projectPath);
    const old = session?.items.find(item => item.relativePath.toLowerCase() === source.relativePath.toLowerCase());
    if (old) {
      if (old.sha256 !== source.sha256) return fail("STALE_INPUT", "이미 선택한 자료가 변경되었습니다. 기존 사본을 제거한 뒤 다시 선택하세요.");
      return this.list(signal, generation, projectPath);
    }
    const memory = Math.max(source.bytes, source.text.length * 2), totalBytes = session?.items.reduce((total, item) => total + item.bytes, 0) ?? 0;
    if ((session?.items.length ?? 0) >= MAX_SOURCES || totalBytes + source.bytes > MAX_SESSION_BYTES || this.memory + memory > MAX_MEMORY) return fail("LIMIT_EXCEEDED", "선택 자료 한도에 도달했습니다. 일부를 제거한 뒤 다시 선택하세요.");
    if (!session) {
      const onAbort = () => this.clear(signal);
      const timer = setTimeout(onAbort, Math.max(1, expires - this.now())); timer.unref();
      session = { generation, projectPath, expires, items: [], timer, onAbort };
      this.sessions.set(signal, session); signal.addEventListener("abort", onAbort, { once: true });
    }
    session.snapshot = undefined;
    session.items.push({ id: `source_${randomUUID()}`, relativePath: source.relativePath, bytes: source.bytes, sha256: source.sha256, projectRevision, text: source.text, memory });
    this.memory += memory;
    return this.list(signal, generation, projectPath);
  }
  remove(signal: AbortSignal, generation: number, projectPath: string, sourceId: string): AnalysisSourceList {
    const session = this.current(signal, generation, projectPath), index = session?.items.findIndex(item => item.id === sourceId) ?? -1;
    if (!session || index < 0) return fail("NOT_FOUND", "선택한 자료를 찾을 수 없습니다.");
    const [removed] = session.items.splice(index, 1); this.memory -= removed.memory; session.snapshot = undefined;
    return this.list(signal, generation, projectPath);
  }
  prepare(signal: AbortSignal, generation: number, projectPath: string, revision: number, request: AnalysisSnapshotRequest): AnalysisSnapshotSummary {
    const session = this.current(signal, generation, projectPath);
    if (!session || session.items.length === 0) return fail("INVALID_INPUT", "먼저 분석할 자료를 선택하세요.");
    if (revision !== request.expectedRevision || session.items.some(item => item.projectRevision !== revision) || request.expectedSources.length !== session.items.length || session.items.some((item, index) => request.expectedSources[index]?.id !== item.id || request.expectedSources[index]?.sha256 !== item.sha256)) return fail("STALE_INPUT", "프로젝트 또는 선택 자료가 바뀌었습니다. 목록을 새로 불러오고 자료를 다시 선택하세요.");
    if (typeof request.instruction !== "string" || request.instruction.length > 1024 || Buffer.byteLength(request.instruction, "utf8") > 4096 || request.instruction.includes("\0")) return fail("INVALID_INPUT", "추가 요청은 1024자 이하여야 합니다.");
    const segments: Segment[] = [];
    const sources = session.items.map(item => {
      const itemSegments = segmentAnalysisSource(item.id, item.sha256, item.text); segments.push(...itemSegments);
      return { id: item.id, relativePath: item.relativePath, sha256: item.sha256, segmentCount: itemSegments.length };
    });
    if (segments.length > 2048) return fail("LIMIT_EXCEEDED", "자료 구간이 너무 많습니다. 자료를 나누어 선택하세요.");
    const summary: AnalysisSnapshotSummary = { id: `snapshot_${randomUUID()}`, projectRevision: revision, sources, totalSegments: segments.length, processedSegments: 0, hasInstruction: request.instruction.trim().length > 0 };
    session.snapshot = { summary, instruction: request.instruction, segments };
    return structuredClone(summary);
  }
  /** Server-only access to one immutable selected segment. Never expose this method as a browser request. */
  analysisSegment(signal: AbortSignal, generation: number, projectPath: string, revision: number, snapshotId: string, index: number): { snapshotId: string; projectRevision: number; sourceId: string; sourcePath: string; sourceSha256: string; segmentId: string; offset: number; text: string; instruction: string } {
    const session = this.current(signal, generation, projectPath), snapshot = session?.snapshot;
    if (!session || !snapshot || snapshot.summary.id !== snapshotId || snapshot.summary.projectRevision !== revision || !Number.isSafeInteger(index) || index < 0 || index >= snapshot.segments.length) return fail("STALE_INPUT", "분석 입력 또는 프로젝트 버전이 변경되었습니다. 다시 준비하세요.");
    const segment = snapshot.segments[index], source = session.items.find(item => item.id === segment.sourceId), expected = snapshot.summary.sources.find(item => item.id === segment.sourceId);
    if (!source || !expected || source.sha256 !== expected.sha256 || source.projectRevision !== revision) return fail("STALE_INPUT", "분석 자료가 변경되었습니다. 다시 준비하세요.");
    return { snapshotId, projectRevision: revision, sourceId: source.id, sourcePath: source.relativePath, sourceSha256: source.sha256, segmentId: segment.id, offset: segment.start, text: source.text.slice(segment.start, segment.end), instruction: snapshot.instruction };
  }
  snapshotFiles(signal: AbortSignal, generation: number, projectPath: string, revision: number, snapshotId: string): AnalysisSourceMetadata[] {
    const session = this.current(signal, generation, projectPath), snapshot = session?.snapshot;
    if (!session || !snapshot || snapshot.summary.id !== snapshotId || snapshot.summary.projectRevision !== revision || snapshot.summary.sources.length !== session.items.length || session.items.some((source, index) => source.id !== snapshot.summary.sources[index]?.id || source.sha256 !== snapshot.summary.sources[index]?.sha256 || source.projectRevision !== revision)) return fail("STALE_INPUT", "분석 입력 또는 프로젝트 버전이 변경되었습니다. 다시 준비하세요.");
    return session.items.map(({ id, relativePath, bytes, sha256, projectRevision }) => ({ id, relativePath, bytes, sha256, projectRevision }));
  }
  /** Server-only summary of the same validated snapshot; contains no source text. */
  snapshotSummary(signal: AbortSignal, generation: number, projectPath: string, revision: number, snapshotId: string): AnalysisSnapshotSummary {
    this.snapshotFiles(signal, generation, projectPath, revision, snapshotId);
    return structuredClone(this.sessions.get(signal)!.snapshot!.summary);
  }
  read(signal: AbortSignal, generation: number, projectPath: string, sourceId: string, offset: number): AnalysisSourceChunk {
    const source = this.current(signal, generation, projectPath)?.items.find(item => item.id === sourceId);
    if (!source) return fail("NOT_FOUND", "선택한 자료를 찾을 수 없습니다.");
    const value = source.text;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length || offset > 0 && offset < value.length && /[\uDC00-\uDFFF]/.test(value[offset]) && /[\uD800-\uDBFF]/.test(value[offset - 1])) return fail("INVALID_INPUT", "자료 위치가 올바르지 않습니다.");
    let end = Math.min(value.length, offset + CHUNK_UNITS);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
    return { sourceId, text: value.slice(offset, end), offset, nextOffset: end < value.length ? end : null };
  }
}
