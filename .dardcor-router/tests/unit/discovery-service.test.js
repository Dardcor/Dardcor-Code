import { describe, expect, it, vi } from "vitest";
import { createDiscoveryService } from "../../src/lib/discovery/service.js";

function dependencies(overrides = {}) {
  return {
    a2aRegistry: () => [{ id: "a2a.find", name: "Find provider", description: "provider lookup", schema: { properties: {} } }],
    mcpRegistry: () => [{ name: "models.list", description: "model lookup", scope: "mcp:models:read", inputSchema: { type: "object" } }],
    skills: [{ id: "catalog-chat", name: "Chat", description: "chat endpoint", endpoint: "/v1/chat/completions" }],
    endpoints: [{ id: "responses", method: "POST", path: "/api/v1/responses", category: "llm", auth: "public-api-key", capability: "Responses", status: "available", description: "response generation" }],
    providers: { codex: { id: "codex", name: "Codex", description: "OpenAI provider" } },
    models: [{ provider: "codex", model: "gpt-5", name: "GPT 5" }],
    agentRegistry: { list: vi.fn(async () => [{ id: "claude", name: "Claude Code", kind: "cli", status: { state: "configured" }, pathOnDisk: "/secret/bin" }]) },
    ...overrides,
  };
}

describe("discovery aggregation service", () => {
  it("keeps A2A, MCP, and catalog skills distinct", async () => {
    const result = await createDiscoveryService(dependencies()).listAgentSkills();
    expect(result.items.map((item) => item.source)).toEqual(["a2a", "mcp", "catalog"]);
    expect(result.sources.every((source) => source.status === "available")).toBe(true);
  });

  it("searches case-insensitively and applies repeated type and status filters", async () => {
    const service = createDiscoveryService(dependencies());
    const search = await service.getDiscoverySnapshot({ query: "RESPONSES" });
    expect(search.items.map((item) => item.id)).toEqual(["responses"]);

    const filtered = await service.getDiscoverySnapshot({ types: ["agent", "endpoint"], statuses: ["configured"] });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toMatchObject({ type: "agent", id: "claude", status: "configured" });
  });

  it("reports a failed source without hiding healthy sources or creating fallback data", async () => {
    const service = createDiscoveryService(dependencies({ mcpRegistry: () => { throw new Error("/private/path secret"); } }));
    const result = await service.getDiscoverySnapshot();
    expect(result.sources.find((source) => source.id === "mcp")).toEqual({
      id: "mcp", status: "unavailable", count: 0, error: "Source unavailable",
    });
    expect(result.items.some((item) => item.source === "mcp")).toBe(false);
    expect(result.items.some((item) => item.source === "a2a")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/private/path");
    expect(JSON.stringify(result)).not.toContain("/secret/bin");
  });

  it("keeps endpoint list and aggregate endpoint entries in parity", async () => {
    const service = createDiscoveryService(dependencies());
    const endpoints = await service.listApiEndpoints();
    const snapshot = await service.getDiscoverySnapshot({ types: ["endpoint"] });
    expect(snapshot.items.map((item) => item.id)).toEqual(endpoints.items.map((item) => item.id));
  });
});
