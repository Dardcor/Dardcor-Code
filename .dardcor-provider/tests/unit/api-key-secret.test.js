import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
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

const ENV_KEYS = ["DATA_DIR", "API_KEY_SECRET"];

beforeEach(() => {
  saveEnv(ENV_KEYS);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-apikey-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  restoreEnv(ENV_KEYS);
  vi.restoreAllMocks();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

async function loadApiKey() {
  vi.resetModules();
  return import("@/shared/utils/apiKey.js");
}

describe("apiKey secret from loadOrCreateSecretFile", () => {
  it("with strong env: generate/parse round-trips, no file written", async () => {
    process.env.API_KEY_SECRET = "a-strong-real-secret-value-12345";
    const { generateApiKeyWithMachine, parseApiKey } = await loadApiKey();
    const { key, keyId } = generateApiKeyWithMachine("a".repeat(16));
    expect(key).toMatch(/^sk-/);
    const parsed = parseApiKey(key);
    expect(parsed).toEqual({
      machineId: "a".repeat(16),
      keyId,
      isNewFormat: true,
    });
    // env path should not persist the secret file
    expect(fs.existsSync(path.join(tempDir, "api-key-secret"))).toBe(false);
  });

  it("with no env: persists random secret and round-trips across reload", async () => {
    delete process.env.API_KEY_SECRET;
    const m1 = await loadApiKey();
    const { key: key1, keyId: id1 } = m1.generateApiKeyWithMachine("b".repeat(16));
    const parsed1 = m1.parseApiKey(key1);
    expect(parsed1.machineId).toBe("b".repeat(16));
    expect(parsed1.keyId).toBe(id1);

    // Verify file was created with mode 0600
    const secretFile = path.join(tempDir, "api-key-secret");
    expect(fs.existsSync(secretFile)).toBe(true);
    const stat = fs.statSync(secretFile);
    expect(stat.mode & 0o777).toBe(0o600);

    // Reload module — same persisted secret should still work
    const m2 = await loadApiKey();
    const { key: key2, keyId: id2 } = m2.generateApiKeyWithMachine("c".repeat(16));
    // Different keyId (random), but same secret so old key still parses
    expect(m2.parseApiKey(key1)).toBeTruthy();
    expect(m2.parseApiKey(key2)).toBeTruthy();
  });

  it("rejects weak env value endpoint-proxy-api-key-secret at import", async () => {
    process.env.API_KEY_SECRET = "endpoint-proxy-api-key-secret";
    await expect(loadApiKey()).rejects.toThrow();
  });

  it.each([
    "endpoint-proxy-api-key-secret",
    "change-me-to-a-long-random-secret",
    "changeme",
    "secret",
  ])("rejects weak value %q at import", async (weak) => {
    process.env.API_KEY_SECRET = weak;
    await expect(loadApiKey()).rejects.toThrow();
  });
});
