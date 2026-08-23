import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  isOidcConfigured: vi.fn(),
  getDashboardAuthSession: vi.fn(),
}));

const ORIG_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/auth/oidc", () => ({
  isOidcConfigured: mocks.isOidcConfigured,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  getDashboardAuthSession: mocks.getDashboardAuthSession,
}));

const { GET } = await import("../../src/app/api/auth/status/route.js");

describe("GET /api/auth/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (ORIG_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = ORIG_INITIAL_PASSWORD;
    mocks.getSettings.mockResolvedValue({ requireLogin: true, authMode: "password" });
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    mocks.isOidcConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    if (ORIG_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = ORIG_INITIAL_PASSWORD;
  });

  it("reports an authenticated session when the auth cookie is valid", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });

    const response = await GET();

    expect(response.body.authenticated).toBe(true);
    expect(mocks.getDashboardAuthSession).toHaveBeenCalledWith("session-token");
  });

  it("reports unauthenticated when the auth cookie is invalid", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.body.authenticated).toBe(false);
  });

  it("fails closed when status dependencies throw", async () => {
    mocks.getSettings.mockRejectedValue(new Error("database unavailable"));

    const response = await GET();

    expect(response.body.authenticated).toBe(false);
    expect(response.body.requireLogin).toBe(true);
    expect(response.body.setupRequired).toBe(false);
  });

  it("exposes setupRequired true when no hash and no INITIAL_PASSWORD", async () => {
    const response = await GET();

    expect(response.body.setupRequired).toBe(true);
  });

  it("exposes setupRequired false when a password hash exists", async () => {
    mocks.getSettings.mockResolvedValue({
      requireLogin: true,
      authMode: "password",
      password: "$2a$10$abcdefghijklmnopqrstuv",
    });

    const response = await GET();

    expect(response.body.setupRequired).toBe(false);
  });

  it("exposes setupRequired false when INITIAL_PASSWORD env is set", async () => {
    process.env.INITIAL_PASSWORD = "operator-pass";

    const response = await GET();

    expect(response.body.setupRequired).toBe(false);
  });
});
