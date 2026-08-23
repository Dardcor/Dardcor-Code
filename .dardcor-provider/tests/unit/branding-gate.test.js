import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  scanBranding,
  scanText,
  walkBranding,
  PROVENANCE_ALLOWLIST,
  COMPAT_ALIASES,
  LINE_PATTERN_COMPAT,
} from "../../scripts/check-branding.mjs";

/**
 * Phase 8 branding gate (docs/REBRAND.md §7 #2). Pure-stdlib scanner: tests
 * use temp dirs only — no git, no rg, no external processes.
 */

const tempDirs = [];

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "branding-gate-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe("scanBranding", () => {
  it("clean tree: ok, zero hits", () => {
    const root = makeTree({
      "src/ok.js": 'export const NAME = "miawrouter";\n',
      "README.md": "# MiawRouter\n",
    });
    const result = scanBranding({ root });
    expect(result.ok).toBe(true);
    expect(result.forbidden).toEqual([]);
    expect(result.counts.forbidden).toBe(0);
  });

  it("flags old product name case-insensitively as forbidden", () => {
    const root = makeTree({ "src/app.js": 'const brand = "9Router";\n' });
    const result = scanBranding({ root });
    expect(result.ok).toBe(false);
    expect(result.forbidden).toHaveLength(1);
    expect(result.forbidden[0]).toMatchObject({
      file: "src/app.js",
      line: 1,
      term: "9router",
    });
  });

  it("flags each scan term from REBRAND.md §1", () => {
    const root = makeTree({
      "src/terms.js": [
        "9router", "9r_", "X-9Router", "NINEROUTER", "20127", "20128",
        "20129", "decolua", ".9router", "9router.com",
      ].join("\n"),
    });
    const result = scanBranding({ root });
    const terms = new Set(result.forbidden.map((h) => h.term));
    for (const expected of ["9router", "9r_", "X-9Router", "NINEROUTER", "20127", "20128", "20129", "decolua", ".9router", "9router.com"]) {
      expect(terms.has(expected), `missing forbidden hit for ${expected}`).toBe(true);
    }
  });

  it("provenance files (REBRAND.md §3) are allowlisted, never forbidden", () => {
    const root = makeTree({
      "LICENSE": "Copyright (c) decolua and contributors\n",
      "docs/UPSTREAM.md": "upstream: github.com/decolua/9router\n",
      "docs/superpowers/specs/old.md": "9Router history\n",
      "src/app.js": "9Router\n",
    });
    const result = scanBranding({ root });
    expect(result.forbidden.map((h) => h.file)).toEqual(["src/app.js"]);
    expect(result.allowlisted.map((h) => h.file).sort()).toEqual([
      "LICENSE", "docs/UPSTREAM.md", "docs/superpowers/specs/old.md",
    ]);
    expect(result.counts.allowlistedFiles).toBe(3);
  });

  it("compat alias file: allowed term is compat, other old terms stay forbidden", () => {
    const root = makeTree({
      "open-sse/config/runtimeConfig.js": [
        'export const TOKEN_SAVER_HEADER = "x-9router-token-saver";',
        "export const PORT = 20128;",
      ].join("\n"),
    });
    const result = scanBranding({ root });
    expect(result.compat.map((h) => h.term).sort()).toEqual(["9router", "X-9Router"]);
    expect(result.forbidden).toHaveLength(1);
    expect(result.forbidden[0]).toMatchObject({ line: 2, term: "20128" });
  });

  it("compat scoping: same old term is still forbidden outside its alias file", () => {
    const root = makeTree({
      "src/other.js": "const dir = '~/.9router';\n",
    });
    const result = scanBranding({ root });
    expect(result.compat).toEqual([]);
    expect(result.forbidden.map((h) => h.term).sort()).toEqual([".9router", "9router"]);
  });

  it("cli/cli.js: .9router reads are compat, plain 9router hits are forbidden", () => {
    const root = makeTree({
      "cli/cli.js": [
        'const dir = path.join(os.homedir(), ".9router");',
        'console.log("[9router] starting");',
      ].join("\n"),
    });
    const result = scanBranding({ root });
    expect(result.compat.length).toBeGreaterThan(0);
    expect(result.compat.every((h) => h.line === 1)).toBe(true);
    expect(result.forbidden.map((h) => h.line)).toEqual([2]);
  });

  it("excluded paths and binary assets are never scanned", () => {
    const root = makeTree({
      "node_modules/pkg/index.js": "9Router\n",
      "cli/app/bundle.js": "9Router\n",
      ".next/server/app.js": "9Router\n",
      ".next-cli-build/server.js": "9Router\n",
      "graphify-out/graph.json": "9Router\n",
      ".remember/notes.md": "9Router\n",
      ".omo/x.md": "9Router\n",
      ".opencode/x.md": "9Router\n",
      "package-lock.json": "9Router\n",
      "dist/bundle.js.map": "9Router\n",
      "images/logo.png": "9Router",
      "images/logo.ico": "9Router",
      "src/real.js": "9Router\n",
    });
    const result = scanBranding({ root });
    expect(result.forbidden.map((h) => h.file)).toEqual(["src/real.js"]);
    expect(result.forbidden).toHaveLength(1);
  });

  it("binary files (NUL bytes) are skipped like rg's default", () => {
    const root = makeTree({ "src/data.bin": "9Router\u0000bytes\n" });
    const result = scanBranding({ root });
    expect(result.forbidden).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("hidden files are scanned (inventory used --hidden)", () => {
    const root = makeTree({ ".env.example": "PORT=20128\n" });
    const result = scanBranding({ root });
    expect(result.forbidden).toHaveLength(1);
    expect(result.forbidden[0].file).toBe(".env.example");
  });

  it("is deterministic: identical trees yield identical results", () => {
    const files = {
      "src/a.js": "9Router 20128 decolua\n",
      "docs/UPSTREAM.md": "9router\n",
      "cli/cli.js": "~/.9router\n",
    };
    const r1 = scanBranding({ root: makeTree(files) });
    const r2 = scanBranding({ root: makeTree(files) });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.counts.forbidden).toBe(r2.counts.forbidden);
  });

  it("reports per-term counts and file counts", () => {
    const root = makeTree({
      "src/a.js": "9Router 9router\n",
      "src/b.js": "20128\n",
    });
    const result = scanBranding({ root });
    expect(result.counts).toMatchObject({
      forbidden: 3,
      forbiddenFiles: 2,
      allowlisted: 0,
      compat: 0,
    });
    expect(result.ok).toBe(false);
  });
});

describe("scanText / walkBranding", () => {
  it("scanText tags compat hits by span overlap with alias terms", () => {
    const hits = scanText('const h = "x-9router-token-saver";\n', "open-sse/config/runtimeConfig.js");
    expect(hits.every((h) => h.compat)).toBe(true);
    expect(hits.map((h) => h.term).sort()).toEqual(["9router", "X-9Router"]);
  });

  it("scanText leaves compat flag false for non-alias files", () => {
    const hits = scanText('const h = "x-9router-token-saver";\n', "src/other.js");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => !h.compat)).toBe(true);
  });

  it("walkBranding yields root-relative paths and skips exclusions", () => {
    const root = makeTree({
      "a.js": "",
      "node_modules/x.js": "",
      "sub/b.js": "",
      "sub/.next/c.js": "",
    });
    const files = [...walkBranding(root)];
    expect(files).toEqual(["a.js", "sub/b.js"]);
  });

  it("provenance and compat tables match REBRAND.md §3–§5", () => {
    expect(PROVENANCE_ALLOWLIST).toContain("LICENSE");
    expect(PROVENANCE_ALLOWLIST).toContain("docs/REBRAND.md");
    expect(PROVENANCE_ALLOWLIST).toContain("MIAWROUTER_CLONE_PLAYBOOK.md");
    expect(COMPAT_ALIASES["cli/cli.js"]).toEqual([".9router"]);
    expect(COMPAT_ALIASES["open-sse/config/appConstants.js"]).toEqual(["9router"]);
    expect(COMPAT_ALIASES["cli/src/cli/tray/autostart.js"]).toContain(".9router");
    // Phase 8 additions: legacy read-compat surfaces (REBRAND.md §5).
    expect(COMPAT_ALIASES["open-sse/handlers/chatCore.js"]).toContain("X-9Router");
    expect(COMPAT_ALIASES["src/dashboardGuard.js"]).toContain("9r_");
    expect(COMPAT_ALIASES["src/lib/grokBuildConfig.js"]).toContain("9router");
    expect(COMPAT_ALIASES["src/app/api/cli-tools/opencode-settings/route.js"]).toContain("9router");
    // Migration impl/test/fixture + real-test fallbacks + pinned snapshots.
    expect(COMPAT_ALIASES["cli/src/cli/commands/migrate.js"]).toContain("9router");
    expect(COMPAT_ALIASES["tests/unit/fixtures/legacy-9router-export.json"]).toContain("20128");
    expect(COMPAT_ALIASES["tests/unit/grok-build-config.test.js"]).toContain("9router");
    expect(COMPAT_ALIASES["tests/translator/real/thinking.real.test.js"]).toContain(".9router");
    expect(COMPAT_ALIASES["tests/translator/__snapshots__/golden-url-header.test.js.snap"]).toContain("9router");
    expect(COMPAT_ALIASES["tests/unit/kimi-usage.test.js"]).toContain("9router");
    expect(COMPAT_ALIASES["tests/unit/cursor-agent-proto.test.js"]).toContain("9router");
    // Gate self-tests + frozen planning doc are provenance.
    expect(PROVENANCE_ALLOWLIST).toContain("MIAWROUTER_AGENT_PROMPT_V2.md");
    expect(PROVENANCE_ALLOWLIST).toContain("tests/unit/branding-gate.test.js");
    expect(PROVENANCE_ALLOWLIST).toContain("tests/unit/rebrand-phase8.test.js");
  });

  it("LINE_PATTERN_COMPAT allows only the exact migration flag line in READMEs", () => {
    // The exact flag literal line is compat.
    const ok = scanText("miawrouter migrate --from-9router\n", "README.md");
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.every((h) => h.compat)).toBe(true);
    // Any other old-brand line in the same file is still forbidden.
    const bad = scanText('Run the legacy 9router install here.\n', "README.md");
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((h) => !h.compat)).toBe(true);
    // Same flag line in a file without a pattern entry stays forbidden.
    const other = scanText("miawrouter migrate --from-9router\n", "src/other.js");
    expect(other.every((h) => !h.compat)).toBe(true);
    expect(LINE_PATTERN_COMPAT["cli/README.md"]).toBeDefined();
  });
});
