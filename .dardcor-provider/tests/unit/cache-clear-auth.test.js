import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  hasCli: vi.fn(),
  isAuth: vi.fn(),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  l1Clear: vi.fn(),
  l2Clear: vi.fn(),
  l3Clear: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: mocks.hasCli, isAuthenticated: mocks.isAuth }));
vi.mock("open-sse/cache/l1.js", () => ({ l1Clear: mocks.l1Clear }));
vi.mock("open-sse/cache/l2.js", () => ({ l2Clear: mocks.l2Clear }));
vi.mock("open-sse/cache/l3.js", () => ({ l3Clear: mocks.l3Clear }));

const { POST } = await import("@/app/api/cache/clear/route.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasCli.mockResolvedValue(false);
  mocks.isAuth.mockResolvedValue(true);
});

describe("POST /api/cache/clear", () => {
  it("rejects unauthenticated requests before clearing", async () => {
    mocks.isAuth.mockResolvedValue(false);
    const response = await POST(new Request("http://localhost/api/cache/clear", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.l1Clear).not.toHaveBeenCalled();
  });

  it("allows authenticated requests and clears all local layers", async () => {
    const response = await POST(new Request("http://localhost/api/cache/clear", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.l1Clear).toHaveBeenCalled();
    expect(mocks.l2Clear).toHaveBeenCalled();
    expect(mocks.l3Clear).toHaveBeenCalled();
  });

  it("allows CLI-token requests", async () => {
    mocks.isAuth.mockResolvedValue(false);
    mocks.hasCli.mockResolvedValue(true);
    const response = await POST(new Request("http://localhost/api/cache/clear", { method: "POST" }));
    expect(response.status).toBe(200);
  });
});
