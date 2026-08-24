import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Contract tests for the Next instrumentation register hook.
// Module: src/instrumentation.js (repo root). Resolved relative to this file
// (tests/unit/) so it works regardless of the tests cwd/config.
// register() rejects weak boot secrets and wires console-log capture.
// Import must stay side-effect free.

const ENV_KEYS = ["DATA_DIR", "API_KEY_SECRET", "MACHINE_ID_SALT", "JWT_SECRET", "NEXT_RUNTIME"];
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

const instrumentationUrl = new URL("../../src/instrumentation.js", import.meta.url);

let tempDir;

beforeEach(() => {
  saveEnv();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-instrumentation-"));
  process.env.DATA_DIR = tempDir;
  process.env.NEXT_RUNTIME = "nodejs";
  vi.resetModules();
});

afterEach(() => {
  restoreEnv();
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Next instrumentation register hook", () => {
  it("import is side-effect free and exposes register()", async () => {
    const mod = await import(instrumentationUrl.href);
    expect(typeof mod.register).toBe("function");
  });

  it("register() rejects weak API_KEY_SECRET", async () => {
    process.env.API_KEY_SECRET = "endpoint-proxy-api-key-secret";
    const mod = await import(instrumentationUrl.href);
    await expect(mod.register()).rejects.toThrow();
  });

  it("register() rejects weak MACHINE_ID_SALT", async () => {
    process.env.MACHINE_ID_SALT = "endpoint-proxy-salt";
    const mod = await import(instrumentationUrl.href);
    await expect(mod.register()).rejects.toThrow();
  });

  it("register() rejects weak JWT_SECRET", async () => {
    process.env.JWT_SECRET = "change-me-to-a-long-random-secret";
    const mod = await import(instrumentationUrl.href);
    await expect(mod.register()).rejects.toThrow();
  });

  it("register() succeeds with strong secrets", async () => {
    process.env.API_KEY_SECRET = "a-long-random-strong-secret-0123456789-abcdef";
    process.env.MACHINE_ID_SALT = "another-long-random-strong-salt-fedcba9876543210";
    process.env.JWT_SECRET = "a-strong-jwt-secret-that-is-definitely-not-weak-12345";
    const mod = await import(instrumentationUrl.href);
    await expect(mod.register()).resolves.toBeUndefined();
  });

  it("register() succeeds when secrets are unset", async () => {
    delete process.env.API_KEY_SECRET;
    delete process.env.MACHINE_ID_SALT;
    delete process.env.JWT_SECRET;
    const mod = await import(instrumentationUrl.href);
    await expect(mod.register()).resolves.toBeUndefined();
  });
});
