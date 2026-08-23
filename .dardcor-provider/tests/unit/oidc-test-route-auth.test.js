// POST /api/auth/oidc/test: probing must require a valid dashboard session.
// The requireLogin=false bypass is removed — a valid JWT cookie is mandatory.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  fetchOidcDiscovery: vi.fn(),
  getPublicOrigin: vi.fn(),
  probeOidcClientSecret: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/auth/oidc", () => ({
  fetchOidcDiscovery: mocks.fetchOidcDiscovery,
  getPublicOrigin: mocks.getPublicOrigin,
  probeOidcClientSecret: mocks.probeOidcClientSecret,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

const { POST } = await import("../../src/app/api/auth/oidc/test/route.js");

function request(body) {
  return { json: async () => body };
}

const OIDC_SETTINGS = {
  requireLogin: false,
  oidcIssuerUrl: "https://issuer.example.com",
  oidcClientId: "client-123",
};

describe("POST /api/auth/oidc/test session requirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
    mocks.getSettings.mockResolvedValue({ ...OIDC_SETTINGS });
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.fetchOidcDiscovery.mockResolvedValue({
      token_endpoint: "https://issuer.example.com/token",
      authorization_endpoint: "https://issuer.example.com/auth",
    });
    mocks.getPublicOrigin.mockReturnValue("http://localhost:21128");
    mocks.probeOidcClientSecret.mockResolvedValue({ tested: false, valid: null, message: "skipped" });
  });

  it("returns 401 without a valid JWT even when requireLogin=false", async () => {
    const res = await POST(request({}));

    expect(res.status).toBe(401);
    expect(mocks.fetchOidcDiscovery).not.toHaveBeenCalled();
    expect(mocks.probeOidcClientSecret).not.toHaveBeenCalled();
  });

  it("returns 401 with a bogus JWT when requireLogin=false", async () => {
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "stale-or-bogus-token" })) });

    const res = await POST(request({}));

    expect(res.status).toBe(401);
    expect(mocks.fetchOidcDiscovery).not.toHaveBeenCalled();
  });

  it("returns 401 without a valid JWT when requireLogin=true", async () => {
    mocks.getSettings.mockResolvedValue({ ...OIDC_SETTINGS, requireLogin: true });

    const res = await POST(request({}));

    expect(res.status).toBe(401);
  });

  it("proceeds to probe when a valid dashboard JWT is present", async () => {
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "valid-jwt" })) });
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    const res = await POST(request({}));

    expect(res.status).toBe(200);
    expect(mocks.fetchOidcDiscovery).toHaveBeenCalled();
  });
});

describe("POST /api/auth/oidc/test draft source isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "valid-jwt" })) });
    mocks.fetchOidcDiscovery.mockResolvedValue({
      token_endpoint: "https://draft.example.com/token",
      authorization_endpoint: "https://draft.example.com/auth",
    });
    mocks.getPublicOrigin.mockReturnValue("http://localhost:21128");
    mocks.probeOidcClientSecret.mockResolvedValue({ tested: false, valid: null, message: "skipped" });
  });

  it("body draft without clientSecret never mixes the stored client secret", async () => {
    mocks.getSettings.mockResolvedValue({
      requireLogin: false,
      oidcIssuerUrl: "https://stored.example.com",
      oidcClientId: "stored-client",
      oidcClientSecret: "STORED-SECRET",
      oidcScopes: "openid profile",
    });

    const res = await POST(
      request({ issuerUrl: "https://draft.example.com", clientId: "draft-client" }),
    );

    expect(res.status).toBe(200);
    expect(mocks.fetchOidcDiscovery).toHaveBeenCalledWith("https://draft.example.com");
    expect(mocks.probeOidcClientSecret).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "draft-client", clientSecret: "" }),
    );
  });

  it("body draft with all fields uses body values only", async () => {
    mocks.getSettings.mockResolvedValue({
      requireLogin: false,
      oidcIssuerUrl: "https://stored.example.com",
      oidcClientId: "stored-client",
      oidcClientSecret: "STORED-SECRET",
    });

    const res = await POST(
      request({
        issuerUrl: "https://draft.example.com",
        clientId: "draft-client",
        clientSecret: "draft-secret",
        scopes: "openid email",
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.fetchOidcDiscovery).toHaveBeenCalledWith("https://draft.example.com");
    expect(mocks.probeOidcClientSecret).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "draft-client", clientSecret: "draft-secret" }),
    );
  });

  it("empty body falls back to stored settings as a single source", async () => {
    mocks.getSettings.mockResolvedValue({
      requireLogin: false,
      oidcIssuerUrl: "https://stored.example.com",
      oidcClientId: "stored-client",
      oidcClientSecret: "STORED-SECRET",
      oidcScopes: "openid profile",
    });

    const res = await POST(request({}));

    expect(res.status).toBe(200);
    expect(mocks.fetchOidcDiscovery).toHaveBeenCalledWith("https://stored.example.com");
    expect(mocks.probeOidcClientSecret).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "stored-client", clientSecret: "STORED-SECRET" }),
    );
  });
});
