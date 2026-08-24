import { beforeEach, describe, expect, it, vi } from "vitest";

const canAccessLocalOnlyRoute = vi.fn();
const sendToChild = vi.fn();

vi.mock("@/dashboardGuard", () => ({ canAccessLocalOnlyRoute }));
vi.mock("@/lib/mcp/stdioSseBridge", () => ({
  findPlugin: vi.fn(() => true),
  registerSession: vi.fn(() => "sid"),
  unregisterSession: vi.fn(),
  sendToChild,
  isRunning: vi.fn(() => false),
}));
vi.mock("@/shared/constants/coworkPlugins", () => ({
  LOCAL_STDIO_PLUGINS: [],
  DEFAULT_PLUGINS: [],
}));

const context = { params: Promise.resolve({ plugin: "browsermcp" }) };

describe("MCP route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAccessLocalOnlyRoute.mockResolvedValue(false);
  });

  it("denies direct SSE route access", async () => {
    const { GET } = await import("@/app/api/mcp/[plugin]/sse/route.js");
    const response = await GET(new Request("http://localhost/api/mcp/browsermcp/sse"), context);
    expect(response.status).toBe(403);
  });

  it("denies direct message route access before forwarding", async () => {
    const { POST } = await import("@/app/api/mcp/[plugin]/message/route.js");
    const response = await POST(new Request("http://localhost/api/mcp/browsermcp/message", {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    }), context);
    expect(response.status).toBe(403);
    expect(sendToChild).not.toHaveBeenCalled();
  });

  it("denies direct status route access", async () => {
    const { GET } = await import("@/app/api/mcp/status/route.js");
    const response = await GET(new Request("http://localhost/api/mcp/status"));
    expect(response.status).toBe(403);
  });

  it("records accepted tool-call forwarding without recording notifications", async () => {
    canAccessLocalOnlyRoute.mockResolvedValue(true);
    delete globalThis.__dardcor-codeMcpHealth;
    const { POST } = await import("@/app/api/mcp/[plugin]/message/route.js");

    await POST(new Request("http://localhost/api/mcp/browsermcp/message", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
      headers: { "content-type": "application/json" },
    }), context);
    await POST(new Request("http://localhost/api/mcp/browsermcp/message", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      headers: { "content-type": "application/json" },
    }), context);

    expect(globalThis.__dardcor-codeMcpHealth.invocations.get("browsermcp")).toHaveLength(1);
  });
});
