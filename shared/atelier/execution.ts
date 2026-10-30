import type {ExecutionMode, ReasoningEffort} from '../protocol.js';
import type {PromptSnapshot} from './types.js';
import type {ArtifactStatus} from './artifacts.js';

export interface WorkspaceBinding {
  id:string; projectId:string; workspacePath:string; conversationId:string; version:number; createdAt:string;
}
export interface InputManifest {
  contractVersion:1; projectId:string; snapshotId:string; snapshotHash:string; promptHash:string;
  decisionVersions:PromptSnapshot['decisions']; selection:PromptSnapshot['selection'];
  bindingId:string; bindingVersion:number; conversationId:string; workspacePath:string;
  model:string; effort?:ReasoningEffort; skillMode:'auto'|'manual'; skillPath?:string;
  executionMode:ExecutionMode; networkAccess:false;
  files:{id:string;name:string;hash:string;size:number;role:'snapshot-input';relativePath:string}[];
  createdAt:string;
}
export type GenerationState='preparing'|'dispatching'|'running'|'waitingApproval'|'completed'|'failed'|'interrupted';
export interface DesignGeneration {
  id:string; projectId:string; snapshotId:string; bindingId:string; conversationId:string;
  version:number; purpose:'create'|'revise'; state:GenerationState; idempotencyKey:string; requestHash:string;
  input:InputManifest; stagingPath:string; createdAt:string; updatedAt:string;
  runtime:{runId?:string;tasks:{taskId:string;agentId:string;threadId?:string;turnId?:string}[];threadId?:string;turnId?:string};
  messageIds?:string[]; error?:{code:string;message:string}; artifactStatus:ArtifactStatus;
}
