import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getCacheStats: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/db/repos/metricsRepo.js", () => ({ getCacheStats: mocks.getCacheStats }));

const { GET } = await import("../../src/app/api/cache/stats/route.js");

describe("GET /api/cache/stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns persisted cache stats for the requested period", async () => {
    const stats = { period: "24h", layers: { L0: { probes: 1, hits: 1, readTokens: 20 }, L3: { refs: 2, bytesSaved: 50 } } };
    mocks.getCacheStats.mockResolvedValue(stats);

    const response = await GET({ url: "http://localhost/api/cache/stats?period=24h" });
    expect(mocks.getCacheStats).toHaveBeenCalledWith({ period: "24h" });
    expect(response).toEqual({ status: 200, body: stats });
  });

  it("rejects invalid periods without querying metrics", async () => {
    const response = await GET({ url: "http://localhost/api/cache/stats?period=year" });
    expect(response.status).toBe(400);
    expect(mocks.getCacheStats).not.toHaveBeenCalled();
  });
});
