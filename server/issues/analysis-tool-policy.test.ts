import { describe, expect, it } from "vitest";
import { AnalysisToolPolicyError, buildUnverifiedAnalysisToolPolicy as buildPolicy, requireCompatibleAnalysisRequirements, requireUnchangedAnalysisInventory, sameUnverifiedAnalysisInventory } from "./analysis-tool-policy.js";

const buildUnverifiedAnalysisToolPolicy = (config: unknown, pages: { cursor: string | null; response: unknown }[], plugins: unknown, requirements: unknown = { requirements: null }) => buildPolicy(config, pages, plugins, requirements);

const config = () => ({ config: { mcp_servers: { alpha: { env: { TOKEN: "synthetic-private-value" } }, beta: { url: "https://synthetic.invalid/private" } }, plugins: { 'fixture@local': { enabled: true } } } });
const pages = () => [
  { cursor: null, response: { data: [{ name: "alpha", pluginId: null, toolsError: null }], nextCursor: "next" } },
  { cursor: "next", response: { data: [{ name: "beta", pluginId: null, toolsError: null }, { name: "plugin_mcp", pluginId: "other@local", toolsError: null }], nextCursor: null } },
];
const plugins = () => ({ marketplaces: [{ plugins: [{ id: 'fixture@local', installed: true, enabled: true }, { id: 'unused@local', installed: false, enabled: false }] }], marketplaceLoadErrors: [] });

describe("unverified analysis tool restriction candidate", () => {
  it("requires a readable requirements reply and rejects managed hooks or incompatible mandatory settings", () => {
    for (const response of [undefined, {}, { requirements: false }, { requirements: { featureRequirements: { hooks: true } } }, { requirements: { featureRequirements: { codex_hooks: true } } }, { requirements: { featureRequirements: { plugins: true } } }, { requirements: { featureRequirements: { shell_tool: true } } }, { requirements: { featureRequirements: { hooks: "false" } } }, { requirements: { hooks: { SessionStart: [{ hooks: [{ command: "synthetic-private-hook" }] }] } } }, { requirements: { hooks: { windowsManagedDir: "synthetic-private-path" } } }, { requirements: { hooks: { UnknownFutureHook: [] } } }, { requirements: { additionalDeveloperInstructions: "synthetic-private-instruction" } }, { requirements: { allowedSandboxModes: ["workspace-write"] } }, { requirements: { allowedApprovalPolicies: ["on-request"] } }, { requirements: { allowedWebSearchModes: ["live"] } }]) {
      expect(() => requireCompatibleAnalysisRequirements(response)).toThrow(AnalysisToolPolicyError);
      expect(() => buildPolicy(config(), pages(), plugins(), response)).toThrow(AnalysisToolPolicyError);
    }
    expect(() => requireCompatibleAnalysisRequirements({ requirements: null })).not.toThrow();
    expect(() => requireCompatibleAnalysisRequirements({ requirements: { featureRequirements: { hooks: false }, hooks: { SessionStart: [], windowsManagedDir: null }, allowedSandboxModes: ["read-only"], allowedApprovalPolicies: ["never"], allowedWebSearchModes: ["disabled"] } })).not.toThrow();
    expect(() => buildPolicy(config(), pages(), plugins(), undefined)).toThrow(AnalysisToolPolicyError);
  });
  it("combines configuration and paginated inventory without returning secret-bearing fields", () => {
    const result = buildUnverifiedAnalysisToolPolicy(config(), pages(), plugins());
    expect(result).toMatchObject({ verified: false, serverCount: 2, pluginCount: 2, disabledPluginIds: ['fixture@local', 'other@local'], config: { 'mcp_servers.alpha.enabled': false, 'mcp_servers.beta.enabled': false, 'features.shell_tool': false, 'features.plugins': false, 'features.hooks': false, 'web_search': 'disabled' } });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-value"); expect(JSON.stringify(result)).not.toContain("synthetic.invalid");
  });
  it("rejects incomplete, reordered or cyclic pagination and discovery errors", () => {
    expect(() => buildUnverifiedAnalysisToolPolicy(config(), [pages()[0]], plugins())).toThrow(AnalysisToolPolicyError);
    expect(() => buildUnverifiedAnalysisToolPolicy(config(), [pages()[1], pages()[0]], plugins())).toThrow(AnalysisToolPolicyError);
    const cycle = pages(); cycle[1].response.nextCursor = "next"; expect(() => buildUnverifiedAnalysisToolPolicy(config(), cycle, plugins())).toThrow(AnalysisToolPolicyError);
    const original = pages(); const broken = [{ ...original[0], response: { ...original[0].response, data: [{ ...original[0].response.data[0], toolsError: "synthetic failure" }] } }, original[1]];
    expect(() => buildUnverifiedAnalysisToolPolicy(config(), broken, plugins())).toThrow(AnalysisToolPolicyError);
    expect(() => buildUnverifiedAnalysisToolPolicy(config(), pages(), { marketplaces: [], marketplaceLoadErrors: [{ message: "private" }] })).toThrow(AnalysisToolPolicyError);
  });
  it("rejects untrusted names which could change dotted override paths", () => {
    for (const name of ["../other", "foo.bar", "escape\npath", "a".repeat(65)]) {
      expect(() => buildUnverifiedAnalysisToolPolicy({ config: { mcp_servers: { [name]: {} } } }, [{ cursor: null, response: { data: [], nextCursor: null } }], plugins())).toThrow(AnalysisToolPolicyError);
    }
    const malformed = pages(); malformed[0].response.data[0].name = "a.b";
    expect(() => buildUnverifiedAnalysisToolPolicy(config(), malformed, plugins())).toThrow(AnalysisToolPolicyError);
  });
  it("rejects malformed plugin metadata rather than interpreting it as disabled", () => {
    expect(() => buildUnverifiedAnalysisToolPolicy(config(), pages(), { marketplaces: [{ plugins: [{ id: 'x', installed: 'false', enabled: false }] }], marketplaceLoadErrors: [] })).toThrow(AnalysisToolPolicyError);
    expect(() => buildUnverifiedAnalysisToolPolicy({ config: { plugins: { 'x\nkey': {} } } }, pages(), plugins())).toThrow(AnalysisToolPolicyError);
  });
  it("detects changes even when the set of server names stays the same", () => {
    const first = buildUnverifiedAnalysisToolPolicy(config(), pages(), plugins());
    const identical = buildUnverifiedAnalysisToolPolicy(config(), pages(), plugins());
    const next = config(); next.config.mcp_servers.alpha.env.TOKEN = "another-synthetic-private-value";
    const changed = buildUnverifiedAnalysisToolPolicy(next, pages(), plugins());
    expect(sameUnverifiedAnalysisInventory(first, identical)).toBe(true);
    expect(sameUnverifiedAnalysisInventory(first, changed)).toBe(false);
    expect(() => requireUnchangedAnalysisInventory(first, identical)).not.toThrow();
    expect(() => requireUnchangedAnalysisInventory(first, changed)).toThrow(AnalysisToolPolicyError);
    const malformed = { ...first, inventoryHash: "" };
    expect(sameUnverifiedAnalysisInventory(malformed, malformed)).toBe(false);
    expect(first.config).toEqual(changed.config);
    expect(JSON.stringify(changed)).not.toContain("another-synthetic-private-value");
    const policyChanged = buildUnverifiedAnalysisToolPolicy(config(), pages(), plugins(), { requirements: { featureRequirements: { hooks: false } } });
    expect(sameUnverifiedAnalysisInventory(first, policyChanged)).toBe(false);
  });
  it("rejects oversized and unserializable inventory without revealing its contents", () => {
    const oversized = { config: { notes: "x".repeat(2 * 1024 * 1024) } };
    expect(() => buildUnverifiedAnalysisToolPolicy(oversized, pages(), plugins())).toThrow(AnalysisToolPolicyError);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => buildUnverifiedAnalysisToolPolicy({ config: circular }, pages(), plugins())).toThrow(AnalysisToolPolicyError);
  });
});
