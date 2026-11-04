import { describe, expect, it } from "vitest";
import { AnalysisToolPolicyError, buildUnverifiedAnalysisToolPolicy, requireUnchangedAnalysisInventory, sameUnverifiedAnalysisInventory } from "./analysis-tool-policy.js";

const config = () => ({ config: { mcp_servers: { alpha: { env: { TOKEN: "synthetic-private-value" } }, beta: { url: "https://synthetic.invalid/private" } }, plugins: { 'fixture@local': { enabled: true } } } });
const pages = () => [
  { cursor: null, response: { data: [{ name: "alpha", pluginId: null, toolsError: null }], nextCursor: "next" } },
  { cursor: "next", response: { data: [{ name: "beta", pluginId: null, toolsError: null }, { name: "plugin_mcp", pluginId: "other@local", toolsError: null }], nextCursor: null } },
];
const plugins = () => ({ marketplaces: [{ plugins: [{ id: 'fixture@local', installed: true, enabled: true }, { id: 'unused@local', installed: false, enabled: false }] }], marketplaceLoadErrors: [] });

describe("unverified analysis tool restriction candidate", () => {
  it("combines configuration and paginated inventory without returning secret-bearing fields", () => {
    const result = buildUnverifiedAnalysisToolPolicy(config(), pages(), plugins());
    expect(result).toMatchObject({ verified: false, serverCount: 2, pluginCount: 2, disabledPluginIds: ['fixture@local', 'other@local'], config: { 'mcp_servers.alpha.enabled': false, 'mcp_servers.beta.enabled': false, 'features.shell_tool': false, 'web_search': 'disabled' } });
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
  });
  it("rejects oversized and unserializable inventory without revealing its contents", () => {
    const oversized = { config: { notes: "x".repeat(2 * 1024 * 1024) } };
    expect(() => buildUnverifiedAnalysisToolPolicy(oversized, pages(), plugins())).toThrow(AnalysisToolPolicyError);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => buildUnverifiedAnalysisToolPolicy({ config: circular }, pages(), plugins())).toThrow(AnalysisToolPolicyError);
  });
});
