// Dashboard login state machine:
// stored hash -> bcrypt compare; no hash + env -> exact env, persist before cookie;
// no hash + no env -> local setup only; remote setup 403 with no lockout mutation.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  isOidcConfigured: vi.fn(),
  getClientIp: vi.fn(),
  isLocalRequest: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
}));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: mocks.isOidcConfigured }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
// Keep the real in-memory limiter (observable lockout) but control the IP source.
vi.mock("@/lib/auth/loginLimiter", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getClientIp: mocks.getClientIp };
});

const { POST } = await import("../../src/app/api/auth/login/route.js");

const ORIG_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;

function request(body, headers = {}) {
  return { json: async () => body, headers: { get: (key) => headers[key] || null } };
}

let ipCounter = 0;

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (ORIG_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = ORIG_INITIAL_PASSWORD;
    mocks.getSettings.mockResolvedValue({ requireLogin: true, authMode: "password" });
    mocks.cookies.mockResolvedValue({});
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.isLocalRequest.mockReturnValue(false);
    // Unique IP per test so the module-level limiter never leaks across tests.
    ipCounter += 1;
    mocks.getClientIp.mockReturnValue(`127.0.0.${ipCounter}`);
  });

  afterEach(() => {
    if (ORIG_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = ORIG_INITIAL_PASSWORD;
  });

  describe("stored bcrypt hash", () => {
    it("accepts the correct password, no re-persist, cookie issued", async () => {
      const hash = bcrypt.hashSync("right-password", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: hash });

      const res = await POST(request({ password: "right-password" }));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mustChangePassword).toBeUndefined();
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    });

    it("rejects a wrong password and retains the limiter (401 then lockout)", async () => {
      const hash = bcrypt.hashSync("right-password", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: hash });

      const first = await POST(request({ password: "wrong" }));
      expect(first.status).toBe(401);
      expect(first.body.remainingBeforeLock).toBe(4);
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();

      // 4 more failures -> 5 total -> progressive lock kicks in
      for (let i = 0; i < 4; i += 1) await POST(request({ password: "wrong" }));
      const locked = await POST(request({ password: "wrong" }));
      expect(locked.status).toBe(429);
    });

    it("lockout reset hint matches CLI label, ASCII only, no 'default'", async () => {
      const hash = bcrypt.hashSync("right-password", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: hash });

      for (let i = 0; i < 5; i += 1) await POST(request({ password: "wrong" }));
      const locked = await POST(request({ password: "wrong" }));
      expect(locked.status).toBe(429);

      const hint = locked.body.resetHint;
      expect(hint).toBeTruthy();
      expect(hint).toContain("Settings > Clear Dashboard Password");
      expect(hint).toMatch(/local/i);
      expect(hint).not.toMatch(/default/i);
      expect(hint).toMatch(/^[\x00-\x7F]*$/); // ASCII only
    });
  });

  describe("no hash + explicit INITIAL_PASSWORD", () => {
    it("local: accepts only the exact env value, persists a bcrypt hash BEFORE the cookie", async () => {
      process.env.INITIAL_PASSWORD = "env-password-1";
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(true);

      const res = await POST(request({ password: "env-password-1" }));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mustChangePassword).toBeUndefined();
      const write = mocks.updateSettings.mock.calls[0][0];
      expect(write).toHaveProperty("password");
      expect(write.password).not.toBe("env-password-1");
      expect(bcrypt.compareSync("env-password-1", write.password)).toBe(true);
      // Persist happens before the session cookie is issued.
      expect(mocks.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.setDashboardAuthCookie.mock.invocationCallOrder[0],
      );
      expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    });

    it("local: rejects a wrong password with the limiter, no write, no cookie", async () => {
      process.env.INITIAL_PASSWORD = "env-password-1";
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(true);

      const res = await POST(request({ password: "not-the-env-password" }));

      expect(res.status).toBe(401);
      expect(res.body.remainingBeforeLock).toBe(4);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    });

    it("local: never accepts the legacy default 123456", async () => {
      process.env.INITIAL_PASSWORD = "env-password-1";
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(true);

      const res = await POST(request({ password: "123456" }));

      expect(res.status).toBe(401);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    });

    it("remote: 403 for any password, no write, no cookie, no lockout mutation", async () => {
      process.env.INITIAL_PASSWORD = "env-password-1";
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(false);

      for (const body of [
        { password: "env-password-1" },
        { password: "not-the-env-password" },
        { password: "123456" },
      ]) {
        const res = await POST(request(body));
        expect(res.status).toBe(403);
      }
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();

      // No recordFail was consumed: a normal wrong attempt afterwards still has 5 tries.
      const hash = bcrypt.hashSync("good", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: hash });
      const after = await POST(request({ password: "wrong" }));
      expect(after.status).toBe(401);
      expect(after.body.remainingBeforeLock).toBe(4);
    });
  });

  describe("no hash + no env (setup state)", () => {
    it("local + isSetup:true + password >= 8: persists hash then issues session", async () => {
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(true);

      const res = await POST(request({ password: "brand-new-pass-9", isSetup: true }));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mustChangePassword).toBeUndefined();
      const write = mocks.updateSettings.mock.calls[0][0];
      expect(bcrypt.compareSync("brand-new-pass-9", write.password)).toBe(true);
      expect(mocks.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.setDashboardAuthCookie.mock.invocationCallOrder[0],
      );
      expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    });

    it("local + isSetup:true + short password (incl. 123456): clear 400, no write, no cookie", async () => {
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(true);

      for (const attempt of ["123456", "short"]) {
        const res = await POST(request({ password: attempt, isSetup: true }));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    });

    it("local + missing setup input: clear non-500 response, no cookie", async () => {
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(true);

      const res = await POST(request({ password: "whatever" }));

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    });

    it("remote setup (with or without isSetup): 403, no write, no cookie, no lockout mutation", async () => {
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.isLocalRequest.mockReturnValue(false);

      for (const body of [
        { password: "brand-new-pass-9", isSetup: true },
        { password: "whatever" },
        { password: "123456", isSetup: true },
      ]) {
        const res = await POST(request(body));
        expect(res.status).toBe(403);
      }
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();

      // No recordFail was consumed: a normal wrong attempt afterwards still has 5 tries.
      const hash = bcrypt.hashSync("good", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: hash });
      const after = await POST(request({ password: "wrong" }));
      expect(after.status).toBe(401);
      expect(after.body.remainingBeforeLock).toBe(4);
    });
  });

  describe("preserved gates", () => {
    it("OIDC-mode gate: password login disabled when OIDC configured", async () => {
      mocks.getSettings.mockResolvedValue({ requireLogin: true, authMode: "oidc" });
      mocks.isOidcConfigured.mockReturnValue(true);

      const res = await POST(request({ password: "anything" }));

      expect(res.status).toBe(403);
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("tunnel-access gate: blocked when dashboard access via tunnel is disabled", async () => {
      mocks.getSettings.mockResolvedValue({
        requireLogin: true,
        tunnelUrl: "https://tunnel.example.com",
        tunnelDashboardAccess: false,
      });

      const res = await POST(request({ password: "x" }, { host: "tunnel.example.com" }));

      expect(res.status).toBe(403);
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    });
  });
});
