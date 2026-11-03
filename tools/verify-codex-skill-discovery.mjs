// Local CLI protocol check: isolated synthetic Codex home, no model turns or credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { projectSkills, researchSkills } from "../build-server/server/skill-discovery.js";

const binary = process.argv[2];
if (!binary || !path.isAbsolute(binary)) throw new Error("Pass the absolute path of an installed Codex executable.");
const base = os.tmpdir();
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(path.join(base, "codex-skill-protocol-"));
const codexHome = path.join(scratch, "codex-home");
const workspace = path.join(scratch, "project");
const secondWorkspace = path.join(scratch, "project-two");
const nestedWorkspace = path.join(workspace, "nested");
await mkdir(secondWorkspace, { recursive: true });
for (const dir of [path.join(codexHome, "skills", "user-fixture"), path.join(workspace, ".agents", "skills", "repo-fixture"), path.join(workspace, ".agents", "skills", "mobile-app-delivery"), path.join(nestedWorkspace, ".agents", "skills", "mobile-app-delivery")]) {
  await mkdir(dir, { recursive: true });
  const name = path.basename(dir);
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Synthetic local discovery check.\n---\n\n# Synthetic\n`);
}
const child = spawn(binary, ["app-server"], {
  cwd: workspace,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: scratch, TMP: scratch, CODEX_HOME: codexHome },
});
let nextId = 0;
const pending = new Map();
const fail = (error) => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); };
child.on("error", fail);
child.on("exit", (code) => fail(new Error(`App Server exited (${code})`)));
child.stderr.resume();
createInterface({ input: child.stdout }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(`Protocol error: ${message.error.code}`));
  else request.resolve(message.result);
});
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
try {
  await request("initialize", { clientInfo: { name: "skill-fixture", version: "1" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  const result = await request("skills/list", { cwds: [workspace, secondWorkspace, nestedWorkspace], forceReload: true });
  assert.ok((result.data ?? []).some((entry) => path.resolve(entry.cwd).toLowerCase() === path.resolve(workspace).toLowerCase()));
  const second = (result.data ?? []).find((entry) => path.resolve(entry.cwd).toLowerCase() === path.resolve(secondWorkspace).toLowerCase());
  assert.ok(second);
  assert.ok((second.skills ?? []).some((skill) => skill.name === "user-fixture"));
  assert.ok(!(second.skills ?? []).some((skill) => skill.name === "repo-fixture"));
  const skills = (result.data ?? []).flatMap((entry) => entry.skills ?? []);
  assert.equal(skills.find((skill) => skill.name === "user-fixture")?.scope?.toLowerCase(), "user");
  assert.equal(skills.find((skill) => skill.name === "repo-fixture")?.scope?.toLowerCase(), "repo");
  const entries = (result.data ?? []).map((entry) => ({ cwd: entry.cwd, skills: entry.skills ?? [] }));
  const merged = await projectSkills(entries, secondWorkspace, workspace);
  assert.equal(merged.find((skill) => skill.name === "mobile-app-delivery")?.scope, "app");
  assert.ok(!merged.some((skill) => skill.name === "repo-fixture"));
  const nested = await projectSkills(entries, nestedWorkspace, workspace);
  assert.equal(path.resolve(nested.find((skill) => skill.name === "mobile-app-delivery")?.path), path.join(nestedWorkspace, ".agents", "skills", "mobile-app-delivery", "SKILL.md"));
  assert.ok(researchSkills(skills).some((skill) => skill.name === "user-fixture"));
  assert.ok(!researchSkills(skills).some((skill) => skill.name === "repo-fixture"));
  console.log("PASS: actual App Server discovery, cross-project fallback and folderless scope filtering; no model calls.");
} finally {
  child.stdin.end();
  child.kill();
}
