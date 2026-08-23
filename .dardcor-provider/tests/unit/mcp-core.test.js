import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import {
  MCP_SCOPES,
  createMcpCore,
  createMiawToolRegistry,
  createStdioTransport,
} from "../../src/lib/mcp/core.js";
import { createMcpHttpHandler } from "../../src/lib/mcp/http.js";

const auth = (scopes = Object.values(MCP_SCOPES)) => ({
  authenticated: true,
  actor: "test-client",
  scopes,
});

function dependencies(overrides = {}) {
  return {
    listProviders: vi.fn(async () => [{ id: "p1", provider: "codex", apiKey: "secret" }]),
    listModels: vi.fn(async () => [{ fullModel: "codex/gpt-5", model: "gpt-5" }]),
    getCacheStats: vi.fn(async () => ({ period: "7d", layers: {} })),
    getQuotaSnapshot: vi.fn(async ({ connectionId }) => ({ connectionId, quotas: [] })),
    getCurrentStatus: vi.fn(async () => ({ status: "ok", providers: 1 })),
    searchMemories: vi.fn(async ({ query }) => [{ id: "m1", content: query }]),
    listMemories: vi.fn(async () => [{ id: "m1", content: "remember" }]),
    ...overrides,
  };
}

describe("MCP core", () => {
  it("handles newline-delimited JSON-RPC over stdio", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const core = createMcpCore({ registry: createMiawToolRegistry(dependencies()) });
    const line = new Promise((resolve) => output.once("data", (chunk) => resolve(chunk.toString())));
    const transport = createStdioTransport(core, { input, output, auth: auth() });

    input.write('{"jsonrpc":"2.0","id":9,"method":"ping"}\n');

    expect(JSON.parse(await line)).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
    transport.close();
  });

  it("negotiates MCP initialize and Streamable HTTP SSE", async () => {
    const core = createMcpCore({ registry: createMiawToolRegistry(dependencies()) });
    const handler = createMcpHttpHandler({ core, authorize: async () => auth() });
    const response = await handler(new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain('"protocolVersion":"2025-06-18"');
  });

  it("negotiates a supported client protocol version", async () => {
    const core = createMcpCore({ registry: createMiawToolRegistry(dependencies()) });
    const response = await core.handle({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" },
    }, auth());

    expect(response.result.protocolVersion).toBe("2024-11-05");
  });

  it("processes notifications without returning a JSON-RPC response", async () => {
    const deps = dependencies();
    const core = createMcpCore({ registry: createMiawToolRegistry(deps) });
    const response = await core.handle({
      jsonrpc: "2.0", method: "tools/call", params: { name: "models.list", arguments: {} },
    }, auth());

    expect(response).toBeNull();
    expect(deps.listModels).toHaveBeenCalledOnce();
  });

  it("advertises only the bounded read-only registry", async () => {
    const core = createMcpCore({ registry: createMiawToolRegistry(dependencies()) });
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, auth());

    expect(response.result.tools.map((tool) => tool.name)).toEqual([
      "providers.list",
      "models.list",
      "cache.stats",
      "quota.snapshot",
      "status.current",
      "memory.search",
      "memory.list",
    ]);
    expect(response.result.tools.some((tool) => /shell|file/i.test(tool.name))).toBe(false);
  });

  it("rejects unauthenticated and under-scoped calls", async () => {
    const core = createMcpCore({ registry: createMiawToolRegistry(dependencies()) });
    const request = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "memory.list", arguments: {} } };

    expect((await core.handle(request, { authenticated: false, scopes: [] })).error.code).toBe(-32001);
    expect((await core.handle(request, auth([MCP_SCOPES.PROVIDERS_READ]))).error.code).toBe(-32003);
  });

  it("validates tool arguments before invocation", async () => {
    const deps = dependencies();
    const core = createMcpCore({ registry: createMiawToolRegistry(deps) });
    const response = await core.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "memory.search", arguments: { query: "", limit: 500 } },
    }, auth());

    expect(response.error.code).toBe(-32602);
    expect(deps.searchMemories).not.toHaveBeenCalled();
  });

  it("times out handlers and records secret-free audit metadata", async () => {
    const audit = vi.fn();
    const deps = dependencies({ listModels: () => new Promise(() => {}) });
    const core = createMcpCore({
      registry: createMiawToolRegistry(deps),
      timeoutMs: 10,
      audit,
    });
    const response = await core.handle({
      jsonrpc: "2.0",
      id: "request-secret",
      method: "tools/call",
      params: { name: "models.list", arguments: { provider: "codex" } },
    }, { ...auth(), credential: "do-not-log" });

    expect(response.error.code).toBe(-32008);
    expect(audit).toHaveBeenCalledOnce();
    const event = audit.mock.calls[0][0];
    expect(event).toMatchObject({ tool: "models.list", actor: "test-client", outcome: "timeout" });
    expect(JSON.stringify(event)).not.toContain("do-not-log");
    expect(JSON.stringify(event)).not.toContain("request-secret");
  });

  it("consumes a handler rejection that arrives after timeout", async () => {
    let rejectLate;
    const late = new Promise((_, reject) => { rejectLate = reject; });
    const core = createMcpCore({
      registry: createMiawToolRegistry(dependencies({ listModels: () => late })),
      timeoutMs: 5,
    });
    const response = await core.handle({
      jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "models.list", arguments: {} },
    }, auth());

    rejectLate(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(response.error.code).toBe(-32008);
  });

  it("returns structured tool content and strips provider credentials", async () => {
    const core = createMcpCore({ registry: createMiawToolRegistry(dependencies()) });
    const response = await core.handle({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "providers.list", arguments: {} },
    }, auth());

    expect(response.result.structuredContent.providers[0]).toEqual({ id: "p1", provider: "codex" });
    expect(response.result.content[0].text).not.toContain("secret");
  });
});
