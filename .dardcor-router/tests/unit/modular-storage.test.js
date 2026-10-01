import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const origDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-modular-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (origDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = origDataDir;
  vi.resetModules();
});

describe("Modular Storage Architecture", () => {
  it("R1: Automated backups and pruning resolve to root backups/ directory", async () => {
    const { getBackupsDir } = await import("@/lib/db/paths.js");
    const { makeBackupDir, pruneOldBackups } = await import("@/lib/db/backup.js");

    const backupsDir = getBackupsDir();
    expect(backupsDir).toBe(path.join(tempDir, "backups"));

    // Create 5 backup folders
    for (let i = 0; i < 5; i++) {
      const bDir = makeBackupDir(`test-backup-${i}`);
      expect(bDir.startsWith(backupsDir)).toBe(true);
      fs.writeFileSync(path.join(bDir, "test.txt"), `content ${i}`);
      // Slight delay for distinct mtime
      await new Promise((r) => setTimeout(r, 15));
    }

    const beforeEntries = fs.readdirSync(backupsDir).filter((f) => fs.statSync(path.join(backupsDir, f)).isDirectory());
    expect(beforeEntries.length).toBe(5);

    pruneOldBackups();

    const afterEntries = fs.readdirSync(backupsDir).filter((f) => fs.statSync(path.join(backupsDir, f)).isDirectory());
    expect(afterEntries.length).toBe(3); // KEEP_BACKUPS = 3
  });

  it("R2: Per-provider data isolation and isolated saver writes", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    // 1. Create connection for Antigravity
    const antiConn = await db.createProviderConnection({
      provider: "antigravity",
      authType: "oauth",
      email: "anti@example.com",
      displayName: "Antigravity Account 1",
    });

    const antiFile = path.join(tempDir, "provider", "Antigravity", "Antigravity.json");
    expect(fs.existsSync(antiFile)).toBe(true);
    const antiData = JSON.parse(fs.readFileSync(antiFile, "utf-8"));
    expect(antiData.length).toBe(1);
    expect(antiData[0].id).toBe(antiConn.id);

    // 2. Create connection for Gemini
    const geminiConn = await db.createProviderConnection({
      provider: "gemini",
      authType: "apikey",
      name: "gemini-key-1",
      apiKey: "AIzaSyTestKey",
    });

    const geminiFile = path.join(tempDir, "provider", "Gemini", "Gemini.json");
    expect(fs.existsSync(geminiFile)).toBe(true);
    const geminiData = JSON.parse(fs.readFileSync(geminiFile, "utf-8"));
    expect(geminiData.length).toBe(1);
    expect(geminiData[0].id).toBe(geminiConn.id);

    // 3. Record mtime of Gemini file
    const geminiMtimeBefore = fs.statSync(geminiFile).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));

    // 4. Update Antigravity connection
    await db.updateProviderConnection(antiConn.id, {
      displayName: "Updated Antigravity Name",
    });

    // Antigravity file is updated
    const antiDataUpdated = JSON.parse(fs.readFileSync(antiFile, "utf-8"));
    expect(antiDataUpdated[0].displayName).toBe("Updated Antigravity Name");

    // Gemini file was NOT touched
    const geminiMtimeAfter = fs.statSync(geminiFile).mtimeMs;
    expect(geminiMtimeAfter).toBe(geminiMtimeBefore);
  });

  it("R3: Core system configs and usage logs stored in dedicated system/ subdirectories", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    // Update settings
    await db.updateSettings({ tunnelUrl: "https://test.tunnel.com" });
    // Add API key
    await db.createApiKey("key-1", "mach-1");
    // Add combo
    await db.createCombo({ name: "combo-1", models: ["m1", "m2"] });
    // Add proxy pool
    await db.createProxyPool({ name: "pool-1", proxyUrl: "http://proxy.test:8080", type: "http" });
    // Add model alias
    await db.setModelAlias("gpt4", "gpt-4-turbo");
    // Add pricing
    await db.updatePricing({ openai: { "gpt-4": { input: 0.03, output: 0.06 } } });

    // Save request usage
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    adapter.flushSync();

    // Check system/db/
    const sysDbDir = path.join(tempDir, "system", "db");
    expect(fs.existsSync(path.join(sysDbDir, "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "api-keys.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "combos.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "proxy-pools.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "aliases.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "pricing.json"))).toBe(true);

    const settingsContent = JSON.parse(fs.readFileSync(path.join(sysDbDir, "settings.json"), "utf-8"));
    expect(settingsContent.tunnelUrl).toBe("https://test.tunnel.com");

    const aliasesContent = JSON.parse(fs.readFileSync(path.join(sysDbDir, "aliases.json"), "utf-8"));
    expect(aliasesContent.modelAliases.gpt4).toBe("gpt-4-turbo");

    // Check system/usage/
    const sysUsageDir = path.join(tempDir, "system", "usage");
    expect(fs.existsSync(path.join(sysUsageDir, "history.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysUsageDir, "daily.json"))).toBe(true);

    const historyContent = JSON.parse(fs.readFileSync(path.join(sysUsageDir, "history.json"), "utf-8"));
    expect(historyContent.length).toBeGreaterThanOrEqual(1);
    expect(historyContent[0].model).toBe("gpt-4");
  });

  it("R4: Zero-data-loss migration from monolithic database.json into modular structure", async () => {
    // Setup legacy structure in tempDir/db/database.json
    const legacyDbDir = path.join(tempDir, "db");
    const legacyBackupsDir = path.join(legacyDbDir, "backups");
    fs.mkdirSync(legacyBackupsDir, { recursive: true });

    // Put a dummy old backup inside legacy backups
    fs.writeFileSync(path.join(legacyBackupsDir, "old-backup.txt"), "old backup data");

    const legacyPayload = {
      _meta: [{ key: "schemaVersion", value: "1" }],
      settings: [{ id: 1, data: JSON.stringify({ tunnelUrl: "https://legacy.example.com", requireLogin: true }) }],
      apiKeys: [{ id: "ak-1", key: "sk-legacy-key", name: "legacy key", isActive: 1, createdAt: "2026-01-01T00:00:00Z" }],
      combos: [{ id: "cb-1", name: "smart-fallback", kind: "fallback", models: "[\"gemini-pro\",\"gpt-4\"]", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
      proxyPools: [{ id: "pp-1", isActive: 1, testStatus: "ok", data: "{\"url\":\"http://proxy:8080\"}", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
      kv: [
        { scope: "modelAliases", key: "fast", value: "\"gpt-4o-mini\"" },
        { scope: "pricing", key: "openai", value: "{\"gpt-4\":{\"input\":0.01,\"output\":0.03}}" },
      ],
      providerConnections: [
        {
          id: "anti-1",
          provider: "antigravity",
          authType: "oauth",
          email: "user@antigravity.test",
          name: "Antigravity Production",
          priority: 1,
          isActive: 1,
          data: "{\"accessToken\":\"tok-anti-1\"}",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "codex-1",
          provider: "codex",
          authType: "oauth",
          email: "coder@openai.test",
          name: "OpenAI Codex Main",
          priority: 1,
          isActive: 1,
          data: "{\"accessToken\":\"tok-codex-1\"}",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "gemini-1",
          provider: "gemini-cli",
          authType: "oauth",
          email: "gemini@cli.test",
          name: "Gemini CLI Account",
          priority: 1,
          isActive: 1,
          data: "{\"accessToken\":\"tok-gemini-1\"}",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      usageHistory: [
        {
          id: 1,
          timestamp: "2026-01-01T12:00:00Z",
          provider: "antigravity",
          model: "gemini-flash",
          promptTokens: 50,
          completionTokens: 25,
          cost: 0.001,
        },
      ],
      usageDaily: [
        {
          dateKey: "2026-01-01",
          data: JSON.stringify({ requests: 1, promptTokens: 50, completionTokens: 25, cost: 0.001 }),
        },
      ],
      requestDetails: [],
    };

    const legacyFilePath = path.join(legacyDbDir, "database.json");
    fs.writeFileSync(legacyFilePath, JSON.stringify(legacyPayload, null, 2), "utf-8");

    // Initialize adapter - triggers migration
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    // Verify 1: legacy file renamed to .migrated
    expect(fs.existsSync(legacyFilePath)).toBe(false);
    expect(fs.existsSync(`${legacyFilePath}.migrated`)).toBe(true);

    // Verify 2: safety backup created in root backups/
    const backupsDir = path.join(tempDir, "backups");
    expect(fs.existsSync(backupsDir)).toBe(true);
    expect(fs.existsSync(path.join(backupsDir, "database.json.bak"))).toBe(true);
    // Old backup moved to root backups/
    expect(fs.existsSync(path.join(backupsDir, "old-backup.txt"))).toBe(true);

    // Verify 3: Modular provider files created
    const antiPath = path.join(tempDir, "provider", "Antigravity", "Antigravity.json");
    expect(fs.existsSync(antiPath)).toBe(true);
    const antiRows = JSON.parse(fs.readFileSync(antiPath, "utf-8"));
    expect(antiRows.length).toBe(1);
    expect(antiRows[0].email).toBe("user@antigravity.test");

    const codexPath = path.join(tempDir, "provider", "OpenAI-Codex", "OpenAI-Codex.json");
    expect(fs.existsSync(codexPath)).toBe(true);
    const codexRows = JSON.parse(fs.readFileSync(codexPath, "utf-8"));
    expect(codexRows.length).toBe(1);
    expect(codexRows[0].email).toBe("coder@openai.test");

    const geminiCliPath = path.join(tempDir, "provider", "Gemini-CLI", "Gemini-CLI.json");
    expect(fs.existsSync(geminiCliPath)).toBe(true);
    const geminiCliRows = JSON.parse(fs.readFileSync(geminiCliPath, "utf-8"));
    expect(geminiCliRows.length).toBe(1);
    expect(geminiCliRows[0].email).toBe("gemini@cli.test");

    // Verify all other canonical provider folders exist immediately
    expect(fs.existsSync(path.join(tempDir, "provider", "Claude", "Claude.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "provider", "DeepSeek", "DeepSeek.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "provider", "Grok", "Grok.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "provider", "Gemini", "Gemini.json"))).toBe(true);

    // Verify 4: System DB files created
    const sysDbDir = path.join(tempDir, "system", "db");
    expect(fs.existsSync(path.join(sysDbDir, "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "api-keys.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "combos.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "proxy-pools.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "aliases.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysDbDir, "pricing.json"))).toBe(true);

    // Verify 5: Usage files created
    const sysUsageDir = path.join(tempDir, "system", "usage");
    expect(fs.existsSync(path.join(sysUsageDir, "history.json"))).toBe(true);
    expect(fs.existsSync(path.join(sysUsageDir, "daily.json"))).toBe(true);

    // Verify 6: Memory SQLite loaded all migrated data
    const settings = await db.getSettings();
    expect(settings.tunnelUrl).toBe("https://legacy.example.com");

    const conns = await db.getProviderConnections();
    expect(conns.length).toBe(3);
    const anti = conns.find((c) => c.provider === "antigravity");
    expect(anti).toBeDefined();
    expect(anti.accessToken).toBe("tok-anti-1");

    const codex = conns.find((c) => c.provider === "codex");
    expect(codex).toBeDefined();
    expect(codex.accessToken).toBe("tok-codex-1");

    const keys = await db.getApiKeys();
    expect(keys.length).toBe(1);
    expect(keys[0].key).toBe("sk-legacy-key");

    const combos = await db.getCombos();
    expect(combos.length).toBe(1);
    expect(combos[0].name).toBe("smart-fallback");

    const aliases = await db.getModelAliases();
    expect(aliases.fast).toBe("gpt-4o-mini");

    const pricing = await db.getPricing();
    expect(pricing.openai["gpt-4"].input).toBe(0.01);

    const history = await db.getUsageHistory();
    expect(history.length).toBe(1);
    expect(history[0].provider).toBe("antigravity");
  });
});
