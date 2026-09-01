import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProjectTrust = "trusted" | "untrusted";

function configPath(environment: NodeJS.ProcessEnv = process.env): string {
  const codexHome = environment.CODEX_HOME?.trim();
  if (codexHome) return path.join(codexHome, "config.toml");
  const userProfile = environment.USERPROFILE?.trim() || environment.HOME?.trim();
  if (!userProfile) throw new Error("Codex 사용자 폴더를 찾을 수 없습니다.");
  return path.join(userProfile, ".codex", "config.toml");
}

function normalizedPath(value: string): string {
  return path.normalize(path.resolve(value)).toLowerCase();
}

function decodeTomlKey(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1).replaceAll("\\\\", "\\").replaceAll('\\"', '"');
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function isProjectHeader(line: string, projectPath: string): boolean {
  const match = line.trim().match(/^\[projects\.(.+)\]\s*(?:#.*)?$/);
  return Boolean(match && normalizedPath(decodeTomlKey(match[1])) === normalizedPath(projectPath));
}

function updateTrustConfig(source: string, projectPath: string): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hadBom = source.startsWith("\uFEFF");
  const body = hadBom ? source.slice(1) : source;
  const lines = body.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => isProjectHeader(line, projectPath));

  if (headerIndex === -1) {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length > 0) lines.push("");
    lines.push(`[projects.${JSON.stringify(projectPath)}]`, 'trust_level = "trusted"');
  } else {
    let endIndex = lines.length;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      if (/^\s*\[/.test(lines[index])) {
        endIndex = index;
        break;
      }
    }
    const trustIndex = lines.slice(headerIndex + 1, endIndex).findIndex((line) => /^\s*trust_level\s*=/.test(line));
    if (trustIndex === -1) {
      lines.splice(headerIndex + 1, 0, 'trust_level = "trusted"');
    } else {
      const actualIndex = headerIndex + 1 + trustIndex;
      const indent = lines[actualIndex].match(/^\s*/)?.[0] ?? "";
      lines[actualIndex] = `${indent}trust_level = "trusted"`;
    }
  }

  const updated = lines.join(newline);
  return `${hadBom ? "\uFEFF" : ""}${updated.endsWith(newline) ? updated : `${updated}${newline}`}`;
}

export async function readProjectTrust(
  projectPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProjectTrust> {
  try {
    const source = await readFile(configPath(environment), "utf8");
    const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => isProjectHeader(line, projectPath));
    if (headerIndex === -1) return "untrusted";
    for (let index = headerIndex + 1; index < lines.length && !/^\s*\[/.test(lines[index]); index += 1) {
      const match = lines[index].match(/^\s*trust_level\s*=\s*["']([^"']+)["']/);
      if (match) return match[1] === "trusted" ? "trusted" : "untrusted";
    }
    return "untrusted";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "untrusted";
    throw error;
  }
}

export async function trustProject(
  projectPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const target = configPath(environment);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  let source = "";
  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = `${target}.auto-codex-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporary, updateTrustConfig(source, projectPath), "utf8");
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
