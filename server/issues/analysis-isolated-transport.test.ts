import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { IsolatedAnalysisTransport } from "./analysis-isolated-transport.js";
import { PlanningDraft } from "./planning-draft.js";

const input = { snapshotId: "snapshot", projectRevision: 1, sourceId: "source", sourcePath: "private-path", sourceSha256: "a".repeat(64), segmentId: "segment", offset: 0, text: "synthetic text", instruction: "" };
const worker = (source: string) => spawn(process.execPath, ["-e", source], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const create = (source: string) => new IsolatedAnalysisTransport({ root: process.cwd(), model: "synthetic-model", permitted: () => true, validateProject: async () => {}, spawnWorker: () => worker(source), timeoutMs: 3000, cancelTimeoutMs: 1000 });

describe("isolated analysis worker", () => {
  it("sends bounded semantic and proposal payloads without the project path or authority fields", async () => {
    const doc = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-1", revision: 1, sources: [], categories: [], requirements: [{ id: "req-1", categoryId: null, text: "표시", origin: "user" }], issues: [] };
    const draft = new PlanningDraft(doc, 1).read();
    const inspect = (kind: string, keys: string) => create(`let b='';process.stdin.on('data',x=>{b+=x;if(!b.includes('\\n'))return;const data=JSON.parse(b);if(data.kind!==${JSON.stringify(kind)}||Object.keys(data).sort().join(',')!==${JSON.stringify(keys)}||b.includes('private-path'))process.exit(2);process.stdout.write(JSON.stringify({ok:true,termination:'confirmed',output:'{}'})+'\\n',()=>process.exit(0))});`);
    const semantic = inspect("semantic", "document,kind,model,text");
    expect(await semantic.runSemantic({ projectRevision: 1, draftRevision: 1, document: draft.document, segment: input }, new AbortController().signal)).toBe("{}");
    const proposal = inspect("proposal", "document,kind,model,request");
    expect(await proposal.runProposal(draft, "문구 검토", new AbortController().signal)).toBe("{}");
  });
  it("sends only the selected text, instruction and model to the worker", async () => {
    const transport = create(`let b='';process.stdin.on('data',x=>{b+=x;if(!b.includes('\\n'))return;const data=JSON.parse(b);if(Object.keys(data).sort().join(',')!=='instruction,model,text'||JSON.stringify(data).includes('private-path'))process.exit(2);process.stdout.write(JSON.stringify({ok:true,termination:'confirmed',output:JSON.stringify({requirements:[]})})+'\\n',()=>process.exit(0))});`);
    expect(await transport.run(input, new AbortController().signal)).toBe('{"requirements":[]}');
    expect(transport.busy).toBe(false);
  });
  it("releases admission after a confirmed worker failure", async () => {
    const transport = create(`process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({ok:false,termination:'confirmed'})+'\\n');process.exit(1)});`);
    await expect(transport.run(input, new AbortController().signal)).rejects.toThrow(/failed/);
    expect(transport.busy).toBe(false);
  });
  it("retains admission when the worker exits without confirming shutdown", async () => {
    const transport = create(`process.stdin.once('data',()=>process.exit(1));`);
    await expect(transport.run(input, new AbortController().signal)).rejects.toThrow(/termination/);
    expect(transport.busy).toBe(true);
  });
  it("retains admission if the worker does not confirm shutdown after cancellation", async () => {
    const transport = new IsolatedAnalysisTransport({ root: process.cwd(), model: "synthetic-model", permitted: () => true, validateProject: async () => {}, spawnWorker: () => worker(`process.stdin.resume();setInterval(()=>{},1000);`), timeoutMs: 100, cancelTimeoutMs: 100 });
    await expect(transport.run(input, new AbortController().signal)).rejects.toThrow(/termination/);
    expect(transport.busy).toBe(true);
  });
  it("waits for confirmed worker cleanup after interruption", async () => {
    const transport = create(`let b='';process.stdin.on('data',x=>{b+=x;if(b.includes('\\"cancel\\":true'))setTimeout(()=>{process.stdout.write(JSON.stringify({ok:false,termination:'confirmed'})+'\\n');process.exit(1)},30)});`);
    const controller = new AbortController(), run = transport.run(input, controller.signal);
    await vi.waitFor(() => expect(transport.busy).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 100)); controller.abort();
    expect(transport.busy).toBe(true); await expect(run).rejects.toThrow(/interrupted/); expect(transport.busy).toBe(false);
  });
  it("never starts a worker when cancellation wins project validation", async () => {
    let finish!: () => void; const validate = new Promise<void>(resolve => { finish = resolve; });
    const spawnWorker = vi.fn(() => worker("process.exit(0)"));
    const transport = new IsolatedAnalysisTransport({ root: process.cwd(), model: "synthetic-model", permitted: () => true, validateProject: () => validate, spawnWorker });
    const controller = new AbortController(), run = transport.run(input, controller.signal); controller.abort();
    await expect(run).rejects.toThrow(/cancelled/); finish(); await Promise.resolve(); expect(spawnWorker).not.toHaveBeenCalled(); expect(transport.busy).toBe(false);
  });
});
