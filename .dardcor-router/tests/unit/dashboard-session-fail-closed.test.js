// dashboardSession must fail CLOSED when the settings DB read rejects:
// create throws, verify returns false, getDashboardAuthSession returns null.
// The inner getSettings().catch fallback is removed on purpose.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const ORIG_JWT = process.env.JWT_SECRET;

async function loadModule() {
  vi.resetModules();
  return await import("../../src/lib/auth/dashboardSession.js");
}

describe("dashboardSession fail-closed on settings DB errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "a-strong-real-secret-value-12345";
    mocks.getSettings.mockResolvedValue({ sessionVersion: 0 });
  });

  afterEach(() => {
    if (ORIG_JWT === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIG_JWT;
  });

  it("verify returns false when the settings DB read rejects", async () => {
    const m = await loadModule();
    const token = await m.createDashboardAuthToken();
    expect(await m.verifyDashboardAuthToken(token)).toBe(true);

    mocks.getSettings.mockRejectedValue(new Error("db down"));

    expect(await m.verifyDashboardAuthToken(token)).toBe(false);
  });

  it("getDashboardAuthSession returns null when the settings DB read rejects", async () => {
    const m = await loadModule();
    const token = await m.createDashboardAuthToken();

    mocks.getSettings.mockRejectedValue(new Error("db down"));

    expect(await m.getDashboardAuthSession(token)).toBe(null);
  });

  it("createDashboardAuthToken rejects when the settings DB read rejects", async () => {
    const m = await loadModule();
    mocks.getSettings.mockRejectedValue(new Error("db down"));

    await expect(m.createDashboardAuthToken()).rejects.toThrow("db down");
  });
});
