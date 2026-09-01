import { describe, expect, it } from "vitest";
import { resolveCodexLaunch } from "./codex-app-server.js";

describe("resolveCodexLaunch", () => {
  it("uses cmd.exe on Windows so npm codex.cmd shims resolve", () => {
    const launch = resolveCodexLaunch("win32", {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(launch).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "codex app-server"],
    });
  });

  it("wraps an explicit cmd shim with the Windows command processor", () => {
    const launch = resolveCodexLaunch("win32", {
      ComSpec: "cmd.exe",
      CODEX_BIN: "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
    });
    expect(launch.command).toBe("cmd.exe");
    expect(launch.args.at(-1)).toBe('"C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd" app-server');
  });

  it("launches the binary directly on non-Windows platforms", () => {
    expect(resolveCodexLaunch("linux", {})).toEqual({ command: "codex", args: ["app-server"] });
  });
});

