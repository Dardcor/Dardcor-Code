/**
 * Tests for the `dardcor-code migrate --from-9router` CLI command
 * (cli/src/cli/commands/migrate.js).
 *
 * Hermetic: the migrate core (runMigrate) is dependency-injected, so no network
 * or gateway is needed. The fixture is a synthetic legacy 9router export in the
 * exact shape exportDb returns (tests/unit/fixtures/legacy-9router-export.json).
 *
 * Covers:
 *  - rewrite: local URLs (:20128 → :21128), legacy header names, `9router`
 *    slot identifiers rewritten; the 9router.com cloud domain left alone;
 *    provider secrets (apiKey, accessToken, refreshToken, apiKeys) preserved
 *    byte-identical through the rewrite.
 *  - overwrite refusal: populated target + no --force + declined confirm →
 *    abort with code 1 and NO import call; --force → proceeds.
 *  - source immutability: rewritePayload and runMigrate never mutate the
 *    source payload object.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  rewritePayload, isTargetPopulated, runMigrate, computeCliToken, parseArgs,
  importTo, TARGET_PASSWORD_HEADER,
} = require("../../cli/src/cli/commands/migrate.js");

function loadFixture() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "legacy-9router-export.json"), "utf8"));
}

const ok = (body) => ({ status: 200, body });

describe("rewritePayload", () => {
  it("rewrites local legacy URLs to the Dardcor Code port", () => {
    const out = rewritePayload(loadFixture());
    expect(out.settings.mitmRouterBaseUrl).toBe("http://localhost:21128");
    expect(out.settings.tunnelUrl).toBe("http://127.0.0.1:21128");
    expect(out.settings.outboundProxyUrl).toBe("http://localhost:21128");
    expect(out.providerConnections[0].providerSpecificData.baseUrl).toBe("http://127.0.0.1:21128/v1");
    expect(out.providerNodes[0].baseUrl).toBe("http://localhost:21128/v1");
  });

  it("rewrites legacy header names, including nested ones", () => {
    const out = rewritePayload(loadFixture());
    expect(out.providerConnections[0].providerSpecificData.extra.header).toBe("x-dardcor-token-saver");
  });

  it("rewrites `9router` slot identifiers and model prefixes", () => {
    const out = rewritePayload(loadFixture());
    expect(out.combos[0].models).toEqual(["dardcor-code/kr/claude-sonnet-4.5", "glm/glm-4.7"]);
    expect(out.modelAliases.sonnet).toBe("dardcor-code/kr/claude-sonnet-4.5");
    expect(out.customModels[0].providerAlias).toBe("dardcor-code");
    expect(out.mitmAlias.antigravity["gemini-pro-agent"]).toBe("dardcor-code/kr/claude-sonnet-4.5");
  });

  it("leaves the 9router.com cloud domain untouched", () => {
    const out = rewritePayload(loadFixture());
    expect(out.settings.cloudUrl).toBe("https://9router.com/sync");
  });

  it("preserves provider secrets byte-identical and never touches apiKeys", () => {
    const src = loadFixture();
    const out = rewritePayload(src);
    expect(out.providerConnections[0].apiKey).toBe("sk-or-legacy-secret-value-0001");
    expect(out.providerConnections[1].accessToken).toBe("sk-ant-legacy-access-token-abc");
    expect(out.providerConnections[1].refreshToken).toBe("refresh-legacy-token-xyz");
    expect(out.apiKeys).toEqual(src.apiKeys);
    expect(out.apiKeys[0].key).toBe("sk-9router-legacy-hmac-crc0001");
  });

  it("does not mutate the source payload (source immutability)", () => {
    const src = loadFixture();
    const snapshot = JSON.stringify(src);
    rewritePayload(src);
    expect(JSON.stringify(src)).toBe(snapshot);
  });
});

describe("isTargetPopulated", () => {
  it("treats a target with only the auto-provisioned Default Key as empty", () => {
    expect(isTargetPopulated({ settings: {}, apiKeys: [{ id: "k", name: "Default Key", key: "sk-x" }] })).toBe(false);
  });

  it("treats an empty export as empty", () => {
    expect(isTargetPopulated({ settings: {}, apiKeys: [], combos: [] })).toBe(false);
  });

  it("flags any provider connection as populated", () => {
    expect(isTargetPopulated({ providerConnections: [{ id: "c" }] })).toBe(true);
  });

  it("flags a user API key as populated", () => {
    expect(isTargetPopulated({ apiKeys: [{ id: "k", name: "Work", key: "sk-x" }] })).toBe(true);
  });
});

describe("runMigrate (overwrite refusal + flow)", () => {
  const sourceExport = () => loadFixture();

  it("refuses to overwrite a populated target without --force and without confirm", async () => {
    const src = sourceExport();
    const imports = [];
    const result = await runMigrate({
      exportLegacy: () => ok(src),
      fetchTarget: () => ok({ settings: {}, providerConnections: [{ id: "existing" }] }),
      importTarget: (payload) => { imports.push(payload); return ok({ settings: {}, providerConnections: payload.providerConnections }); },
      force: false,
      confirm: () => Promise.resolve(false),
    });
    expect(result.code).toBe(1);
    expect(result.report.error).toMatch(/already contains data/);
    expect(imports).toHaveLength(0);
  });

  it("proceeds with --force when the target is populated", async () => {
    const src = sourceExport();
    let imported;
    const result = await runMigrate({
      exportLegacy: () => ok(src),
      fetchTarget: () => ok({ settings: {}, providerConnections: [{ id: "existing" }] }),
      importTarget: (payload) => { imported = payload; return ok(payload); },
      force: true,
    });
    expect(result.code).toBe(0);
    expect(imported).toBeDefined();
    expect(imported.settings.mitmRouterBaseUrl).toBe("http://localhost:21128");
    expect(imported.providerConnections[0].apiKey).toBe("sk-or-legacy-secret-value-0001");
  });

  it("imports without confirmation when the target is empty", async () => {
    const src = sourceExport();
    let imported;
    const result = await runMigrate({
      exportLegacy: () => ok(src),
      fetchTarget: () => ok({ settings: {}, apiKeys: [{ id: "k", name: "Default Key", key: "sk-x" }] }),
      importTarget: (payload) => { imported = payload; return ok(payload); },
      force: false,
      confirm: () => { throw new Error("confirm must not be called for an empty target"); },
    });
    expect(result.code).toBe(0);
    expect(imported).toBeDefined();
  });

  it("does not mutate the source payload through the full core flow", async () => {
    const src = sourceExport();
    const snapshot = JSON.stringify(src);
    await runMigrate({
      exportLegacy: () => ok(src),
      fetchTarget: () => ok({ settings: {} }),
      importTarget: (payload) => ok(payload),
      force: true,
    });
    expect(JSON.stringify(src)).toBe(snapshot);
  });
});

describe("importTo (password transport)", () => {
  it("sends the payload unchanged and the password only in the x-dardcor-password header", async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        requests.push({ headers: req.headers, body: data ? JSON.parse(data) : null });
        res.setHeader("Content-Type", "application/json");
        // First attempt: CLI token rejected (401) → forces the password fallback.
        res.end(JSON.stringify(requests.length === 1 ? { error: "Unauthorized" } : { success: true }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    try {
      const payload = { settings: {}, providerConnections: [{ id: "c", apiKey: "sk-secret" }] };
      const snapshot = JSON.stringify(payload);

      const res = await importTo("127.0.0.1", port, "cli-token", payload, "dash-pass");

      expect(res.status).toBe(200);
      expect(requests).toHaveLength(2);
      for (const req of requests) {
        expect(req.headers["x-dardcor-cli-token"]).toBe("cli-token");
        // Body payload immutability: never contains the password, never mutated.
        expect(req.body).not.toHaveProperty("password");
        expect(req.body).toEqual(payload);
      }
      expect(requests[1].headers[TARGET_PASSWORD_HEADER]).toBe("dash-pass");
      expect(requests[0].headers[TARGET_PASSWORD_HEADER]).toBeUndefined();
      expect(JSON.stringify(payload)).toBe(snapshot);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("computeCliToken", () => {
  it("mirrors the server scheme: sha256(raw + salt + secret), first 16 hex chars", () => {
    const token = computeCliToken({ raw: "abc123", secret: "deadbeef", salt: "9r-cli-auth" });
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(token).toBe(computeCliToken({ raw: "abc123", secret: "deadbeef", salt: "9r-cli-auth" }));
    expect(token).not.toBe(computeCliToken({ raw: "abc123", secret: "deadbeef", salt: "dardcor-cli-auth" }));
  });
});

describe("parseArgs", () => {
  it("applies migrate defaults", () => {
    const opts = parseArgs(["--from-9router"]);
    expect(opts.from9router).toBe(true);
    expect(opts.legacyHost).toBe("127.0.0.1");
    expect(opts.legacyPort).toBe(20128);
    expect(opts.host).toBe("127.0.0.1");
    expect(opts.port).toBe(21128);
    expect(opts.force).toBe(false);
  });

  it("honors explicit endpoints and flags", () => {
    const opts = parseArgs(["--from-9router", "--legacy-port", "20000", "--port", "30000", "--legacy-dir", "/tmp/legacy", "--force"]);
    expect(opts.legacyPort).toBe(20000);
    expect(opts.port).toBe(30000);
    expect(opts.legacyDir).toBe("/tmp/legacy");
    expect(opts.force).toBe(true);
  });
});
