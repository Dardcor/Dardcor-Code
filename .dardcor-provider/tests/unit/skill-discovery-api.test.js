import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  list: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  getSkill: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/dashboardGuard", () => ({ canAccessLocalOnlyRoute: mocks.canAccess }));
vi.mock("@/lib/skillDiscovery/service", () => ({
  listSkills: mocks.list,
  installSkill: mocks.install,
  uninstallSkill: mocks.uninstall,
  getSkill: mocks.getSkill,
}));

function request(body) {
  return new Request("http://localhost/api/skill-discovery/x/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.install.mockResolvedValue({ ok: true, installed: true, targets: [] });
  mocks.uninstall.mockResolvedValue({ ok: true, installed: false });
  mocks.list.mockResolvedValue({ items: [], counts: {}, sources: [], targets: [] });
  mocks.getSkill.mockResolvedValue(null);
});

describe("skill-discovery API", () => {
  it("denies install without local authentication", async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/skill-discovery/[id]/install/route.js");
    const response = await POST(request({ target: "miawrouter" }), { params: { id: "x" } });
    expect(response.status).toBe(403);
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("rejects oversized or malformed JSON bodies", async () => {
    const { POST } = await import("@/app/api/skill-discovery/[id]/install/route.js");
    const big = await POST(new Request("http://localhost/api/skill-discovery/x/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "miawrouter", junk: "x".repeat(5000) }),
    }), { params: { id: "x" } });
    expect(big.status).toBe(400);
    expect(mocks.install).not.toHaveBeenCalled();

    const bad = await POST(new Request("http://localhost/api/skill-discovery/x/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }), { params: { id: "x" } });
    expect(bad.status).toBe(400);
  });

  it("maps unknown target and not-found errors to 4xx", async () => {
    const { POST } = await import("@/app/api/skill-discovery/[id]/install/route.js");
    mocks.install.mockResolvedValueOnce({ ok: false, code: "UNKNOWN_TARGET", error: "Unknown install target" });
    expect((await POST(request({ target: "nope" }), { params: { id: "x" } })).status).toBe(400);
    mocks.install.mockResolvedValueOnce({ ok: false, code: "SKILL_NOT_FOUND", error: "Skill not found" });
    expect((await POST(request({ target: "miawrouter" }), { params: { id: "x" } })).status).toBe(404);
  });

  it("returns success with no-store headers and no file contents", async () => {
    const { POST } = await import("@/app/api/skill-discovery/[id]/install/route.js");
    mocks.install.mockResolvedValue({ ok: true, installed: true, skill: { id: "x", name: "X", source: "skills.sh" }, targets: [{ id: "miawrouter", label: "registry", command: "" }] });
    const response = await POST(request({ target: "miawrouter" }), { params: { id: "x" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).not.toHaveProperty("ownedFiles");
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password/i);
  });

  it("passes query filters to the list service", async () => {
    const { GET } = await import("@/app/api/skill-discovery/route.js");
    await GET({ url: "http://localhost/api/skill-discovery?query=chat&source=skills.sh&installed=false" });
    expect(mocks.list).toHaveBeenCalledWith({ query: "chat", source: "skills.sh", installed: "false" });
  });

  it("returns a no-store 404 for a missing skill detail", async () => {
    const { GET } = await import("@/app/api/skill-discovery/[id]/route.js");
    const response = await GET({ url: "http://localhost/api/skill-discovery/nope" }, { params: { id: "nope" } });
    expect(response.status).toBe(404);
  });
});
