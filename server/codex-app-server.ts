import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import path from "node:path";

type RequestId = number | string;

export type JsonObject = Record<string, unknown>;

export type ProtocolNotification = {
  method: string;
  params?: JsonObject;
};

export type ProtocolServerRequest = ProtocolNotification & {
  id: RequestId;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

type ProtocolResponse = {
  id: RequestId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type LaunchSpec = {
  command: string;
  args: string[];
};

export function resolveCodexLaunch(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): LaunchSpec {
  const configured = environment.CODEX_BIN?.trim();
  if (platform !== "win32") {
    return { command: configured || "codex", args: ["app-server"] };
  }

  const commandProcessor = environment.ComSpec
    || path.join(environment.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
  if (!configured) {
    // Windows npm installations expose codex.cmd. CreateProcess does not
    // reliably resolve PATHEXT shims, while cmd.exe does.
    return { command: commandProcessor, args: ["/d", "/s", "/c", "codex app-server"] };
  }
  if (/\.(cmd|bat)$/i.test(configured)) {
    const quoted = `"${configured.replaceAll('"', '""')}" app-server`;
    return { command: commandProcessor, args: ["/d", "/s", "/c", quoted] };
  }
  return { command: configured, args: ["app-server"] };
}

export class CodexAppServer extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<RequestId, PendingRequest>();
  private nextId = 1;
  private startPromise: Promise<void> | null = null;

  get ready(): boolean {
    return this.child !== null && !this.child.killed;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    const launch = resolveCodexLaunch();
    const childEnvironment = { ...process.env };
    if (!childEnvironment.CODEX_HOME && childEnvironment.USERPROFILE) {
      childEnvironment.CODEX_HOME = path.join(childEnvironment.USERPROFILE, ".codex");
    }
    const child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    child.once("error", (error) => {
      const hint = (error as NodeJS.ErrnoException).code === "ENOENT"
        ? " Codex CLI 또는 Windows 명령 처리기를 PATH에서 찾을 수 없습니다."
        : "";
      this.handleExit(new Error(`${error.message}.${hint}`));
    });
    child.once("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.handleExit(new Error(`codex app-server exited with ${detail}`));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.emit("diagnostic", chunk.trim()));

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "auto-codex",
        title: "Auto Codex Pet",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: ["item/reasoning/textDelta"],
      },
    });
    this.notify("initialized", {});
    this.emit("ready");
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error("codex app-server is not running"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: RequestId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    // Clear the reference before killing so the old child's asynchronous
    // exit event cannot tear down a new server started immediately after it.
    child?.kill();
  }

  private write(message: unknown): void {
    if (!this.child || this.child.killed || !this.child.stdin.writable) {
      throw new Error("codex app-server stdin is unavailable");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      this.emit("diagnostic", `Ignored malformed app-server output: ${line}`);
      return;
    }

    if ("id" in message && typeof message.method !== "string") {
      this.handleResponse(message as ProtocolResponse & JsonObject);
      return;
    }
    if (typeof message.method !== "string") return;
    if ("id" in message) {
      this.emit("request", message as unknown as ProtocolServerRequest);
    } else {
      this.emit("notification", message as ProtocolNotification);
    }
  }

  private handleResponse(response: ProtocolResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message || "Unknown app-server error"));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleExit(error: Error): void {
    if (!this.child && !this.startPromise) return;
    this.child = null;
    this.startPromise = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit("exit", error);
  }
}
