import { createHash } from "node:crypto";
import path from "node:path";

/** Candidate restrictions for a future analysis runtime. This module never authorizes dispatch. */
export class AnalysisToolPolicyError extends Error {
  constructor() { super("분석 도구 목록을 안전하게 확인할 수 없습니다."); }
}
type RecordValue = Record<string, unknown>;
type InventoryPage = { cursor: string | null; response: unknown };
export type UnverifiedAnalysisToolPolicy = { verified: false; config: Record<string, boolean | string>; disabledPluginIds: string[]; serverCount: number; pluginCount: number; inventoryHash: string };
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value));
const invalid = (): never => { throw new AnalysisToolPolicyError(); };
const serverName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const pluginId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
const managedHookEvents = new Set(["Interrupt", "PermissionRequest", "PostCompact", "PostModelRequest", "PostToolUse", "PreCompact", "PreModelRequest", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "SubagentStart", "SubagentStop", "UserPromptSubmit"]);
const understoodRequirements = new Set(["featureRequirements", "hooks", "additionalDeveloperInstructions", "allowedSandboxModes", "allowedApprovalPolicies", "allowedWebSearchModes"]);

/** Check effective configuration separately: a disabled hook inventory may be empty. */
export function requireNoConfiguredAnalysisHooks(response: unknown): void {
  if (!record(response) || !record(response.config)) return invalid();
  const hooks = response.config.hooks;
  if (hooks !== undefined && hooks !== null && (!record(hooks) || Object.keys(hooks).length !== 0)) return invalid();
}

/** A clean list is a prerequisite, not proof that all hooks are absent. */
export function requireNoListedAnalysisHooks(response: unknown, cwd: string): void {
  if (typeof cwd !== "string" || cwd.length > 32768 || cwd.includes("\0") || !path.isAbsolute(cwd) || !record(response) || !Array.isArray(response.data) || response.data.length !== 1) return invalid();
  const entry = response.data[0];
  if (!record(entry) || typeof entry.cwd !== "string" || entry.cwd.length > 32768 || entry.cwd.includes("\0") || !path.isAbsolute(entry.cwd) || !Array.isArray(entry.hooks) || entry.hooks.length !== 0 || !Array.isArray(entry.errors) || entry.errors.length !== 0 || !Array.isArray(entry.warnings) || entry.warnings.length !== 0) return invalid();
  const actual = path.normalize(entry.cwd), expected = path.normalize(cwd);
  if (process.platform === "win32" ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected) return invalid();
}

/** Reject known incompatible managed requirements. An accepted reply still proves no isolation. */
export function requireCompatibleAnalysisRequirements(response: unknown): void {
  if (!record(response) || !Object.hasOwn(response, "requirements")) return invalid();
  const requirements = response.requirements;
  if (requirements === null) return;
  if (!record(requirements)) return invalid();
  // A new or unsupported policy may affect execution even if its meaning is unknown.
  if (Object.keys(requirements).length > 128 || Object.entries(requirements).some(([key, value]) => !understoodRequirements.has(key) && value !== null && value !== undefined)) return invalid();
  const features = requirements.featureRequirements;
  if (features !== null && features !== undefined) {
    if (!record(features) || Object.keys(features).length > 512 || Object.values(features).some(value => typeof value !== "boolean")) return invalid();
    // Future feature names can introduce capabilities we do not yet understand.
    // Reject every forced-on feature, even if it might ultimately be harmless.
    if (Object.values(features).some(value => value === true)) return invalid();
  }
  const hooks = requirements.hooks;
  if (hooks !== null && hooks !== undefined) {
    if (!record(hooks) || Object.keys(hooks).length > managedHookEvents.size + 2) return invalid();
    for (const [key, value] of Object.entries(hooks)) {
      if (key === "managedDir" || key === "windowsManagedDir") { if (value !== null && value !== undefined && value !== "") return invalid(); }
      else if (!managedHookEvents.has(key) || !Array.isArray(value) || value.length !== 0) return invalid();
    }
  }
  if (requirements.additionalDeveloperInstructions !== null && requirements.additionalDeveloperInstructions !== undefined && requirements.additionalDeveloperInstructions !== "") return invalid();
  for (const [key, wanted] of [["allowedSandboxModes", "read-only"], ["allowedApprovalPolicies", "never"], ["allowedWebSearchModes", "disabled"]] as const) {
    const allowed = requirements[key];
    if (allowed !== null && allowed !== undefined && (!Array.isArray(allowed) || allowed.length > 128 || !allowed.includes(wanted))) return invalid();
  }
}

/**
 * Builds a deny candidate from server-owned App Server replies, without logging configuration.
 * `verified: false` is intentional: local plugin enumeration and dynamic tools may be incomplete,
 * and turn-level plugin overrides cannot prevent thread-start hooks. Never dispatch from this result.
 */
export function buildUnverifiedAnalysisToolPolicy(configResponse: unknown, pages: InventoryPage[], pluginResponse: unknown, requirementsResponse: unknown, hooksResponse: unknown, cwd: string): UnverifiedAnalysisToolPolicy {
  requireCompatibleAnalysisRequirements(requirementsResponse);
  requireNoListedAnalysisHooks(hooksResponse, cwd);
  if (!record(configResponse) || !record(configResponse.config) || !Array.isArray(pages) || pages.length < 1 || pages.length > 64 || !record(pluginResponse) || !Array.isArray(pluginResponse.marketplaces) || pluginResponse.marketplaces.length > 128 || !Array.isArray(pluginResponse.marketplaceLoadErrors) || pluginResponse.marketplaceLoadErrors.length !== 0) return invalid();
  const serverNames = new Set<string>(), pluginIds = new Set<string>();
  const configured = configResponse.config.mcp_servers;
  if (configured !== undefined && !record(configured)) return invalid();
  if (record(configured)) {
    const names = Object.keys(configured); if (names.length > 512) return invalid();
    for (const name of names) { if (!serverName(name) || !record(configured[name])) return invalid(); serverNames.add(name); }
  }
  const configuredPlugins = configResponse.config.plugins;
  if (configuredPlugins !== undefined && !record(configuredPlugins)) return invalid();
  if (record(configuredPlugins)) {
    const names = Object.keys(configuredPlugins); if (names.length > 512) return invalid();
    for (const id of names) { if (!pluginId(id) || !record(configuredPlugins[id])) return invalid(); pluginIds.add(id); }
  }
  let expectedCursor: string | null = null; const seenCursors = new Set<string>(), seenServers = new Set<string>(); let count = 0;
  for (const page of pages) {
    if (!record(page) || page.cursor !== expectedCursor || !record(page.response) || !Array.isArray(page.response.data) || page.response.data.length > 512) return invalid();
    for (const entry of page.response.data) {
      if (!record(entry) || !serverName(entry.name) || !(entry.pluginId === null || entry.pluginId === undefined || pluginId(entry.pluginId)) || !(entry.toolsError === null || entry.toolsError === undefined)) return invalid();
      const key = JSON.stringify([entry.pluginId ?? null, entry.name]);
      if (seenServers.has(key)) return invalid();
      seenServers.add(key);
      count++; if (count > 512) return invalid();
      if (typeof entry.pluginId === "string") pluginIds.add(entry.pluginId); else serverNames.add(entry.name);
    }
    const next = page.response.nextCursor;
    if (!(next === null || next === undefined || typeof next === "string" && next.length > 0 && next.length <= 1024 && !seenCursors.has(next))) return invalid();
    expectedCursor = next ?? null; if (expectedCursor) seenCursors.add(expectedCursor);
  }
  if (expectedCursor !== null || serverNames.size > 512 || pluginIds.size > 512) return invalid();
  for (const market of pluginResponse.marketplaces) {
    if (!record(market) || !Array.isArray(market.plugins) || market.plugins.length > 512) return invalid();
    for (const plugin of market.plugins) {
      if (!record(plugin) || !pluginId(plugin.id) || typeof plugin.installed !== "boolean" || typeof plugin.enabled !== "boolean") return invalid();
      if (plugin.installed || plugin.enabled) pluginIds.add(plugin.id);
    }
  }
  if (pluginIds.size > 512) return invalid();
  // Private change detector only: the input can contain credentials. Never log, persist or expose its digest.
  let inventory: string;
  try { inventory = JSON.stringify([configResponse, pages, pluginResponse, requirementsResponse, hooksResponse]); } catch { return invalid(); }
  if (Buffer.byteLength(inventory, "utf8") > 2 * 1024 * 1024) return invalid();
  const inventoryHash = createHash("sha256").update(inventory).digest("hex");
  // Candidate restrictions modeled on Codex's temporary structured requests.
  // A setting being present here does not prove it is supported or enforced by
  // the installed CLI, nor that managed policy cannot override it.
  const config: Record<string, boolean | string> = {
    'features.apps': false, 'features.code_mode': false, 'features.code_mode_only': false,
    'features.context_management': false, 'features.current_time_reminder': false,
    'features.deferred_executor': false, 'features.enable_fanout': false, 'features.goals': false,
    'features.hooks': false, 'features.image_generation': false, 'features.memories': false,
    'features.multi_agent': false, 'features.multi_agent_v2': false, 'features.plugins': false,
    'features.request_permissions_tool': false, 'features.shell_snapshot': false,
    'features.shell_tool': false, 'features.standalone_web_search': false, 'features.token_budget': false,
    'features.tool_suggest': false, 'features.unified_exec': false, 'features.view_image': false,
    'cloud.skills.enabled': false, 'skills.include_instructions': false,
    'tools.experimental_request_user_input.enabled': false, 'tools.update_plan.enabled': false,
    'web_search': 'disabled',
  };
  for (const name of [...serverNames].sort()) config[`mcp_servers.${name}.enabled`] = false;
  return { verified: false, config, disabledPluginIds: [...pluginIds].sort(), serverCount: serverNames.size, pluginCount: pluginIds.size, inventoryHash };
}
export function sameUnverifiedAnalysisInventory(first: UnverifiedAnalysisToolPolicy, second: UnverifiedAnalysisToolPolicy): boolean {
  return Boolean(first && second && first.verified === false && second.verified === false && typeof first.inventoryHash === "string" && /^[a-f0-9]{64}$/.test(first.inventoryHash) && first.inventoryHash === second.inventoryHash);
}
export function requireUnchangedAnalysisInventory(first: UnverifiedAnalysisToolPolicy, second: UnverifiedAnalysisToolPolicy): void {
  if (!sameUnverifiedAnalysisInventory(first, second)) throw new AnalysisToolPolicyError();
}
