import { parentPort, workerData } from "node:worker_threads";
import { IssueStore } from "./store.js";
import { dispatchIssueWorkerRequest, safeIssueWorkerError } from "./worker-service.js";
import type { IssueWorkerReply } from "./worker-contract.js";

if (!parentPort || !workerData || typeof workerData.root !== "string") throw new Error("Issue worker requires a bridge-owned root.");
const port = parentPort;
let store: IssueStore;
try { store = await IssueStore.open(workerData.root); port.postMessage({ ready: true }); }
catch (error) { port.postMessage({ ready: false, error: safeIssueWorkerError(error) }); port.close(); throw new Error("Issue storage worker initialization failed"); }

let queue: Promise<void> = Promise.resolve();
port.on("message", (message: unknown) => {
  if (!message || typeof message !== "object" || !("id" in message) || !Number.isSafeInteger(message.id) || Number(message.id) < 1) return;
  const id = Number(message.id);
  queue = queue.then(async () => {
    if ("close" in message && message.close === true && Object.keys(message).length === 2) { store.close(); port.postMessage({ id, closed: true }); port.close(); return; }
    if (!("request" in message) || Object.keys(message).length !== 2) throw new Error("Invalid worker message");
    const result = await dispatchIssueWorkerRequest(store, message.request);
    const reply: IssueWorkerReply = { id, ok: true, result }; port.postMessage(reply);
  }).catch(error => { const reply: IssueWorkerReply = { id, ok: false, error: safeIssueWorkerError(error) }; port.postMessage(reply); });
});
