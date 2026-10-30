import { mkdtemp, readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationStore, parseArchive, type ConversationArchive } from "./conversation-store.js";
import { createRunSnapshot, transitionTask } from "./orchestration.js";

function archive(): ConversationArchive {
  return {
    version: 1, activeConversationId: "chat-1",
    conversations: [{
      id: "chat-1", title: "이전 작업", createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", preview: "합성 데이터", messageCount: 1,
      projectPath: "C:\\synthetic-project", workspaceMode: "project", threadId: "saved-thread", assistantText: "부분 응답", contextSummary: "이전 결과", taskOutputs: { task: "부분 작업" }, activities: [], activeRun: null,
      messages: [
        { id: "user-1", role: "user", text: "파일을 이어서 수정", timestamp: "2026-10-25T00:00:00Z", status: "completed" },
        { id: "reply-1", role: "assistant", text: "부분 응답", timestamp: "2026-10-25T00:00:00Z", status: "streaming" },
      ],
    }],
  };
}

describe("local conversation history", () => {
  it('preserves custom title metadata and remains compatible with archives without a title source',async()=>{
    expect(parseArchive(JSON.stringify(archive())).conversations[0].title).toBe('이전 작업');
    const root=await mkdtemp(path.join(os.tmpdir(),'auto-codex-name-')),data=archive();data.conversations[0].title='내가 저장한 이름';data.conversations[0].titleSource='user';const store=new ConversationStore(root);await store.save(data);const loaded=await new ConversationStore(root).load();expect(loaded?.conversations[0]).toMatchObject({title:'내가 저장한 이름',titleSource:'user',threadId:'saved-thread'});
    expect(()=>parseArchive(JSON.stringify({...data,conversations:[{...data.conversations[0],titleSource:'model-authority'}]}))).toThrow();
  });
  it("loads prior project, transcript, partial results and persistent thread after a new store instance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auto-codex-history-"));
    const store = new ConversationStore(root);
    await expect(store.load()).resolves.toBeNull();
    await store.save(archive());
    const restored = await new ConversationStore(root).load();
    expect(restored?.activeConversationId).toBe("chat-1");
    expect(restored?.conversations[0]).toMatchObject({ projectPath: "C:\\synthetic-project", threadId: "saved-thread", assistantText: "부분 응답", taskOutputs: { task: "부분 작업" } });
    expect(restored?.conversations[0].messages.map((message) => message.status)).toEqual(["completed", "interrupted"]);
    expect(JSON.stringify(restored)).not.toContain("approvalId");
  });

  it("settles a previously running team without restarting tasks or keeping approval-waiting status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auto-codex-history-"));
    const data = archive();
    let run = createRunSnapshot({ prompt: "합성 테스트", mode: "team", tasks: [{ id: "plan", title: "계획", description: "테스트", kind: "coordinate", access: "read", agentRole: "coordinator", dependsOn: [], order: 0 }] });
    run = transitionTask(run, "plan", "running");
    run = transitionTask(run, "plan", "waitingApproval");
    data.conversations[0].activeRun = run;
    const store = new ConversationStore(root);
    await store.save(data);
    const recovered = (await store.load())!.conversations[0];
    expect(recovered.activeRun?.status).toBe("interrupted");
    expect(recovered.activeRun?.tasks[0].status).toBe("interrupted");
    expect(recovered.activeRun?.agents.some((agent) => agent.status === "working" || agent.status === "waitingApproval")).toBe(false);
  });

  it("serializes concurrent saves and keeps conversations from multiple projects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auto-codex-history-"));
    const store = new ConversationStore(root);
    const first = archive();
    const second = archive();
    second.conversations.push({ ...second.conversations[0], id: "chat-2", projectPath: "C:\\other-project" });
    second.activeConversationId = "chat-2";
    await Promise.all([store.save(first), store.save(second)]);
    const loaded = await store.load();
    expect(loaded?.activeConversationId).toBe("chat-2");
    expect(loaded?.conversations).toHaveLength(2);
  });

  it("reports corruption without overwriting the original", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auto-codex-history-"));
    const directory = path.join(root, ".local-data");
    await mkdir(directory);
    const file = path.join(directory, "history.json");
    await writeFile(file, "{truncated");
    await expect(new ConversationStore(root).load()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{truncated");
  });

  it("rejects directory junctions escaping the fixed storage root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auto-codex-history-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "auto-codex-outside-"));
    await symlink(outside, path.join(root, ".local-data"), process.platform === "win32" ? "junction" : "dir");
    await expect(new ConversationStore(root).save(archive())).rejects.toThrow("밖");
  });

  it("rejects unknown schemas, missing active IDs and malformed run/task data", () => {
    expect(() => parseArchive(JSON.stringify({ ...archive(), version: 999 }))).toThrow();
    expect(() => parseArchive(JSON.stringify({ ...archive(), activeConversationId: "unknown" }))).toThrow();
    const invalid = archive();
    (invalid.conversations[0] as unknown as Record<string, unknown>).activeRun = { tasks: [{}] };
    expect(() => parseArchive(JSON.stringify(invalid))).toThrow();
  });
});
