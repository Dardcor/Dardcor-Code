// Verify Full JSON Store engine: zero SQLite native bindings, 100% pure JS memory store
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-chain-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Full JSON Store Engine", () => {
  it("initializes Full JSON Store engine without sqlite native dependencies", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.driver).toBe("Full JSON Store");
  });

  it("performs in-memory CRUD operations directly via Full JSON engine", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", ['{"testMode":true}']);
    const row = db.get("SELECT data FROM settings WHERE id = 1");
    expect(JSON.parse(row.data)).toEqual({ testMode: true });

    const all = db.all("SELECT * FROM settings");
    expect(all.length).toBe(1);
  });

  it("handles transactional rollback on error", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(() => {
      db.transaction(() => {
        db.run("INSERT INTO apiKeys(id, key, name, isActive, createdAt) VALUES(?, ?, ?, ?, ?)", [
          "temp-id", "sk-temp", "temp", 1, new Date().toISOString()
        ]);
        throw new Error("Rollback trigger");
      });
    }).toThrow("Rollback trigger");

    const row = db.get("SELECT * FROM apiKeys WHERE id = ?", ["temp-id"]);
    expect(row).toBeUndefined();
  });
});

