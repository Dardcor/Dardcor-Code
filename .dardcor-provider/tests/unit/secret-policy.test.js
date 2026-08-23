import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Contract tests for the shared boot env policy: src/shared/utils/secretPolicy.js
// (the ESM view over the canonical root secret-policy.cjs). Pure env validators:
//   assertStrongApiKeySecret()   -> reads process.env.API_KEY_SECRET, throws on weak
//   assertStrongMachineIdSalt()  -> reads process.env.MACHINE_ID_SALT, throws on weak
// Strong values accepted, unset accepted, WITHOUT touching disk. Env is set
// before the dynamic import so the module never observes mid-test env changes.

const ENV_KEYS = ["DATA_DIR", "API_KEY_SECRET", "MACHINE_ID_SALT", "JWT_SECRET"];
const savedEnv = {};

function saveEnv() {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

const WEAK_API = [
  "endpoint-proxy-api-key-secret",
  "change-me-to-a-long-random-secret",
  "changeme",
  "secret",
];

const WEAK_MACHINE = [
  "endpoint-proxy-salt",
  "change-me-to-a-long-random-secret",
  "changeme",
  "secret",
];

const WEAK_JWT = [
  "change-me-to-a-long-random-secret",
  "your-secure-secret-change-this",
  "your-secure-secret-change-this-to-random-string",
  "your-secure-secret",
  "your-secret",
  "generated-secret-here",
  "omniroute-default-secret-change-me",
  "changeme",
  "secret",
];

const STRONG = "a-long-random-strong-secret-0123456789-abcdef";

let tempDir;

beforeEach(() => {
  saveEnv();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "miawrouter-secret-policy-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  restoreEnv();
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function loadPolicy() {
  vi.resetModules();
  return import("@/shared/utils/secretPolicy.js");
}

describe("shared boot env secret policy", () => {
  it.each(WEAK_API)("rejects weak API_KEY_SECRET value %j", async (weak) => {
    process.env.API_KEY_SECRET = weak;
    const mod = await loadPolicy();
    expect(() => mod.assertStrongApiKeySecret()).toThrow();
  });

  it.each(WEAK_MACHINE)("rejects weak MACHINE_ID_SALT value %j", async (weak) => {
    process.env.MACHINE_ID_SALT = weak;
    const mod = await loadPolicy();
    expect(() => mod.assertStrongMachineIdSalt()).toThrow();
  });

  it("accepts a strong API_KEY_SECRET", async () => {
    process.env.API_KEY_SECRET = STRONG;
    const mod = await loadPolicy();
    expect(() => mod.assertStrongApiKeySecret()).not.toThrow();
  });

  it("accepts a strong MACHINE_ID_SALT", async () => {
    process.env.MACHINE_ID_SALT = STRONG;
    const mod = await loadPolicy();
    expect(() => mod.assertStrongMachineIdSalt()).not.toThrow();
  });

  it("accepts unset secrets and writes nothing to disk", async () => {
    delete process.env.API_KEY_SECRET;
    delete process.env.MACHINE_ID_SALT;
    delete process.env.JWT_SECRET;
    const mod = await loadPolicy();
    expect(() => mod.assertStrongApiKeySecret()).not.toThrow();
    expect(() => mod.assertStrongMachineIdSalt()).not.toThrow();
    expect(() => mod.assertStrongJwtSecret()).not.toThrow();
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it.each(WEAK_JWT)("rejects weak JWT_SECRET value %j", async (weak) => {
    process.env.JWT_SECRET = weak;
    const mod = await loadPolicy();
    try {
      mod.assertStrongJwtSecret();
      throw new Error("expected to throw");
    } catch (err) {
      expect(err.message).toContain("JWT_SECRET");
      expect(err.message).not.toContain(weak);
    }
  });

  it("accepts a strong JWT_SECRET", async () => {
    process.env.JWT_SECRET = STRONG;
    const mod = await loadPolicy();
    expect(() => mod.assertStrongJwtSecret()).not.toThrow();
  });

  it("assertNoWeakSecrets rejects a weak JWT_SECRET", async () => {
    process.env.JWT_SECRET = "changeme";
    const mod = await loadPolicy();
    expect(() => mod.assertNoWeakSecrets()).toThrow(/JWT_SECRET/);
  });
});
