// Password change/reset must invalidate existing dashboard JWTs.
// sessionVersion is persisted in settings, embedded in issued tokens (sv claim),
// verified against current settings, and bumped atomically by settingsRepo when
// the password field is written. Non-password updates leave it unchanged.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const origDataDir = process.env.DATA_DIR;
const origJwt = process.env.JWT_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-sessver-"));
  process.env.DATA_DIR = tempDir;
  process.env.JWT_SECRET = "a-strong-real-secret-value-12345";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (origDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = origDataDir;
  if (origJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = origJwt;
  vi.resetModules();
});

async function loadDb() {
  return await import("@/lib/localDb");
}

async function loadSession() {
  return await import("@/lib/auth/dashboardSession.js");
}

describe("settingsRepo sessionVersion bump", () => {
  it("defaults to 0 and bumps atomically on password writes only", async () => {
    const db = await loadDb();

    expect((await db.getSettings()).sessionVersion).toBe(0);

    await db.updateSettings({ requireLogin: false });
    expect((await db.getSettings()).sessionVersion).toBe(0);

    await db.updateSettings({ password: "hash-1" });
    expect((await db.getSettings()).sessionVersion).toBe(1);

    await db.updateSettings({ password: "hash-2" });
    expect((await db.getSettings()).sessionVersion).toBe(2);

    await db.updateSettings({ password: null });
    expect((await db.getSettings()).sessionVersion).toBe(3);
  });
});

describe("dashboard session token invalidation", () => {
  it("token issued before a password change fails; new token passes", async () => {
    const db = await loadDb();
    const session = await loadSession();

    const before = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(before)).toBe(true);

    await db.updateSettings({ password: "hash-1" }); // bump 0 -> 1

    expect(await session.verifyDashboardAuthToken(before)).toBe(false);
    expect(await session.getDashboardAuthSession(before)).toBe(null);

    const after = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(after)).toBe(true);
  });

  it("token issued before a password reset fails; new token passes", async () => {
    const db = await loadDb();
    const session = await loadSession();

    await db.updateSettings({ password: "hash-1" }); // version 1
    const before = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(before)).toBe(true);

    await db.updateSettings({ password: null }); // reset -> version 2

    expect(await session.verifyDashboardAuthToken(before)).toBe(false);

    const after = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(after)).toBe(true);
  });
});
