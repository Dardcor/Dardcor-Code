import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDiscoverySnapshot: vi.fn(),
  listAgentSkills: vi.fn(),
  listApiEndpoints: vi.fn(),
  next: Symbol("next"),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("@/lib/discovery/service", () => ({
  getDiscoverySnapshot: mocks.getDiscoverySnapshot,
  listAgentSkills: mocks.listAgentSkills,
  listApiEndpoints: mocks.listApiEndpoints,
}));
vi.mock("next/server", () => ({ NextResponse: {
  next: vi.fn(() => mocks.next),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  redirect: vi.fn((url) => ({ status: 307, url })),
} }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, validateApiKey: mocks.validateApiKey }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));

const aggregate = await import("../../src/app/api/discovery/route.js");
const skills = await import("../../src/app/api/discovery/skills/route.js");
const endpoints = await import("../../src/app/api/discovery/endpoints/route.js");
const { proxy } = await import("../../src/dashboardGuard.js");

function guardRequest(pathname, token) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers({ host: "router.example.com" }),
    cookies: { get: vi.fn(() => token ? { value: token } : undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("discovery APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.getDiscoverySnapshot.mockResolvedValue({ items: [], counts: { total: 0 }, sources: [] });
    mocks.listAgentSkills.mockResolvedValue({ items: [], sources: [] });
    mocks.listApiEndpoints.mockResolvedValue({ items: [], sources: [] });
  });

  it("is denied without dashboard auth and allowed with a valid dashboard token", async () => {
    const denied = await proxy(guardRequest("/api/discovery"));
    expect(denied).toMatchObject({ status: 401, body: { error: "Unauthorized" } });

    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    expect(await proxy(guardRequest("/api/discovery", "valid"))).toBe(mocks.next);
  });

  it("bounds query and repeated filters and returns uncached JSON", async () => {
    const query = "x".repeat(150);
    const response = await aggregate.GET(new Request(`http://localhost/api/discovery?query=${query}&type=agent&type=skill&status=available&status=configured`));
    expect(mocks.getDiscoverySnapshot).toHaveBeenCalledWith({
      query: "x".repeat(100), types: ["agent", "skill"], statuses: ["available", "configured"],
    });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("exposes stable skills and endpoints contracts with no-store", async () => {
    for (const route of [skills, endpoints]) {
      const response = await route.GET(new Request("http://localhost/api/discovery"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ items: [], sources: [] });
    }
  });
});
