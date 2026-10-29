/** Documentation of the local domain. No external API or active connector is declared. */
export type DecisionStatus = 'unknown' | 'proposed' | 'confirmed' | 'excluded';
export type Provenance = 'user' | 'example' | 'observation' | 'external';
export interface Decision {
 id:string; version:number; value:string; status:DecisionStatus; source:Provenance;
 reason:string; scope:string; reviewNeeded:boolean;
 dependsOn?:string[]; screenIds?:string[]; assetIds?:string[]; referenceIds?:string[];
 scopeMode?:'global'|'targets'; conceptId?:string|null; fontAssetId?:string;
 history:Array<{version:number;value:string;status:DecisionStatus;scope:string;at:string}>;
}
export interface Region extends Decision {
 fileId:string; cropId:string; rect:{x:number;y:number;w:number;h:number};
 observation:string; interpretation:string; dimension:string; target:string;
 purpose:string; keep:string; change:string; avoid:string; useMode:string;
}
export interface Reference {id:string;name:string;url:string;fileId:string|null;note:string;role:string;regions:Region[]}
export interface Criterion {id:string;label:string;expected:string;scope:'visual'|'behavior';decisionIds?:string[]}
export interface Transition {id:string;from:string;to:string;kind:'next'|'branch'|'recovery'|'loop';condition:string;preserve:string}
export interface FlowGraph {version:number;reviewedVersion:number;entryId:string;terminalIds:string[];transitions:Transition[];branchPolicy:'pending'|'mapped'|'none';recoveryPolicy:'pending'|'mapped'|'none';branchReason:string;recoveryReason:string}
export interface OutputSelection {mode:'all'|'flows'|'screens'|'assets';ids:string[]}
export interface PromptSnapshot {
 id:string;number:number;revision:number;templateVersion:string;guideVersion:string;
 commonVersion:number;createdAt:string;decisions:Array<{id:string;version:number}>;
 referenceFileIds:string[];input:unknown;criteria:Criterion[];text:string;
 sections:Array<{id:string;title:string;body:string;decisionIds:string[];tab:string}>;
 draft:boolean;planId:string|null;
 selection?:OutputSelection;
}
export interface LocalFile {id:string;name:string;mime:string;ext:string;sha256:string;size:number}
export interface ReviewItem extends Criterion {
 verdict:'match'|'partial'|'mismatch'|'unverifiable'|'na';observation:string;evidence:string;
 target:string;keep:string;cause:string;resolution:'resolved'|'remaining'|'new-problem'|'unverifiable';
 regression:boolean;selected:boolean;
}
export interface ManualResult {id:string;number:number;snapshotId:string;fileId:string|null;source:string;screen:string;environment:string;instruction:string;execution:string;note:string;keep:string}
export interface DiagnosisCycle {id:string;resultId:string;snapshotId:string;parentReviewId:string|null;planId:string|null;scope:'visual'|'behavior';intent:string;intentReason:string;state:string;items:ReviewItem[]}
export interface RevisionPlan {id:string;reviewId:string;resultId:string;snapshotId:string;itemIds:string[];problem:string;cause:string;target:string;change:string;scope:string;keep:string;materials:string;check:string;confirmed:boolean}
/** Future handoff concept only. Actual transport/authentication remains unspecified. */
export interface HandoffDocument {
 contractVersion:1;projectId:string;snapshotId:string;purpose:string;scope:string;
 confirmedDecisions:Array<{id:string;version:number}>;files:LocalFile[];
 userRequested:boolean;externalRequestId?:string;
}
