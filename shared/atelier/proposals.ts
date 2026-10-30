/** Persisted AI suggestions; never execution authority or confirmed domain values. */
export type ProposalPurpose='brief'|'flow'|'concept'|'style'|'blueprint';
export type ProposalState='preparing'|'running'|'ready'|'failed'|'stale'|'interrupted';
export type ProposalFailure='MODEL_FAILED'|'INVALID_OUTPUT'|'STALE_INPUT'|'IMAGE_UNSUPPORTED'|'RUNTIME_UNAVAILABLE'|'POLICY_DENIED'|'INTERRUPTED';
export interface ProposalCandidate {id:string;targetId:string;patch:Record<string,unknown>;originalPatch:Record<string,unknown>;rationale:string;assumptions:string;state:'proposed'|'edited'|'excluded'|'applied';answers?:Record<string,string>}
export interface DesignProposal {
 id:string;projectId:string;version:number;purpose:ProposalPurpose;state:ProposalState;baseRevision:number;applicableRevision:number;
 targetIds:string[];targetVersions:Record<string,number>;before:Record<string,Record<string,unknown>>;inputHash:string;idempotencyKey:string;
 createdAt:string;updatedAt:string;source:{kind:'codex-app-server';model:string;effort?:string;threadId?:string;turnId?:string};
 candidates:ProposalCandidate[];error?:{code:ProposalFailure;message:string};
 clarifications?:Array<{question:string;answer:string}>;
}
