export type ArtifactStatus='pending'|'verified'|'partial'|'missing'|'unverifiable';
export type CheckStatus='notRun'|'passed'|'failed'|'unverifiable';
export interface RuntimeEvidence {
  itemId:string;threadId:string;turnId:string;taskId?:string;observedAt:string;
  type:'fileChange'|'commandExecution';status:'inProgress'|'completed'|'failed'|'declined';
  changes?:{path:string;kind:'add'|'update'|'delete'}[];rejectedChanges?:number;
  commandLabel?:string;commandCwd?:string;checkKind?:'typecheck'|'test'|'build';exitCode?:number;durationMs?:number;
}
export interface ArtifactCandidate {
  relativePath:string;reportedChange:'add'|'update'|'delete';itemId:string;threadId:string;turnId:string;sequence:number;sourceStatus:RuntimeEvidence['status'];
}
export interface ArtifactFile {
  id:string;relativePath:string;hash:string;size:number;kind:'code'|'image'|'binary';mime:string;
  reportedChange:ArtifactCandidate['reportedChange'];itemId:string;threadId:string;turnId:string;capturedAt:string;
}
export interface ExecutionRecord {
  itemId:string;threadId:string;turnId:string;taskId?:string;label:string;status:RuntimeEvidence['status'];
  checkKind?:RuntimeEvidence['checkKind'];exitCode?:number;durationMs?:number;observedAt:string;sequence:number;
  artifactHashes:Record<string,string>;bindingValid:boolean;outputRetained:false;
}
export interface ArtifactManifest {
  contractVersion:1;id:string;projectId:string;generationId:string;snapshotId:string;version:number;
  phase:'recording'|'collecting'|'ready'|'interrupted';status:ArtifactStatus;checkStatus:CheckStatus;
  sequence:number;candidates:ArtifactCandidate[];commands:ExecutionRecord[];files:ArtifactFile[];
  rejected:number;missing:number;deleted?:string[];checkpointBytes?:number;limitations:string[];createdAt:string;capturedAt?:string;resultId?:string;
}
