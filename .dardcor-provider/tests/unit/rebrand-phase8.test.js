import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Phase 8 rebrand — user-visible strings, locale catalogs, skills, and assets.
 * Pure fs-based string checks: no src imports, no network, no gate execution.
 * Legacy "9router" tokens are allowed ONLY on the read-compat surfaces listed
 * in docs/REBRAND.md §5 (which scripts/check-branding.mjs COMPAT_ALIASES mirrors).
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LITERALS_DIR = path.join(ROOT, "public/i18n/literals");
const SKILLS_DIR = path.join(ROOT, "skills");
const CLI_TOOLS_DIR = path.join(ROOT, "src/app/(dashboard)/dashboard/cli-tools");

const LEGACY_RE = /9router|9Router|NINEROUTER|20127|20128|20129|\.9router|9router\.com|9r_/g;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("locale catalogs (public/i18n/literals)", () => {
  const files = fs.readdirSync(LITERALS_DIR).filter((f) => f.endsWith(".json"));

  it("every catalog is valid JSON with a flat key->value shape", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    for (const f of files) {
      const parsed = JSON.parse(read(`public/i18n/literals/${f}`));
      expect(parsed, `${f} must be a flat object`).toBeTypeOf("object");
      for (const [k, v] of Object.entries(parsed)) {
        expect(typeof v, `${f}: value for ${k}`).toBe("string");
      }
    }
  });

  it("no catalog key or value carries a legacy brand token", () => {
    for (const f of files) {
      const parsed = JSON.parse(read(`public/i18n/literals/${f}`));
      for (const [k, v] of Object.entries(parsed)) {
        expect(k.match(LEGACY_RE), `${f}: key ${k}`).toBeNull();
        expect(v.match(LEGACY_RE), `${f}: value of ${k}`).toBeNull();
      }
    }
  });

  it("the 4 universal Dardcor Code keys exist in every catalog", () => {
    const universal = [
      "Intercept CLI tool traffic and route through Dardcor Code",
      "Use Antigravity IDE & GitHub Copilot → with ANY provider/model from Dardcor Code",
      "Antigravity/Copilot IDE request → DNS redirect to localhost:443 → MITM proxy intercepts → Dardcor Code → response to Antigravity/Copilot",
      "sk_dardcor-code (default)",
    ];
    for (const f of files) {
      const parsed = JSON.parse(read(`public/i18n/literals/${f}`));
      for (const key of universal) {
        expect(parsed[key], `${f} missing key: ${key}`).toBeTypeOf("string");
      }
    }
  });

  it("big catalogs (km, fa, th, zh-CN) carry the full Dardcor Code key set", () => {
    const big = ["km.json", "fa.json", "th.json", "zh-CN.json"];
    for (const f of big) {
      const parsed = JSON.parse(read(`public/i18n/literals/${f}`));
      expect(parsed["How Dardcor Code Works"]).toBeTypeOf("string");
      expect(parsed["Point your CLI tools to http://localhost:21128"]).toBeTypeOf("string");
      expect(parsed["Dardcor Code (Entry)"]).toBeTypeOf("string");
      expect(parsed["Configure dardcor-code as an OpenAI-compatible provider to route all jcode requests through dardcor-code's optimization layer."]).toBeTypeOf("string");
      expect(parsed["npm install -g dardcor-code"]).toBeTypeOf("string");
    }
  });
});

describe("skills (skills/ + src/shared/constants/skills.js)", () => {
  const ids = [
    "dardcor-code",
    "dardcor-code-chat",
    "dardcor-code-embeddings",
    "dardcor-code-image",
    "dardcor-code-stt",
    "dardcor-code-tts",
    "dardcor-code-video",
    "dardcor-code-web-fetch",
    "dardcor-code-web-search",
  ];

  it("skill directories are renamed to dardcor-code-*", () => {
    const dirs = fs.readdirSync(SKILLS_DIR).filter((e) => fs.statSync(path.join(SKILLS_DIR, e)).isDirectory());
    expect(dirs.sort()).toEqual([...ids].sort());
  });

  it("every skill SKILL.md uses DARDCOR_URL/DARDCOR_KEY, port 21128, and no legacy tokens", () => {
    for (const id of ids) {
      const md = read(`skills/${id}/SKILL.md`);
      expect(md.match(LEGACY_RE), `${id} SKILL.md has legacy token`).toBeNull();
      expect(md).toContain("DARDCOR_URL");
      expect(md).toContain("DARDCOR_KEY");
      expect(md).toContain(`name: ${id}`);
      expect(md).not.toContain("localhost:20128");
      expect(md).not.toContain("NINEROUTER_");
    }
  });

  it("skills.js constants emit dardcor-code ids and the product domain", () => {
    const src = read("src/shared/constants/skills.js");
    expect(src.match(LEGACY_RE)).toBeNull();
    expect(src).toContain('id: "dardcor-code"');
    expect(src).toContain('id: "dardcor-code-chat"');
    expect(src).toContain("dardcor-code.web.id");
    expect(src).toContain('name: "Dardcor Code (Entry)"');
    expect(src).not.toContain("decolua");
  });

  it("dashboard skills page references the dardcor-code entry skill", () => {
    const page = read("src/app/(dashboard)/dashboard/skills/page.js");
    expect(page).toContain('getSkillRawUrl("dardcor-code")');
    expect(page.match(LEGACY_RE)).toBeNull();
  });
});

describe("CLI-tool components: writes use dardcor-code, reads keep legacy compat", () => {
  const display = (file) => read(`src/app/(dashboard)/dashboard/cli-tools/components/${file}`);

  it("no user-facing default API key or old port remains in any ToolCard", () => {
    const files = fs.readdirSync(path.join(CLI_TOOLS_DIR, "components")).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const src = display(f);
      expect(src).not.toContain("sk_9router");
      expect(src).not.toMatch(/localhost:(20128|20127|20129)/);
    }
  });

  it("client config previews write dardcor-code provider slots/env names", () => {
    expect(display("GrokBuildToolCard.js")).toContain('const MODEL_SLOT = "dardcor-code"');
    expect(display("CodexToolCard.js")).toContain('model_provider = "dardcor-code"');
    expect(display("CodexToolCard.js")).toContain("[model_providers.dardcor-code]");
    expect(display("CopilotToolCard.js")).toContain('name: "Dardcor Code"');
    expect(display("OpenCodeToolCard.js")).toContain('"dardcor-code": {');
    expect(display("OpenClawToolCard.js")).toContain('"dardcor-code": {');
    expect(display("OpenClawToolCard.js")).toContain("dardcor-code/${selectedModel");
    expect(display("JcodeToolCard.js")).toContain("[providers.dardcor-code]");
    expect(display("JcodeToolCard.js")).toContain("JCODE_DARDCOR CODE_API_KEY");
    expect(display("DroidToolCard.js")).toContain("custom:Dardcor Code-${i}");
  });

  it("legacy read surfaces survive: legacy slots, has9Router contract, localStorage key", () => {
    expect(display("OpenCodeToolCard.js")).toContain('["9router"]');
    expect(display("OpenClawToolCard.js")).toContain('providers?.["9router"]');
    expect(display("JcodeToolCard.js")).toContain('providers?.["9router"]');
    expect(display("DroidToolCard.js")).toContain("custom:9Router");
    expect(display("CopilotToolCard.js")).toContain('e.name === "9Router"');
    expect(display("ToolSummaryCard.js")).toContain("has9Router");
    expect(display("BaseUrlSelect.js")).toContain('"9router.cliToolEndpointPresets"');
    expect(display("EndpointPresetControl.js")).toContain('"9router.cliToolEndpointPresets"');
  });

  it("no legacy product name is displayed to the user in ToolCards", () => {
    const files = fs.readdirSync(path.join(CLI_TOOLS_DIR, "components")).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const src = display(f);
      // `has9Router` (contract field) and quoted legacy slot strings are allowed;
      // bare user-visible "9Router"/"9router" prose is not.
      const stripped = src
        .replace(/has9Router/g, "")
        .replace(/custom:9Router/g, "")
        .replace(/\["9router"\]/g, "")
        .replace(/startsWith\("9router\/"\)/g, "")
        .replace(/replace\(\/\^\(dardcor-code\|9router\)\\\//g, "")
        .replace(/\| providers\?\.\["9router"\]/g, "");
      expect(stripped.match(/9Router|9router/), `${f} still displays legacy brand`).toBeNull();
    }
  });

  it("branding gate COMPAT_ALIASES covers every component that keeps legacy reads", () => {
    const gate = read("scripts/check-branding.mjs");
    for (const f of [
      "DroidToolCard.js", "ToolSummaryCard.js", "CopilotToolCard.js",
      "DeepSeekTuiToolCard.js", "ClaudeToolCard.js", "ClineToolCard.js",
      "HermesToolCard.js", "CoworkToolCard.js", "GrokBuildToolCard.js",
      "KiloToolCard.js", "OpenCodeToolCard.js", "OpenClawToolCard.js",
      "JcodeToolCard.js",
    ]) {
      expect(gate, `COMPAT_ALIASES missing ${f}`).toContain(`cli-tools/components/${f}`);
    }
  });
});

describe("manifest / meta / assets", () => {
  it("PWA manifest and page metadata use Dardcor Code", () => {
    expect(read("src/app/manifest.js")).toContain("Dardcor Code");
    expect(read("src/app/manifest.js")).not.toContain("9Router");
    expect(read("src/app/layout.js")).toContain("Dardcor Code");
  });

  it("Phase 6 instrument mark assets exist and contain no text glyphs", () => {
    for (const rel of [
      "public/dardcor-code-mark.svg",
      "public/favicon.svg",
      "public/icons/icon-192.svg",
      "public/icons/icon-512.svg",
    ]) {
      const svg = read(rel);
      expect(svg, `${rel} uses Phase 6 signal token`).toContain("#FF4F00");
      expect(svg.match(/<text\b/), `${rel} must not embed a text glyph`).toBeNull();
    }
  });

  it("no user-facing source references the old 9router.png wordmark path", () => {
    const landing = read("src/app/landing/page.js");
    expect(landing).not.toMatch(/images\/9router/);
  });
});

describe("Phase 8 regression fixes", () => {
  it("jcode route detection has no stray brace: loop closes once, return false reachable", () => {
    const route = read("src/app/api/cli-tools/jcode-settings/route.js");
    const fn = route.slice(route.indexOf("const has9RouterConfig"), route.indexOf("const writeConfig"));
    // The for-loop body must close exactly once before `return false;` — no extra `}`.
    expect(fn).toMatch(/for \(const \[name, provider\] of Object\.entries\(providers\)\) \{\n    if \(provider\.base_url[^\n]*\) \{\n      return true;\n    \}\n  \}\n\n  return false;\n\};/);
  });

  it("OpenCodeToolCard legacy fallback is fully optional-chained (no null-deref)", () => {
    const src = read("src/app/(dashboard)/dashboard/cli-tools/components/OpenCodeToolCard.js");
    expect(src).toContain('status.config.provider["dardcor-code"]?.options?.baseURL || status.config.provider["9router"]?.options?.baseURL');
    expect(src).not.toContain('provider["9router"].options.baseURL');
  });

  it("token-saver UI and locale catalogs carry no inherited percentage claim", () => {
    const ui = read("src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js");
    expect(ui).toContain("Terse-style system prompt for shorter technical responses");
    expect(ui).not.toMatch(/65%|87%/);

    const files = fs.readdirSync(LITERALS_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const parsed = JSON.parse(read(`public/i18n/literals/${f}`));
      for (const [k, v] of Object.entries(parsed)) {
        expect(k.match(/65%|87%/), `${f}: key ${k}`).toBeNull();
        expect(v.match(/65%|87%/), `${f}: value of ${k}`).toBeNull();
      }
      if (parsed["Terse-style system prompt for shorter technical responses"]) {
        expect(parsed["Terse-style system prompt for shorter technical responses"], `${f}: translated value`).toBeTypeOf("string");
      }
    }
    // The five catalogs that carried the claim now carry the neutral sentence.
    for (const f of ["th.json", "zh-CN.json", "fa.json", "pt-BR.json", "km.json"]) {
      const parsed = JSON.parse(read(`public/i18n/literals/${f}`));
      expect(parsed["Terse-style system prompt for shorter technical responses"], `${f} missing neutral sentence`).toBeTypeOf("string");
    }
  });
});
