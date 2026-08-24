import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const ENV_KEYS = ["DATA_DIR", "JWT_SECRET", "INITIAL_PASSWORD"];
const originalEnv = {};

function saveEnv(keys) {
  for (const k of keys) originalEnv[k] = process.env[k];
}
function restoreEnv(keys) {
  for (const k of keys) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
}

beforeEach(() => {
  saveEnv(ENV_KEYS);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-dbsess-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.INITIAL_PASSWORD;
  vi.resetModules();
});

afterEach(() => {
  restoreEnv(ENV_KEYS);
  vi.restoreAllMocks();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

async function loadSession() {
  vi.resetModules();
  return import("@/lib/auth/dashboardSession.js");
}

describe("dashboardSession secret via loadOrCreateSecretFile", () => {
  it("strong env: returns env value, no jwt-secret file created", async () => {
    process.env.JWT_SECRET = "a-strong-real-secret-value-12345";
    const m = await loadSession();
    const token = await m.createDashboardAuthToken();
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
    // env path should not persist the file
    expect(fs.existsSync(path.join(tempDir, "jwt-secret"))).toBe(false);
  });

  it("no env: generates 0600 file and sign/verify round-trips", async () => {
    delete process.env.JWT_SECRET;
    const m1 = await loadSession();
    const token = await m1.createDashboardAuthToken();
    expect(typeof token).toBe("string");
    const secretFile = path.join(tempDir, "jwt-secret");
    expect(fs.existsSync(secretFile)).toBe(true);
    const stat = fs.statSync(secretFile);
    expect(stat.mode & 0o777).toBe(0o600);
    // verify works with same module
    expect(await m1.verifyDashboardAuthToken(token)).toBe(true);
    const payload = await m1.getDashboardAuthSession(token);
    expect(payload).toBeTruthy();
    expect(payload.authenticated).toBe(true);
  });

  it("pre-existing strong file is reused and tightened to 0600", async () => {
    delete process.env.JWT_SECRET;
    const secretFile = path.join(tempDir, "jwt-secret");
    fs.writeFileSync(secretFile, "a-strong-pre-existing-secret", { mode: 0o644 });
    const m = await loadSession();
    const token = await m.createDashboardAuthToken();
    expect(await m.verifyDashboardAuthToken(token)).toBe(true);
    expect(fs.statSync(secretFile).mode & 0o777).toBe(0o600);
  });

  it("persisted-session: token created with first load survives module reload", async () => {
    delete process.env.JWT_SECRET;
    const m1 = await loadSession();
    const token = await m1.createDashboardAuthToken();
    expect(await m1.verifyDashboardAuthToken(token)).toBe(true);
    // reload — same persisted file
    const m2 = await loadSession();
    expect(await m2.verifyDashboardAuthToken(token)).toBe(true);
    const payload = await m2.getDashboardAuthSession(token);
    expect(payload).toBeTruthy();
    expect(payload.authenticated).toBe(true);
  });

  it("weak env value: import rejects", async () => {
    process.env.JWT_SECRET = "changeme";
    await expect(loadSession()).rejects.toThrow("weak");
  });

  it("weak persisted file: import rejects", async () => {
    delete process.env.JWT_SECRET;
    fs.writeFileSync(path.join(tempDir, "jwt-secret"), "secret", { mode: 0o600 });
    await expect(loadSession()).rejects.toThrow("weak");
  });

  it("password verification uses stored hash or explicit env only", async () => {
    process.env.JWT_SECRET = "a-strong-real-secret-value-12345";
    const m = await loadSession();
    // No hash + no env: the legacy default must never authenticate.
    expect(await m.verifyDashboardPassword("123456")).toBe(false);
    expect(await m.verifyDashboardPassword("wrong")).toBe(false);
    expect(await m.verifyDashboardPassword("")).toBe(false);
    expect(await m.verifyDashboardPassword(null)).toBe(false);
  });

  it("password verification accepts explicit env only while no hash exists", async () => {
    process.env.JWT_SECRET = "a-strong-real-secret-value-12345";
    process.env.INITIAL_PASSWORD = "operator-secret-1";
    const m = await loadSession();
    expect(await m.verifyDashboardPassword("operator-secret-1")).toBe(true);
    expect(await m.verifyDashboardPassword("123456")).toBe(false);
  });

  it("shouldUseSecureCookie ignores JWT_SECRET", async () => {
    process.env.JWT_SECRET = "a-strong-real-secret-value-12345";
    delete process.env.AUTH_COOKIE_SECURE;
    const m = await loadSession();
    expect(m.shouldUseSecureCookie({ headers: { get: () => null } })).toBe(false);
    expect(m.shouldUseSecureCookie({ headers: { get: () => "https" } })).toBe(true);
  });
});
