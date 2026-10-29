import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActivityEvent, ConversationMessage, ConversationSummary, RunSnapshot, WorkspaceMode } from "../shared/protocol.js";
import { interruptRun } from "./orchestration.js";

export type ConversationRecord = ConversationSummary & {
  projectPath: string | null;
  workspaceMode: WorkspaceMode;
  threadId: string | null;
  assistantText: string;
  taskOutputs: Record<string, string>;
  activities: ActivityEvent[];
  activeRun: RunSnapshot | null;
  contextSummary: string;
  messages: ConversationMessage[];
};

export type ConversationArchive = {
  version: 1;
  activeConversationId: string;
  conversations: ConversationRecord[];
};

const MAX_BYTES = 64 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const nullableString = (value: unknown) => value === null || typeof value === "string";
const optionalString = (value: unknown) => value === undefined || typeof value === "string";
const states = new Set(["idle", "connecting", "thinking", "reading", "editing", "running", "waitingApproval", "success", "error"]);
const roles = new Set(["general", "builder", "researcher", "documenter", "visual", "qa", "integrator", "coordinator"]);

function validRun(run: unknown): boolean {
  if (run === null) return true;
  if (!object(run) || !["id", "prompt", "createdAt"].every((key) => typeof run[key] === "string")
    || !["solo", "team"].includes(String(run.mode)) || !["planning", "running", "verifying", "completed", "failed", "interrupted"].includes(String(run.status))
    || !nullableString(run.completedAt) || !optionalString(run.summary) || !Array.isArray(run.tasks) || run.tasks.length > 10 || !Array.isArray(run.agents) || run.agents.length > 8) return false;
  return run.tasks.every((task) => object(task)
    && ["id", "title", "description", "agentId"].every((key) => typeof task[key] === "string")
    && roles.has(String(task.agentRole)) && strings(task.dependsOn)
    && ["coordinate", "research", "design", "implementation", "verification", "integration", "report"].includes(String(task.kind))
    && ["read", "write"].includes(String(task.access))
    && ["queued", "ready", "running", "waitingApproval", "completed", "failed", "blocked", "interrupted"].includes(String(task.status))
    && typeof task.order === "number" && typeof task.attempt === "number"
    && ["resultSummary", "error", "skillPath"].every((key) => optionalString(task[key]))
    && ["threadId", "turnId", "startedAt", "completedAt"].every((key) => nullableString(task[key])))
    && run.agents.every((agent) => object(agent) && roles.has(String(agent.role)) && states.has(String(agent.activity))
      && ["idle", "ready", "working", "waitingApproval", "completed", "error"].includes(String(agent.status))
      && typeof agent.id === "string" && typeof agent.name === "string" && strings(agent.taskIds)
      && ["currentTaskId", "threadId", "turnId"].every((key) => nullableString(agent[key])));
}

export function parseArchive(raw: string): ConversationArchive {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.version !== 1 || typeof data.activeConversationId !== "string" || !Array.isArray(data.conversations)) throw new Error("지원하지 않는 대화 저장 형식입니다.");
  const ids = new Set<string>();
  for (const record of data.conversations) {
    if (!object(record) || !["id", "title", "createdAt", "updatedAt", "preview", "assistantText", "contextSummary"].every((key) => typeof record[key] === "string")
      || ids.has(String(record.id)) || !Number.isSafeInteger(record.messageCount) || Number(record.messageCount) < 0
      || !["project", "research"].includes(String(record.workspaceMode)) || !nullableString(record.projectPath) || !nullableString(record.threadId)
      || !object(record.taskOutputs) || !Object.values(record.taskOutputs).every((text) => typeof text === "string")
      || !Array.isArray(record.activities) || !record.activities.every((activity) => object(activity) && states.has(String(activity.state)) && ["id", "title", "source", "timestamp"].every((key) => typeof activity[key] === "string") && optionalString(activity.detail))
      || !validRun(record.activeRun) || !Array.isArray(record.messages) || !record.messages.every((message) => object(message)
        && ["id", "text", "timestamp"].every((key) => typeof message[key] === "string") && ["user", "assistant"].includes(String(message.role))
        && ["streaming", "completed", "failed", "interrupted"].includes(String(message.status))
        && (message.run === undefined || validRun(message.run))
        && (message.taskOutputs === undefined || (object(message.taskOutputs) && Object.values(message.taskOutputs).every((text) => typeof text === "string"))))) throw new Error("대화 저장 파일의 데이터가 올바르지 않습니다.");
    ids.add(String(record.id));
  }
  if (!ids.has(data.activeConversationId)) throw new Error("저장된 현재 대화를 찾을 수 없습니다.");
  return data as ConversationArchive;
}

/** A saved execution is history, never authorization to restart tools. */
export function recoverConversation(record: ConversationRecord): ConversationRecord {
  const recoverRun = (run: RunSnapshot | null | undefined) => run && ["planning", "running", "verifying"].includes(run.status) ? interruptRun({
    ...run,
    tasks: run.tasks.map((task) => ["queued", "ready", "running", "waitingApproval"].includes(task.status) ? { ...task, error: task.error ?? "앱 종료로 중단되었습니다. 다음 요청에서 이어가세요." } : task),
  }) : run;
  return {
    ...record,
    activeRun: recoverRun(record.activeRun) ?? null,
    messages: record.messages.map((message) => message.status === "streaming" ? {
      ...message, status: "interrupted",
      run: recoverRun(message.run),
    } : message),
  };
}

/** Fixed local path, serialized atomic replacements; never browser-supplied paths. */
export class ConversationStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly root: string) {}

  private async directory(): Promise<string> {
    const directory = path.join(this.root, ".local-data");
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (info.isSymbolicLink() || await realpath(directory) !== path.join(await realpath(this.root), ".local-data")) throw new Error("대화 저장 경로가 로컬 데이터 폴더 밖을 가리킵니다.");
    return directory;
  }

  async load(): Promise<ConversationArchive | null> {
    const file = path.join(await this.directory(), "history.json");
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_BYTES) throw new Error("대화 저장 파일의 형식 또는 크기가 올바르지 않습니다.");
      const archive = parseArchive(await readFile(file, "utf8"));
      return { ...archive, conversations: archive.conversations.map(recoverConversation) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  save(archive: ConversationArchive): Promise<void> {
    const raw = JSON.stringify(archive);
    const operation = this.queue.then(async () => {
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("대화 저장 용량(64MB)을 초과했습니다.");
      const directory = await this.directory();
      // A fresh exclusive temp file avoids following pre-existing links.
      const temporary = path.join(directory, `history-${crypto.randomUUID()}.tmp`);
      await writeFile(temporary, raw, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
      await rename(temporary, path.join(directory, "history.json"));
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
