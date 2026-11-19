#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TERMS = [
  { name: "9router", re: /9router/gi },
  { name: "9r_", re: /9r_/gi },
  { name: "X-9Router", re: /x-9router/gi },
  { name: "ninerouter", re: /ninerouter/gi },
  { name: "20127", re: /20127/g },
  { name: "20128", re: /20128/g },
  { name: "20129", re: /20129/g },
  { name: ".9router", re: /\.9router/gi },
  { name: "9router.com", re: /9router\.com/gi },
];

export const PROVENANCE_ALLOWLIST = [
  "LICENSE",
  "cli/LICENSE",
  "docs/UPSTREAM.md",
  "docs/REBRAND.md",
  "docs/AUDIT.md",
  "docs/PHASE1-BASELINE-TRIAGE.md",
  "docs/CHANGELOG.md",
  "CHANGELOG.md",
  "DARDCOR CODE_CLONE_PLAYBOOK.md",
  "docs/superpowers/**",
  "scripts/check-branding.mjs",
  "DARDCOR CODE_AGENT_PROMPT_V2.md",
  "tests/unit/branding-gate.test.js",
  "tests/unit/rebrand-phase8.test.js",
];

export const COMPAT_ALIASES = {
  "open-sse/config/runtimeConfig.js": ["X-9Router", "9router"],
  "open-sse/handlers/chatCore.js": ["X-9Router", "9router"],
  "open-sse/config/appConstants.js": ["9router"],
  "open-sse/shared/clineAuth.js": ["9router"],
  "open-sse/executors/zed.js": ["9router"],
  "cli/cli.js": [".9router"],
  "cli/scripts/build-cli.js": ["DARDCORROUTER", "9router"],
  "cli/scripts/buildMitm.js": ["DARDCORROUTER"],
  "cli/src/cli/tray/autostart.js": ["9router", ".9router"],
  "cli/hooks/postinstall.js": [".9router"],
  "cli/hooks/sqliteRuntime.js": ["9router", ".9router"],
  "cli/src/cli/commands/xaiVideo.js": ["9router", "X-9Router", "DARDCORROUTER", "20128"],
  "cli/src/cli/menus/cliTools.js": ["9router"],
  "src/dashboardGuard.js": ["9router", "9r_"],
  "src/shared/utils/machineId.js": ["9r_"],
  "src/lib/auth/loginLimiter.js": ["9r_"],
  "src/app/api/settings/database/route.js": ["9r_"],
  "src/app/api/v1/models/route.js": ["9router", "9r_"],
  "custom-server.js": ["9r_"],
  "next.config.mjs": ["DARDCORROUTER"],
  "cli/src/cli/api/client.js": ["9router"],
  "src/lib/appUpdater.js": ["9router", ".9router"],
  "src/lib/updater/updater.js": ["9router", ".9router"],
  "src/lib/grokBuildConfig.js": ["9router"],
  "src/app/api/cli-tools/grok-build-settings/route.js": ["9router"],
  "src/app/api/cli-tools/opencode-settings/route.js": ["9router"],
  "src/app/api/cli-tools/openclaw-settings/route.js": ["9router"],
  "src/app/api/cli-tools/codex-settings/route.js": ["9router"],
  "src/app/api/cli-tools/jcode-settings/route.js": ["9router", "20128"],
  "src/app/api/cli-tools/kilo-settings/route.js": ["9router"],
  "src/app/api/cli-tools/cline-settings/route.js": ["9router"],
  "src/mitm/cert/install.js": ["9router"],
  "src/app/api/cli-tools/claude-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/cowork-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/hermes-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/droid-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/deepseek-tui-settings/route.js": ["9router", "9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/EndpointPresetControl.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/DroidToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/DeepSeekTuiToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/ClineToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/HermesToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/CoworkToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/GrokBuildToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/KiloToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/OpenCodeToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/OpenClawToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/JcodeToolCard.js": ["9router"],
  "scripts/upstream-diff.mjs": ["9router", "9r_", "DARDCORROUTER", "X-9Router", "20127", "20128", "20129", "9router.com"],
  "cli/src/cli/commands/migrate.js": ["9router", "X-9Router", "20128", ".9router", "9router.com"],
  "tests/unit/cli-migrate-from-9router.test.js": ["9router", "20128", "9router.com"],
  "tests/unit/fixtures/legacy-9router-export.json": ["9router", "20128", "9router.com"],
  "tests/unit/grok-build-config.test.js": ["9router", "20128"],
  "tests/translator/real/thinking.real.test.js": [".9router", "9router"],
  "tests/translator/real/all-formats.real.test.js": [".9router", "9router"],
  "tests/translator/real/vision-capability-survey.real.test.js": [".9router", "9router"],
  "tests/translator/real/file-base64-survey.real.test.js": [".9router", "9router"],
  "tests/translator/real/smoke-providers.real.test.js": [".9router", "9router"],
  "tests/unit/antigravity-cache.test.js": [".9router", "9router"],
  "tests/translator/AGENTS.md": [".9router", "9router"],
  "tests/translator/__snapshots__/golden-url-header.test.js.snap": ["9router"],
  "tests/unit/kimi-usage.test.js": ["9router"],
  "tests/unit/cursor-agent-proto.test.js": ["9router"],
};

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "graphify-out",
  ".remember",
  ".omo",
  ".opencode",
  ".git",
]);
const EXCLUDED_FILES = new Set(["package-lock.json"]);
const EXCLUDED_EXTENSIONS = new Set([
  ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif", ".bmp",
]);

function isProvenance(relPath) {
  return PROVENANCE_ALLOWLIST.some((p) =>
    p.endsWith("/**") ? relPath.startsWith(p.slice(0, -2)) : relPath === p,
  );
}

export function* walkBranding(root) {
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    let entries;
    try {
      entries = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (EXCLUDED_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith(".next")) continue;
        if (childRel === "cli/app" || childRel.startsWith("cli/app/")) continue;
        stack.push(childRel);
      } else if (ent.isFile()) {
        if (EXCLUDED_FILES.has(ent.name)) continue;
        if (EXCLUDED_EXTENSIONS.has(extname(ent.name).toLowerCase())) continue;
        yield childRel;
      }
    }
  }
}

function trimSnippet(line, max = 120) {
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const LINE_PATTERN_COMPAT = {
  "README.md": [/dardcor-code migrate --from-9router/],
  "cli/README.md": [/dardcor-code migrate --from-9router/],
};

function lineIsPatternCompat(relPath, line) {
  const patterns = LINE_PATTERN_COMPAT[relPath];
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((re) => re.test(line));
}

export function scanText(text, relPath) {
  const allowedTerms = COMPAT_ALIASES[relPath];
  const hits = [];
  let lineNo = 0;
  for (const line of text.split("\n")) {
    lineNo++;
    if (!line) continue;
    const spans = [];
    if (allowedTerms) {
      for (const name of allowedTerms) {
        const term = TERMS.find((t) => t.name === name);
        if (!term) continue;
        for (const m of line.matchAll(term.re)) {
          spans.push([m.index, m.index + m[0].length]);
        }
      }
    }
    const patternCompat = lineIsPatternCompat(relPath, line);
    for (const term of TERMS) {
      for (const m of line.matchAll(term.re)) {
        const start = m.index;
        const end = start + m[0].length;
        const compat = patternCompat || spans.some(([s, e]) => start < e && s < end);
        hits.push({ line: lineNo, term: term.name, start, end, snippet: trimSnippet(line), compat });
      }
    }
  }
  return hits;
}

function compareHits(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.term !== b.term) return a.term < b.term ? -1 : 1;
  return 0;
}

export function scanBranding({ root }) {
  if (!root) throw new Error("scanBranding: root is required");
  const st = statSync(root);
  if (!st.isDirectory()) throw new Error(`scanBranding: not a directory: ${root}`);

  const forbidden = [];
  const allowlisted = [];
  const compat = [];
  let scannedFiles = 0;

  for (const relPath of walkBranding(root)) {
    let buf;
    try {
      buf = readFileSync(join(root, relPath));
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    const text = buf.toString("utf8");
    const hits = scanText(text, relPath);
    if (hits.length === 0) continue;
    scannedFiles++;
    for (const h of hits) {
      const record = { file: relPath, line: h.line, term: h.term, snippet: h.snippet };
      if (isProvenance(relPath)) allowlisted.push(record);
      else if (h.compat) compat.push(record);
      else forbidden.push(record);
    }
  }

  forbidden.sort(compareHits);
  allowlisted.sort(compareHits);
  compat.sort(compareHits);

  const counts = {
    forbidden: forbidden.length,
    allowlisted: allowlisted.length,
    compat: compat.length,
    forbiddenFiles: new Set(forbidden.map((h) => h.file)).size,
    allowlistedFiles: new Set(allowlisted.map((h) => h.file)).size,
    compatFiles: new Set(compat.map((h) => h.file)).size,
  };

  return { ok: counts.forbidden === 0, forbidden, allowlisted, compat, counts, scannedFiles };
}

function groupByFile(hits) {
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  return byFile;
}

function printBucket(label, hits, includeLines) {
  const byFile = groupByFile(hits);
  if (byFile.size === 0) return;
  console.log(`\n${label}`);
  for (const [file, fileHits] of byFile) {
    const byTerm = new Map();
    for (const h of fileHits) byTerm.set(h.term, (byTerm.get(h.term) || 0) + 1);
    const breakdown = [...byTerm].map(([t, n]) => `${t}×${n}`).join(", ");
    console.log(`  ${file} (${fileHits.length} hit${fileHits.length === 1 ? "" : "s"}: ${breakdown})`);
    if (includeLines) {
      for (const h of fileHits) {
        console.log(`    ${h.line}:${h.term}  ${h.snippet}`);
      }
    }
  }
}

function main() {
  const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  let result;
  try {
    result = scanBranding({ root });
  } catch (err) {
    console.error(`check-branding: ${err.message}`);
    process.exit(2);
  }

  console.log(`Dardcor Code branding gate (docs/REBRAND.md) — ${root}`);
  console.log(`Scanned ${result.scannedFiles} files with hits.`);

  printBucket("FORBIDDEN (gate fails on any):", result.forbidden, true);
  printBucket("ALLOWED — permanent provenance (REBRAND.md §3):", result.allowlisted, false);
  printBucket("ALLOWED — read-compat aliases (REBRAND.md §4–§5):", result.compat, false);

  const { counts } = result;
  console.log(
    `\nCounts: ${counts.forbidden} forbidden in ${counts.forbiddenFiles} file(s) · ` +
      `${counts.allowlisted} provenance in ${counts.allowlistedFiles} · ` +
      `${counts.compat} compat in ${counts.compatFiles}.`,
  );

  if (result.ok) {
    console.log("PASS: no forbidden branding hits. See docs/REBRAND.md §7.");
    process.exit(0);
  }
  console.error("FAIL: forbidden branding hits remain. Rebrand per docs/REBRAND.md §2/§6; expected survivors are §3–§5.");
  process.exit(1);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
