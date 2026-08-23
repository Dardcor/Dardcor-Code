// Full DB import must invalidate old JWTs: importDb always persists settings
// (or {}) with sessionVersion = max(current, imported) + 1, even when the
// payload carries no settings. Old tokens fail, newly issued tokens pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const origDataDir = process.env.DATA_DIR;
const origJwt = process.env.JWT_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "miawrouter-importver-"));
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

describe("importDb sessionVersion monotonicity", () => {
  it("import without settings still persists a bumped sessionVersion", async () => {
    const db = await loadDb();

    await db.updateSettings({ requireLogin: false }); // no password, version stays 0
    expect((await db.getSettings()).sessionVersion).toBe(0);

    await db.importDb({ apiKeys: [] });

    expect((await db.getSettings()).sessionVersion).toBe(1);
  });

  it("import with settings bumps max(current, imported) + 1", async () => {
    const db = await loadDb();

    await db.updateSettings({ password: "hash-1" }); // version 1
    await db.importDb({ settings: { sessionVersion: 5, requireLogin: false } });
    expect((await db.getSettings()).sessionVersion).toBe(6);

    // imported version lower than current still bumps above current
    await db.importDb({ settings: { sessionVersion: 2 } });
    expect((await db.getSettings()).sessionVersion).toBe(7);
  });

  it("consecutive imports are strictly monotonically increasing", async () => {
    const db = await loadDb();

    const versions = [];
    for (let i = 0; i < 3; i += 1) {
      await db.importDb({ settings: { sessionVersion: 100 } });
      versions.push((await db.getSettings()).sessionVersion);
    }

    expect(versions).toEqual([101, 102, 103]);
  });
});

describe("importDb invalidates old JWTs", () => {
  it("tokens issued before an import fail; newly issued tokens pass", async () => {
    const db = await loadDb();
    const session = await loadSession();

    const before = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(before)).toBe(true);

    await db.importDb({ settings: { sessionVersion: 0, requireLogin: true } });

    expect(await session.verifyDashboardAuthToken(before)).toBe(false);

    const after = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(after)).toBe(true);
  });
});
