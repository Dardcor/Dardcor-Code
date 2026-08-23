import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const origEnv = {};

function saveEnv(keys) {
  for (const k of keys) origEnv[k] = process.env[k];
}

function restoreEnv(keys) {
  for (const k of keys) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

beforeEach(() => {
  saveEnv(["DATA_DIR", "MACHINE_ID_SALT"]);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "miawrouter-mid-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  restoreEnv(["DATA_DIR", "MACHINE_ID_SALT"]);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

const WEAK_VALUES = [
  "endpoint-proxy-salt",
  "change-me-to-a-long-random-secret",
  "changeme",
  "secret",
];

describe("app-side getConsistentMachineId — salt resolution", () => {
  async function loadApp() {
    const mod = await import("@/shared/utils/machineId.js");
    return mod.getConsistentMachineId;
  }

  it("returns stable 16-hex ID with strong env MACHINE_ID_SALT", async () => {
    process.env.MACHINE_ID_SALT = "a-strong-unique-secret-42";
    const getId = await loadApp();
    const a = await getId();
    const b = await getId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it.each(WEAK_VALUES)("throws for weak env value %j", async (weak) => {
    process.env.MACHINE_ID_SALT = weak;
    const getId = await loadApp();
    await expect(getId()).rejects.toThrow("MACHINE_ID_SALT");
  });

  it("generates and persists machine-id-salt file with mode 0600", async () => {
    delete process.env.MACHINE_ID_SALT;
    const getId = await loadApp();
    await getId();
    const file = path.join(tempDir, "machine-id-salt");
    expect(fs.existsSync(file)).toBe(true);
    const stat = fs.statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("generated salt produces stable 16-hex ID across calls", async () => {
    delete process.env.MACHINE_ID_SALT;
    const getId = await loadApp();
    const a = await getId();
    const b = await getId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it("explicit salt callers unaffected by weak MACHINE_ID_SALT", async () => {
    process.env.MACHINE_ID_SALT = "endpoint-proxy-salt";
    const getId = await loadApp();
    const id = await getId("miaw-cli-auth");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("open-sse getConsistentMachineId — no default salt", () => {
  async function loadOpenSse() {
    const mod = await import("open-sse/shared/machineId.js");
    return mod.getConsistentMachineId;
  }

  it("explicit grok-cli-agent salt produces stable 16-hex ID", async () => {
    const getId = await loadOpenSse();
    const a = await getId("grok-cli-agent");
    const b = await getId("grok-cli-agent");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it("source file does not contain the literal endpoint-proxy-salt", async () => {
    const src = fs.readFileSync(
      path.resolve("../open-sse/shared/machineId.js"),
      "utf8",
    );
    expect(src).not.toContain("endpoint-proxy-salt");
  });
});

describe("app-side machineId source — no weak literal", () => {
  it("source file does not contain the literal endpoint-proxy-salt", () => {
    const src = fs.readFileSync(
      path.resolve("../src/shared/utils/machineId.js"),
      "utf8",
    );
    expect(src).not.toContain("endpoint-proxy-salt");
  });
});
