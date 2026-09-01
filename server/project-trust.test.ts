import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectTrust, trustProject } from "./project-trust.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-codex-trust-"));
  temporaryRoots.push(root);
  const project = path.join(root, "project");
  await mkdir(project);
  return { root, project, environment: { USERPROFILE: root } };
}

describe("project trust config", () => {
  it("adds a trusted project entry to a missing config", async () => {
    const { project, environment } = await fixture();
    await trustProject(project, environment);

    expect(await readProjectTrust(project, environment)).toBe("trusted");
    await expect(readFile(path.join(environment.USERPROFILE, ".codex", "config.toml"), "utf8"))
      .resolves.toContain('trust_level = "trusted"');
  });

  it("updates an existing project section without removing other settings", async () => {
    const { root, project, environment } = await fixture();
    const config = path.join(root, ".codex", "config.toml");
    await mkdir(path.dirname(config), { recursive: true });
    await writeFile(config, `[projects.'${project}']\ntrust_level = "untrusted"\nother_setting = true\n\n[other]\nvalue = 1\n`, "utf8");

    await trustProject(project, environment);

    const content = await readFile(config, "utf8");
    expect(await readProjectTrust(project, environment)).toBe("trusted");
    expect(content).toContain('trust_level = "trusted"');
    expect(content).toContain("other_setting = true");
    expect(content).toContain("[other]");
  });
});
