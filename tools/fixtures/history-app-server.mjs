// Synthetic JSONL fixture. Never invokes Codex, tools, a model or the network.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const probes = new Map();
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method && probes.has(message.id)) {
    const probe = probes.get(message.id);
    probes.delete(message.id);
    appendFileSync(process.env.AUTO_CODEX_TEST_REQUESTS, `${JSON.stringify({ method: "synthetic/probe-response", kind: probe.method, result: message.result })}\n`);
    probe.finish();
    return;
  }
  if (!message.method || message.id === undefined) return;
  appendFileSync(process.env.AUTO_CODEX_TEST_REQUESTS, `${JSON.stringify(message)}\n`);
  const result = message.method === "thread/start" ? { thread: { id: randomUUID() } }
    : message.method === "thread/resume" ? { thread: { id: message.params.threadId } }
    : message.method === "turn/start" ? { turn: { id: randomUUID() } }
    : message.method === "model/list" ? { data: [] }
    : message.method === "skills/list" ? { data: (message.params.cwds ?? []).map(cwd => ({ cwd, skills: [
      { name: "mobile-app-delivery", description: "Build mobile Android and iOS apps", path: "synthetic-mobile", scope: "user", enabled: true },
      { name: "repo-only", description: "Repository-only instructions", path: "synthetic-repo", scope: "repo", enabled: true },
      { name: "unknown-scope", description: "Unknown scope", path: "synthetic-unknown", enabled: true },
    ] })) } : {};
  if (message.method === "turn/start" && JSON.stringify(message.params.input).includes("HOLD_START_FOR_INTERRUPT")) {
    setTimeout(() => {
      send({id:message.id,result});
      send({method:"turn/started",params:{threadId:message.params.threadId,turn:result.turn}});
    },150);
    return;
  }
  send({ id: message.id, result });
  if (message.method === "turn/interrupt") send({method:"turn/completed",params:{threadId:message.params.threadId,turn:{id:message.params.turnId,status:"interrupted"}}});
  if (message.method !== "turn/start") return;
  const threadId = message.params.threadId;
  const turn = result.turn;
  setTimeout(() => {
    send({ method: "turn/started", params: { threadId, turn } });
    if (String(message.params.input?.[0]?.text ?? "").endsWith("READ_ONLY_APPROVAL_PROBE")) {
      const methods = ["item/permissions/requestApproval", "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "execCommandApproval", "applyPatchApproval"];
      let remaining = methods.length;
      for (const [index, method] of methods.entries()) {
        const probeId = `probe-${turn.id}-${index}`;
        probes.set(probeId, { method, finish: () => { if (--remaining === 0) send({ method: "turn/completed", params: { threadId, turn: { ...turn, status: "completed" } } }); } });
        send({ id: probeId, method, params: { threadId, turnId: turn.id, permissions: { fileSystem: { write: ["synthetic-path"] }, network: { enabled: true } } } });
      }
      return;
    }
    send({ method: "item/agentMessage/delta", params: { threadId, turnId: turn.id, delta: "합성 응답 · 기록 복원 검증" } });
    if (message.params.outputSchema && JSON.stringify(message.params.input).includes("HOLD_FOR_RESTART")) {
      send({ id: "fixture-approval", method: "item/permissions/requestApproval", params: { threadId, turnId: turn.id, permissions: { network: { enabled: true } } } });
    } else send({ method: "turn/completed", params: { threadId, turn: { ...turn, status: "completed" } } });
  }, 50);
});
