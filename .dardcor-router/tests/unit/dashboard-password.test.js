// verifyDashboardPassword: stored bcrypt hash or explicit INITIAL_PASSWORD only.
// The legacy hardcoded default (123456) must never authenticate.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const ORIG_JWT = process.env.JWT_SECRET;
const ORIG_INITIAL = process.env.INITIAL_PASSWORD;

async function loadModule() {
  vi.resetModules();
  return await import("../../src/lib/auth/dashboardSession.js");
}

describe("verifyDashboardPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "a-strong-real-secret-value-12345";
    delete process.env.INITIAL_PASSWORD;
  });

  afterEach(() => {
    if (ORIG_JWT === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIG_JWT;
    if (ORIG_INITIAL === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = ORIG_INITIAL;
  });

  it("no hash + no env: never accepts anything, including the legacy default", async () => {
    mocks.getSettings.mockResolvedValue({});

    const m = await loadModule();

    expect(await m.verifyDashboardPassword("123456")).toBe(false);
    expect(await m.verifyDashboardPassword("anything")).toBe(false);
    expect(await m.verifyDashboardPassword("")).toBe(false);
    expect(await m.verifyDashboardPassword(null)).toBe(false);
    expect(await m.verifyDashboardPassword(undefined)).toBe(false);
  });

  it("no hash + explicit env: accepts only the exact env value", async () => {
    process.env.INITIAL_PASSWORD = "operator-secret-1";
    mocks.getSettings.mockResolvedValue({});

    const m = await loadModule();

    expect(await m.verifyDashboardPassword("operator-secret-1")).toBe(true);
    expect(await m.verifyDashboardPassword("123456")).toBe(false);
    expect(await m.verifyDashboardPassword("operator-secret-2")).toBe(false);
  });

  it("stored hash: bcrypt compare unchanged and env is ignored", async () => {
    process.env.INITIAL_PASSWORD = "operator-secret-1";
    const hash = bcrypt.hashSync("stored-pass", 10);
    mocks.getSettings.mockResolvedValue({ password: hash });

    const m = await loadModule();

    expect(await m.verifyDashboardPassword("stored-pass")).toBe(true);
    expect(await m.verifyDashboardPassword("operator-secret-1")).toBe(false);
    expect(await m.verifyDashboardPassword("123456")).toBe(false);
  });
});
