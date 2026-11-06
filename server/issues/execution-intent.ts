import { createHash } from "node:crypto";
import type { ExecutionJournal, JournalRecord } from "./execution-journal.js";

const MAX_INSTRUCTION_BYTES = 64 * 1024;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

export type ExecutionIntentInput = {
  projectId: string; documentId: string; issueId: string; projectRevision: number; documentRevision: number;
  instruction: string;
  policy: { sandbox: "read-only" | "workspace-write"; networkAccess: false; approval: "manual"; revision: number };
};
export type FrozenExecutionIntent = Readonly<Omit<ExecutionIntentInput, "policy"> & { policy: Readonly<ExecutionIntentInput["policy"]> }>;

export class ExecutionIntentError extends Error {
  readonly code = "INVALID_INPUT";
  constructor() { super("INVALID_INPUT"); }
}
const invalid = (): never => { throw new ExecutionIntentError(); };

/** Accept explicit data fields only; do not silently omit unknown execution settings. */
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
  if (keys.length !== allowed.length || keys.some(key => typeof key !== "string" || !allowed.includes(key) || !descriptors[key]?.enumerable || !("value" in descriptors[key]))) return invalid();
  return value as Record<string, unknown>;
}

/** Copy policy before asynchronous work so the caller cannot change its declared values. */
export function freezeExecutionPolicy(value: unknown): Readonly<ExecutionIntentInput["policy"]> {
  const policy = fields(value, ["sandbox", "networkAccess", "approval", "revision"]);
  if ((policy.sandbox !== "read-only" && policy.sandbox !== "workspace-write") || policy.networkAccess !== false || policy.approval !== "manual" || !validRevision(policy.revision)) return invalid();
  return Object.freeze({ sandbox: policy.sandbox, networkAccess: false, approval: "manual", revision: policy.revision });
}

/** A deterministic identity for this declared intent, not authorization or sandbox enforcement. */
export function freezeExecutionIntent(input: unknown): { intent: FrozenExecutionIntent; digest: string } {
  const source = fields(input, ["projectId", "documentId", "issueId", "projectRevision", "documentRevision", "instruction", "policy"]);
  const frozenPolicy = freezeExecutionPolicy(source.policy);
  if (!validId(source.projectId) || !validId(source.documentId) || !validId(source.issueId) || !validRevision(source.projectRevision) || !validRevision(source.documentRevision) || typeof source.instruction !== "string" || !source.instruction.trim() || source.instruction.includes("\0") || Buffer.byteLength(source.instruction, "utf8") > MAX_INSTRUCTION_BYTES) return invalid();
  const intent: FrozenExecutionIntent = Object.freeze({ projectId: source.projectId, documentId: source.documentId, issueId: source.issueId, projectRevision: source.projectRevision, documentRevision: source.documentRevision, instruction: source.instruction, policy: frozenPolicy });
  const digest = createHash("sha256").update("auto-codex-issue-intent-v1\0", "utf8").update(JSON.stringify(intent), "utf8").digest("hex");
  return { intent, digest };
}

/** The caller is responsible for project authorization, actual policy enforcement and admission. */
export function prepareExecutionIntent(journal: ExecutionJournal, input: unknown, idempotencyKey: string): { intent: FrozenExecutionIntent; record: JournalRecord; created: boolean } {
  const { intent, digest } = freezeExecutionIntent(input);
  const prepared = journal.prepare({ projectId: intent.projectId, issueId: intent.issueId, projectRevision: intent.projectRevision, idempotencyKey, requestDigest: digest });
  return { intent, ...prepared };
}
