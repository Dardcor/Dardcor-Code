// GET/POST /api/settings/database: CLI token header must be VALIDATED against
// the canonical machine-derived token, not just present. An arbitrary
// x-miaw-cli-token value must still require password re-auth (401).
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  exportDb: vi.fn(),
  importDb: vi.fn(),
  getSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  hasValidCliToken: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/localDb", () => ({
  exportDb: mocks.exportDb,
  importDb: mocks.importDb,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardPassword: mocks.verifyDashboardPassword,
}));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: mocks.hasValidCliToken }));

const { GET, POST } = await import("../../src/app/api/settings/database/route.js");

function request(headers = {}, body) {
  const req = { headers: { get: (key) => headers[key] || null } };
  if (body !== undefined) req.json = async () => body;
  return req;
}

describe("GET /api/settings/database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exportDb.mockResolvedValue({ settings: {} });
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.verifyDashboardPassword.mockResolvedValue(false);
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("rejects with no CLI token and no valid password", async () => {
    const res = await GET(request({}));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid password");
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("arbitrary x-miaw-cli-token value cannot bypass password re-auth", async () => {
    const res = await GET(request({ "x-miaw-cli-token": "not-the-real-token" }));

    expect(res.status).toBe(401);
    expect(mocks.exportDb).not.toHaveBeenCalled();
    expect(mocks.verifyDashboardPassword).toHaveBeenCalled();
  });

  it("valid CLI token skips password re-auth", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);

    const res = await GET(request({ "x-miaw-cli-token": "real-token" }));

    expect(res.status).toBe(200);
    expect(mocks.exportDb).toHaveBeenCalled();
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("valid password header passes when no CLI token", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(true);

    const res = await GET(request({ "x-miaw-password": "correct-password" }));

    expect(res.status).toBe(200);
    expect(mocks.exportDb).toHaveBeenCalled();
  });
});

describe("POST /api/settings/database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.importDb.mockResolvedValue(undefined);
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.verifyDashboardPassword.mockResolvedValue(false);
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("rejects with no CLI token and no valid password", async () => {
    const res = await POST(request({}, { password: "pw", settings: {} }));

    expect(res.status).toBe(401);
    expect(mocks.importDb).not.toHaveBeenCalled();
  });

  it("arbitrary x-miaw-cli-token value cannot bypass password re-auth", async () => {
    const res = await POST(
      request({ "x-miaw-cli-token": "not-the-real-token" }, { password: "pw", settings: {} }),
    );

    expect(res.status).toBe(401);
    expect(mocks.importDb).not.toHaveBeenCalled();
    expect(mocks.verifyDashboardPassword).toHaveBeenCalled();
  });

  it("valid CLI token imports the payload", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);

    const res = await POST(
      request({ "x-miaw-cli-token": "real-token" }, { password: "pw", settings: {} }),
    );

    expect(res.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalled();
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("valid body password imports the payload", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(true);

    const res = await POST(request({}, { password: "correct-password", settings: {} }));

    expect(res.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalled();
  });

  it("x-miaw-password header takes precedence over the body password", async () => {
    // Header password is correct, body password is wrong → header must win.
    mocks.verifyDashboardPassword.mockImplementation(async (pw) => pw === "header-password");

    const res = await POST(
      request({ "x-miaw-password": "header-password" }, { password: "wrong-body-password", settings: {} }),
    );

    expect(res.status).toBe(200);
    expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("header-password");
  });

  it("x-miaw-password header alone (no body password) authenticates", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(true);

    const res = await POST(request({ "x-miaw-password": "header-password" }, { settings: {} }));

    expect(res.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalled();
  });

  it("importDb never receives a payload containing the password", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(true);

    const res = await POST(
      request({ "x-miaw-password": "header-password" }, { password: "legacy-body-password", settings: { mitmRouterBaseUrl: "http://localhost:21128" } }),
    );

    expect(res.status).toBe(200);
    const payload = mocks.importDb.mock.calls[0][0];
    expect(payload).not.toHaveProperty("password");
  });
});
