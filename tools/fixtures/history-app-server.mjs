// Synthetic JSONL fixture. Never invokes Codex, tools, a model or the network.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method || message.id === undefined) return;
  appendFileSync(process.env.AUTO_CODEX_TEST_REQUESTS, `${JSON.stringify(message)}\n`);
  const result = message.method === "thread/start" ? { thread: { id: randomUUID() } }
    : message.method === "thread/resume" ? { thread: { id: message.params.threadId } }
    : message.method === "turn/start" ? { turn: { id: randomUUID() } }
    : message.method === "model/list" ? { data: [] }
    : message.method === "skills/list" ? { data: [] } : {};
  send({ id: message.id, result });
  if (message.method !== "turn/start") return;
  const threadId = message.params.threadId;
  const turn = result.turn;
  setTimeout(() => {
    send({ method: "turn/started", params: { threadId, turn } });
    send({ method: "item/agentMessage/delta", params: { threadId, turnId: turn.id, delta: "합성 응답 · 기록 복원 검증" } });
    if (message.params.outputSchema && JSON.stringify(message.params.input).includes("HOLD_FOR_RESTART")) {
      send({ id: "fixture-approval", method: "item/permissions/requestApproval", params: { threadId, turnId: turn.id, permissions: { network: { enabled: true } } } });
    } else send({ method: "turn/completed", params: { threadId, turn: { ...turn, status: "completed" } } });
  }, 50);
});
