import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock modules ───────────────────────────────────────────────────
// We mock the stdioSseBridge and coworkPlugins so tests don't need real
// child processes or filesystem access.

const mockPlugins = [
  {
    name: "browsermcp",
    title: "Browser MCP",
    description: "Control your running Chrome",
    command: "npx",
    args: ["-y", "@browsermcp/mcp@latest"],
    toolNames: ["browser_navigate", "browser_snapshot", "browser_click"],
  },
];

const mockDefaults = [
  {
    name: "exa",
    title: "Exa",
    description: "Real-time web search",
    url: "https://mcp.exa.ai/mcp",
    transport: "http",
    oauth: false,
    toolNames: ["web_search_exa", "web_fetch_exa"],
  },
  {
    name: "tavily",
    title: "Tavily",
    description: "Real-time web search optimized for LLM agents",
    url: "https://mcp.tavily.com/mcp",
    transport: "http",
    oauth: true,
    toolNames: ["tavily_search", "tavily_extract"],
  },
];

vi.mock("@/lib/mcp/stdioSseBridge", () => {
  const running = new Set();
  return {
    isRunning: vi.fn((name) => running.has(name)),
    __setRunning: (name, val) => {
      if (val) running.add(name);
      else running.delete(name);
    },
    __runningSet: running,
  };
});

vi.mock("@/shared/constants/coworkPlugins", () => ({
  LOCAL_STDIO_PLUGINS: [
    {
      name: "browsermcp",
      title: "Browser MCP",
      description: "Control your running Chrome",
      command: "npx",
      args: ["-y", "@browsermcp/mcp@latest"],
      toolNames: ["browser_navigate", "browser_snapshot", "browser_click"],
    },
  ],
  DEFAULT_PLUGINS: [
    {
      name: "exa",
      title: "Exa",
      description: "Real-time web search",
      url: "https://mcp.exa.ai/mcp",
      transport: "http",
      oauth: false,
      toolNames: ["web_search_exa", "web_fetch_exa"],
    },
    {
      name: "tavily",
      title: "Tavily",
      description: "Real-time web search optimized for LLM agents",
      url: "https://mcp.tavily.com/mcp",
      transport: "http",
      oauth: true,
      toolNames: ["tavily_search", "tavily_extract"],
    },
  ],
}));

vi.mock("@/dashboardGuard", () => ({
  canAccessLocalOnlyRoute: vi.fn(async () => true),
}));

// ── Import after mocks ─────────────────────────────────────────────

let recordInvocation, GET;
let bridgeMock;

beforeEach(async () => {
  vi.resetModules();

  // Re-import to get fresh module with clean global state
  const mod = await import("@/app/api/mcp/status/route.js");
  recordInvocation = mod.recordInvocation;
  GET = mod.GET;

  bridgeMock = await import("@/lib/mcp/stdioSseBridge");
  bridgeMock.__runningSet.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean global health store
  delete globalThis.__dardcor-codeMcpHealth;
});

// ── Tests ──────────────────────────────────────────────────────────

describe("MCP status API", () => {
  it("reports that the authenticated API endpoint is responding", async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.api).toEqual({ responding: true, state: "responding" });
    expect(body.plugins).toHaveLength(3); // 1 local + 2 remote
    expect(body.bridge.localCount).toBe(1);
    expect(body.bridge.remoteCount).toBe(2);
  });

  it("reports local plugin as stopped by default", async () => {
    const res = await GET();
    const body = await res.json();
    const local = body.plugins.find((p) => p.name === "browsermcp");

    expect(local.running).toBe(false);
    expect(local.transport).toBe("stdio");
    expect(local.type).toBe("local");
  });

  it("reports local plugin as running when bridge is active", async () => {
    bridgeMock.__setRunning("browsermcp", true);

    const res = await GET();
    const body = await res.json();
    const local = body.plugins.find((p) => p.name === "browsermcp");

    expect(local.running).toBe(true);
    expect(body.bridge.runningCount).toBe(1);
  });

  it("exposes safe tool names without secrets", async () => {
    const res = await GET();
    const body = await res.json();

    for (const plugin of body.plugins) {
      expect(plugin.tools).toBeDefined();
      expect(Array.isArray(plugin.tools)).toBe(true);
      for (const tool of plugin.tools) {
        expect(tool.name).toBeTruthy();
        expect(typeof tool.name).toBe("string");
        // Ensure no URL/credential fields leak into tools
        expect(tool.url).toBeUndefined();
        expect(tool.key).toBeUndefined();
        expect(tool.token).toBeUndefined();
        expect(tool.secret).toBeUndefined();
      }
    }
  });

  it("remote plugin includes transport and oauth flag", async () => {
    const res = await GET();
    const body = await res.json();
    const exa = body.plugins.find((p) => p.name === "exa");
    const tavily = body.plugins.find((p) => p.name === "tavily");

    expect(exa.transport).toBe("http");
    expect(exa.oauth).toBe(false);
    expect(exa.type).toBe("remote");

    expect(tavily.transport).toBe("http");
    expect(tavily.oauth).toBe(true);
    expect(tavily.type).toBe("remote");
  });

  it("tracks invocation health via recordInvocation", async () => {
    recordInvocation("browsermcp", true);
    recordInvocation("browsermcp", true);
    recordInvocation("browsermcp", false);

    const res = await GET();
    const body = await res.json();
    const local = body.plugins.find((p) => p.name === "browsermcp");

    expect(local.health.total).toBe(3);
    expect(local.health.ok).toBe(2);
    expect(local.health.fail).toBe(1);
    expect(local.health.lastTs).toBeTypeOf("number");
  });

  it("health ring buffer caps at 50 entries", async () => {
    for (let i = 0; i < 60; i++) {
      recordInvocation("exa", i % 2 === 0);
    }

    const res = await GET();
    const body = await res.json();
    const exa = body.plugins.find((p) => p.name === "exa");

    expect(exa.health.total).toBe(50);
    // Last 10 were dropped: entries 50-59, where 50 is even (ok), 51 odd (fail), etc.
    // After dropping first 10, remaining start at entry 10: 10 even, 11 odd, ...
    // 50 entries: 25 ok, 25 fail
    expect(exa.health.ok).toBe(25);
    expect(exa.health.fail).toBe(25);
  });

  it("returns zero health when no invocations recorded", async () => {
    const res = await GET();
    const body = await res.json();
    const exa = body.plugins.find((p) => p.name === "exa");

    expect(exa.health.total).toBe(0);
    expect(exa.health.ok).toBe(0);
    expect(exa.health.fail).toBe(0);
    expect(exa.health.lastTs).toBeNull();
  });

  it("aggregate counts are correct", async () => {
    bridgeMock.__setRunning("browsermcp", true);

    const res = await GET();
    const body = await res.json();

    expect(body.bridge).toEqual({
      localCount: 1,
      remoteCount: 2,
      runningCount: 1,
      totalTools: 7, // 3 local + 2 exa + 2 tavily
    });
  });

  it("plugin cards have required display fields", async () => {
    const res = await GET();
    const body = await res.json();

    for (const p of body.plugins) {
      expect(p.name).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.transport).toBeTruthy();
      expect(p.type).toMatch(/^(local|remote)$/);
      expect(Array.isArray(p.tools)).toBe(true);
      expect(p.health).toBeDefined();
    }
  });
});
