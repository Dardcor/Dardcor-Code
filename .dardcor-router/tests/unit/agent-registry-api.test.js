import { beforeEach, describe, expect, it, vi } from "vitest";

const canAccessLocalOnlyRoute = vi.fn();
const list = vi.fn();
const performAction = vi.fn();

vi.mock("@/dashboardGuard", () => ({ canAccessLocalOnlyRoute }));
vi.mock("@/lib/agents/service", () => ({
  agentRegistry: { list, performAction },
  getAgentRegistryLifecycle: vi.fn(() => [{ id: "event-1" }]),
}));

describe("agent registry API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAccessLocalOnlyRoute.mockResolvedValue(false);
    list.mockResolvedValue([{ id: "claude", status: { state: "available" } }]);
  });

  it("requires authenticated local access", async () => {
    const { GET } = await import("@/app/api/agents/route.js");
    const response = await GET(new Request("http://localhost/api/agents"));
    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns registry status, capabilities, and bounded lifecycle", async () => {
    canAccessLocalOnlyRoute.mockResolvedValue(true);
    const { GET } = await import("@/app/api/agents/route.js");
    const response = await GET(new Request("http://localhost/api/agents"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agents: [{ id: "claude", status: { state: "available" } }], lifecycle: [{ id: "event-1" }] });
  });

  it("returns an explicit unsupported response without launching anything", async () => {
    canAccessLocalOnlyRoute.mockResolvedValue(true);
    performAction.mockResolvedValue({ ok: false, code: "unsupported_action", error: "Launch is not supported for this integration" });
    const { POST } = await import("@/app/api/agents/[id]/actions/route.js");
    const response = await POST(new Request("http://localhost/api/agents/claude/actions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "launch" }),
    }), { params: Promise.resolve({ id: "claude" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "unsupported_action" });
    expect(performAction).toHaveBeenCalledWith("claude", "launch");
  });

  it("rejects unknown action input", async () => {
    canAccessLocalOnlyRoute.mockResolvedValue(true);
    const { POST } = await import("@/app/api/agents/[id]/actions/route.js");
    const response = await POST(new Request("http://localhost/api/agents/claude/actions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rm -rf" }),
    }), { params: Promise.resolve({ id: "claude" }) });
    expect(response.status).toBe(400);
    expect(performAction).not.toHaveBeenCalled();
  });
});
