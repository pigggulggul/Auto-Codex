export type AnalysisSourceMetadata = { id: string; relativePath: string; bytes: number; sha256: string; projectRevision: number };
export type AnalysisSourceList = { items: AnalysisSourceMetadata[]; totalBytes: number };
export type AnalysisSourceChunk = { sourceId: string; text: string; offset: number; nextOffset: number | null };
export type AnalysisSnapshotRequest = { expectedRevision: number; expectedSources: { id: string; sha256: string }[]; instruction: string };
export type AnalysisSnapshotSummary = { id: string; projectRevision: number; sources: { id: string; relativePath: string; sha256: string; segmentCount: number }[]; totalSegments: number; processedSegments: 0; hasInstruction: boolean };
export type AnalysisFreshness = { snapshotId: string; projectRevision: number; files: { id: string; state: "unchanged" | "changed" | "unavailable" }[] };
