// REQUIRE_API_KEY env override semantics for settingsRepo + /api/settings route lock
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
}));

let tempDir;
const origEnv = process.env.REQUIRE_API_KEY;
const origDataDir = process.env.DATA_DIR;

function saveEnv() {
  if (origEnv === undefined) delete process.env.REQUIRE_API_KEY;
  else process.env.REQUIRE_API_KEY = origEnv;
  if (origDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = origDataDir;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "miawrouter-reqapikey-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.REQUIRE_API_KEY;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  saveEnv();
});

async function getRepo() {
  const mod = await import("@/lib/db/repos/settingsRepo.js");
  return mod;
}

describe("REQUIRE_API_KEY env override", () => {
  it("fresh DB + no env → default true", async () => {
    const { getSettings } = await getRepo();
    const s = await getSettings();
    expect(s.requireApiKey).toBe(true);
  });

  it('env "true" forces true even when DB stores false', async () => {
    const { updateSettings, getSettings } = await getRepo();
    await updateSettings({ requireApiKey: false });
    process.env.REQUIRE_API_KEY = "true";
    const s = await getSettings();
    expect(s.requireApiKey).toBe(true);
  });

  it('env "false" forces false even when DB stores true', async () => {
    const { updateSettings, getSettings } = await getRepo();
    // DB default is true; explicit write to be sure
    await updateSettings({ requireApiKey: true });
    process.env.REQUIRE_API_KEY = "false";
    const s = await getSettings();
    expect(s.requireApiKey).toBe(false);
  });

  it("env unset → preserves persisted DB value (false)", async () => {
    const { updateSettings, getSettings } = await getRepo();
    await updateSettings({ requireApiKey: false });
    delete process.env.REQUIRE_API_KEY;
    const s = await getSettings();
    expect(s.requireApiKey).toBe(false);
  });

  it("updateSettings returns effective value under env override", async () => {
    const { updateSettings } = await getRepo();
    process.env.REQUIRE_API_KEY = "false";
    const s = await updateSettings({ requireApiKey: true });
    expect(s.requireApiKey).toBe(false);
  });

  it("env override does not persist into DB", async () => {
    const { updateSettings, getSettings } = await getRepo();
    await updateSettings({ requireApiKey: false });
    // Force override
    process.env.REQUIRE_API_KEY = "true";
    const overridden = await getSettings();
    expect(overridden.requireApiKey).toBe(true);
    // Unset env — DB should still have false
    delete process.env.REQUIRE_API_KEY;
    const restored = await getSettings();
    expect(restored.requireApiKey).toBe(false);
  });

  it("env garbage value is ignored, preserves DB", async () => {
    const { updateSettings, getSettings } = await getRepo();
    await updateSettings({ requireApiKey: false });
    process.env.REQUIRE_API_KEY = "maybe";
    const s = await getSettings();
    expect(s.requireApiKey).toBe(false);
  });
});

async function getRoute() {
  const mod = await import("@/app/api/settings/route.js");
  return mod;
}

describe("GET/PATCH /api/settings REQUIRE_API_KEY env lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: true,
      requireLogin: true,
      rtkEnabled: true,
      password: "hash",
      oidcClientSecret: "secret",
      oidcIssuerUrl: "https://issuer.example",
      oidcClientId: "client",
    });
    mocks.updateSettings.mockImplementation(async (body) => ({
      requireApiKey: true,
      requireLogin: true,
      ...body,
    }));
  });

  it('GET exposes requireApiKeyLocked=true when env is exactly "true"', async () => {
    process.env.REQUIRE_API_KEY = "true";
    const res = await (await getRoute()).GET();
    expect(res.body.requireApiKeyLocked).toBe(true);
  });

  it('GET exposes requireApiKeyLocked=true when env is exactly "false"', async () => {
    process.env.REQUIRE_API_KEY = "false";
    const res = await (await getRoute()).GET();
    expect(res.body.requireApiKeyLocked).toBe(true);
  });

  it("GET returns requireApiKeyLocked=false when env is unset", async () => {
    delete process.env.REQUIRE_API_KEY;
    const res = await (await getRoute()).GET();
    expect(res.body.requireApiKeyLocked).toBe(false);
  });

  it("GET returns requireApiKeyLocked=false for unrecognized env value", async () => {
    process.env.REQUIRE_API_KEY = "maybe";
    const res = await (await getRoute()).GET();
    expect(res.body.requireApiKeyLocked).toBe(false);
  });

  it('PATCH rejects requireApiKey with 400 and no DB write when env "true"', async () => {
    process.env.REQUIRE_API_KEY = "true";
    const res = await (await getRoute()).PATCH({
      json: async () => ({ requireApiKey: false }),
    });
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('PATCH rejects requireApiKey mixed with unrelated keys when env "false"', async () => {
    process.env.REQUIRE_API_KEY = "false";
    const res = await (await getRoute()).PATCH({
      json: async () => ({ requireApiKey: true, rtkEnabled: false }),
    });
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("PATCH allows unrelated settings while locked", async () => {
    process.env.REQUIRE_API_KEY = "true";
    const res = await (await getRoute()).PATCH({
      json: async () => ({ rtkEnabled: false }),
    });
    expect(res.status).toBe(200);
    expect(res.body.requireApiKeyLocked).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ rtkEnabled: false });
  });

  it("PATCH allows requireApiKey update when env unset", async () => {
    delete process.env.REQUIRE_API_KEY;
    const res = await (await getRoute()).PATCH({
      json: async () => ({ requireApiKey: false }),
    });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ requireApiKey: false });
  });

  it("PATCH allows requireApiKey update when env unrecognized", async () => {
    process.env.REQUIRE_API_KEY = "maybe";
    const res = await (await getRoute()).PATCH({
      json: async () => ({ requireApiKey: true }),
    });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ requireApiKey: true });
  });
});
