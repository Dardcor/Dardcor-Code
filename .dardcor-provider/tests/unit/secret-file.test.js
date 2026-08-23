import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "miawrouter-secret-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("loadOrCreateSecretFile", () => {
  const FILE = "api-key-secret";
  const ENV = "API_KEY_SECRET";
  const WEAK = ["endpoint-proxy-api-key-secret", "secret", "changeme"];

  async function load(overrides = {}) {
    const { loadOrCreateSecretFile } = await import(
      "@/shared/utils/secretFile.js"
    );
    return loadOrCreateSecretFile(
      overrides.fileName ?? FILE,
      overrides.envName ?? ENV,
      overrides.weakValues ?? WEAK,
    );
  }

  it("returns env value when set and not weak, touches no disk", async () => {
    process.env[ENV] = "my-real-secret-key";
    const result = await load();
    expect(result).toBe("my-real-secret-key");
    // env path should not create the file
    expect(fs.existsSync(path.join(tempDir, FILE))).toBe(false);
  });

  it("trims whitespace from env value", async () => {
    process.env[ENV] = "  my-secret  ";
    const result = await load();
    expect(result).toBe("my-secret");
  });

  it("throws when env value is in weakValues", async () => {
    process.env[ENV] = "endpoint-proxy-api-key-secret";
    await expect(load()).rejects.toThrow(ENV);
  });

  it("throws for each weak value", async () => {
    for (const w of WEAK) {
      process.env[ENV] = w;
      vi.resetModules();
      await expect(load()).rejects.toThrow(ENV);
    }
  });

  it("returns existing file content when no env", async () => {
    delete process.env[ENV];
    fs.writeFileSync(path.join(tempDir, FILE), "persisted-secret", {
      mode: 0o600,
    });
    const result = await load();
    expect(result).toBe("persisted-secret");
  });

  it("tightens permissions on an existing secret file", async () => {
    delete process.env[ENV];
    const file = path.join(tempDir, FILE);
    fs.writeFileSync(file, "persisted-secret", { mode: 0o644 });
    await load();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("trims whitespace from file content", async () => {
    delete process.env[ENV];
    fs.writeFileSync(path.join(tempDir, FILE), "  from-file  \n", {
      mode: 0o600,
    });
    const result = await load();
    expect(result).toBe("from-file");
  });

  it("generates and persists a 64-char lowercase hex secret", async () => {
    delete process.env[ENV];
    const result = await load();
    expect(result).toMatch(/^[0-9a-f]{64}$/);
    const stat = fs.statSync(path.join(tempDir, FILE));
    // mode 0o600 = 384 decimal; stat.mode includes file-type bits
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("second call returns the same persisted value", async () => {
    delete process.env[ENV];
    const first = await load();
    const second = await load();
    expect(second).toBe(first);
  });

  it("rejects weak file content as weak", async () => {
    delete process.env[ENV];
    fs.writeFileSync(path.join(tempDir, FILE), "secret", { mode: 0o600 });
    await expect(load()).rejects.toThrow(FILE);
  });

  it("empty file triggers generation (not treated as a value)", async () => {
    delete process.env[ENV];
    fs.writeFileSync(path.join(tempDir, FILE), "", { mode: 0o600 });
    const result = await load();
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
