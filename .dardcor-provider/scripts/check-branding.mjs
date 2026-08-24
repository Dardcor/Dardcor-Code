#!/usr/bin/env node
/**
 * scripts/check-branding.mjs — Dardcor Code Phase 8 branding gate (docs/REBRAND.md).
 *
 * Scans the tree for pre-rebrand identifiers, excluding build artifacts and
 * binary assets exactly like the §1 inventory command. Hits land in three
 * buckets:
 *
 *   - forbidden:  old terms in rebrand-target files. Any hit fails the gate.
 *   - allowlisted: hits inside the permanent provenance files (§3). Whole-file
 *                  skip, mirroring "make check-branding must skip them".
 *   - compat:     hits that overlap a read-compat alias of the same file
 *                  (§4 pinned upstream contract, §5 temporary read-compat).
 *                  Scoped per file + term: an old term is tolerated in a compat
 *                  file only where an allowed term's match overlaps it — never
 *                  globally because one file needs one occurrence.
 *
 * Node stdlib only. Deterministic: sorted walk, no git, no network, no
 * external processes. Reusable: `import { scanBranding } from "./check-branding.mjs"`.
 *
 * Usage: node scripts/check-branding.mjs [root]   (default: process.cwd())
 * Exit:  0 = no forbidden hits, 1 = forbidden hits remain, 2 = usage/root error
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Scan terms, mirroring docs/REBRAND.md §1. Case-insensitive like `rg -i`; alternatives overlap by design. */
export const TERMS = [
  { name: "9router", re: /9router/gi },
  { name: "9r_", re: /9r_/gi },
  { name: "X-9Router", re: /x-9router/gi },
  { name: "NINEROUTER", re: /ninerouter/gi },
  { name: "20127", re: /20127/g },
  { name: "20128", re: /20128/g },
  { name: "20129", re: /20129/g },
  { name: "decolua", re: /decolua/gi },
  { name: ".9router", re: /\.9router/gi },
  { name: "9router.com", re: /9router\.com/gi },
];

/**
 * Permanent provenance allowlist (docs/REBRAND.md §3). Exact relative paths;
 * the `docs/superpowers/**` subtree is matched by prefix. These files are
 * skipped wholesale: any hit they contain is reported as allowlisted, never
 * forbidden. Do not add rebrand targets here — provenance means history that
 * must keep its old names, not files that were merely not rebranded yet.
 */
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
  "docs/superpowers/**", // subtree, prefix-matched
  "scripts/check-branding.mjs", // the gate itself: defines every scan term it searches for
  "DARDCOR CODE_AGENT_PROMPT_V2.md", // frozen planning/provenance: names the upstream it studied
  // Gate self-tests: they necessarily embed every scan term as test fixtures.
  "tests/unit/branding-gate.test.js",
  "tests/unit/rebrand-phase8.test.js",
];

/**
 * Per-file read-compat aliases (docs/REBRAND.md §4–§5). Key: relative path.
 * Value: terms that file is allowed to keep. A hit is compat iff its span
 * overlaps a match of one of those terms on the same line; any other old term
 * in the same file is still forbidden. The doc's line references are kept in
 * comments (line numbers shift as rebrand edits land, so the gate matches
 * terms, not line numbers).
 */
export const COMPAT_ALIASES = {
  // §5: TOKEN_SAVER_HEADER — new writes x-dardcor-token-saver, legacy x-9router-token-saver kept read-only.
  "open-sse/config/runtimeConfig.js": ["X-9Router", "9router"],
  // §5: chatCore reads both headers (new wins).
  "open-sse/handlers/chatCore.js": ["X-9Router", "9router"],
  // §4 pinned upstream contract (line 224): outbound "X-Msh-Platform": "9router" required by the msh upstream.
  "open-sse/config/appConstants.js": ["9router"],
  // §4: external provider contracts — Cline's upstream expects X-CLIENT-TYPE "9router"
  // and the golden-url-header snapshot pins the clineAuth User-Agent. Do not rename.
  "open-sse/shared/clineAuth.js": ["9router"],
  // §4: external provider contract — zed's upstream sees "9router/zed" UA. Do not rename.
  "open-sse/executors/zed.js": ["9router"],
  // §5: legacy config dir reads — ~/.9router, ~/.9router/db.json (lines 83, 192, 858),
  // legacy process-name matches (kill stale 9router installs), legacy Win AppData path.
  "cli/cli.js": ["9router", ".9router"],
  // §5: legacy DARDCOR_CLI_APP_DIR read fallback + build log strings.
  "cli/scripts/build-cli.js": ["NINEROUTER", "9router"],
  "cli/scripts/buildMitm.js": ["NINEROUTER"],
  // §5: macOS launchd label / Windows registry key com.9router.autostart (line 7).
  "cli/src/cli/tray/autostart.js": ["9router", ".9router"],
  // §5: legacy runtime-dep install location ~/.9router/runtime (read to locate).
  "cli/hooks/postinstall.js": [".9router"],
  // §5: legacy runtime-dep install location ~/.9router/runtime (read to locate).
  "cli/hooks/sqliteRuntime.js": ["9router", ".9router"],
  // §5: CLI xai video — legacy x-9router-connection-id response header + NINE_ROUTER_API_KEY env read.
  "cli/src/cli/commands/xaiVideo.js": ["9router", "X-9Router", "NINEROUTER", "20128"],
  // §5: CLI TUI reads legacy "9router" OpenClaw provider slot / model prefix.
  "cli/src/cli/menus/cliTools.js": ["9router"],
  // §5: server accepts legacy CLI-token header/salt + x-9r-* real-ip/via-proxy headers.
  "src/dashboardGuard.js": ["9router", "9r_"],
  "src/shared/utils/machineId.js": ["9r_"],
  "src/lib/auth/loginLimiter.js": ["9r_"],
  "src/app/api/settings/database/route.js": ["9r_"],
  "src/app/api/v1/models/route.js": ["9router", "9r_"],
  "custom-server.js": ["9r_"],
  // §5: legacy NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE read fallback (primary is DARDCOR_).
  "next.config.mjs": ["NINEROUTER"],
  // §5: JSDoc references the API's has9Router response field (kept as-is).
  "cli/src/cli/api/client.js": ["9router"],
  // §5: appUpdater/updater keep matching legacy 9router process names + ~/.9router read fallback.
  "src/lib/appUpdater.js": ["9router", ".9router"],
  "src/lib/updater/updater.js": ["9router", ".9router"],
  // §5: client config writers emit dardcor-code; legacy 9router slots/markers stay readable.
  "src/lib/grokBuildConfig.js": ["9router"],
  "src/app/api/cli-tools/grok-build-settings/route.js": ["9router"],
  "src/app/api/cli-tools/opencode-settings/route.js": ["9router"],
  "src/app/api/cli-tools/openclaw-settings/route.js": ["9router"],
  "src/app/api/cli-tools/codex-settings/route.js": ["9router"],
  "src/app/api/cli-tools/jcode-settings/route.js": ["9router", "20128"],
  "src/app/api/cli-tools/kilo-settings/route.js": ["9router"],
  "src/app/api/cli-tools/cline-settings/route.js": ["9router"],
  // §5: legacy CN deleted on install so a previous 9Router CA doesn't linger in stores.
  "src/mitm/cert/install.js": ["9router"],
  // §5: API response field has9Router is the client contract (kept as-is across routes).
  "src/app/api/cli-tools/claude-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/cowork-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/hermes-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/copilot-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/droid-settings/route.js": ["9router", "9router"],
  "src/app/api/cli-tools/deepseek-tui-settings/route.js": ["9router", "9router"],
  // §5: localStorage preset keys — new writes dardcor-code, legacy 9router read.
  "src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/EndpointPresetControl.js": ["9router"],
  // §5 (Phase 8 UI batch): ToolCard components keep the has9Router contract field
  // and legacy config-slot reads (custom:9Router ids, "9router" provider keys,
  // "9router/" model prefixes); new writes emit dardcor-code forms.
  "src/app/(dashboard)/dashboard/cli-tools/components/DroidToolCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.js": ["9router"],
  "src/app/(dashboard)/dashboard/cli-tools/components/CopilotToolCard.js": ["9router"],
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
  // §5: upstream-diff reverse-map legitimately names every old identifier it displays.
  "scripts/upstream-diff.mjs": ["9router", "9r_", "NINEROUTER", "X-9Router", "20127", "20128", "20129", "9router.com"],
  // §5 migration implementation: `dardcor-code migrate --from-9router` reads the
  // legacy install's token scheme, data dir, ports, headers and slot identifiers.
  "cli/src/cli/commands/migrate.js": ["9router", "X-9Router", "20128", ".9router", "9router.com"],
  // §5 migration test + fixture: synthetic legacy export with legacy URLs,
  // headers, slots and key prefixes.
  "tests/unit/cli-migrate-from-9router.test.js": ["9router", "20128", "9router.com"],
  "tests/unit/fixtures/legacy-9router-export.json": ["9router", "20128", "9router.com"],
  // §5 grok legacy-reader test: asserts parse/rewrite of old slots & markers.
  "tests/unit/grok-build-config.test.js": ["9router", "20128"],
  // §5 real tests: legacy ~/.9router db path read fallback (primary ~/.dardcor-code).
  "tests/translator/real/thinking.real.test.js": [".9router", "9router"],
  "tests/translator/real/all-formats.real.test.js": [".9router", "9router"],
  "tests/translator/real/vision-capability-survey.real.test.js": [".9router", "9router"],
  "tests/translator/real/file-base64-survey.real.test.js": [".9router", "9router"],
  "tests/translator/real/smoke-providers.real.test.js": [".9router", "9router"],
  // §5 antigravity-cache live test: legacy db.json read fallback.
  "tests/unit/antigravity-cache.test.js": [".9router", "9router"],
  // §5 translator test conventions doc: documents the legacy db fallback path.
  "tests/translator/AGENTS.md": [".9router", "9router"],
  // §4 pinned upstream-contract snapshots/tests: Cline UA + X-CLIENT-TYPE,
  // Kimi/kimchi X-Msh-Platform, Cursor MCP client marker — all upstream pins.
  "tests/translator/__snapshots__/golden-url-header.test.js.snap": ["9router"],
  "tests/unit/kimi-usage.test.js": ["9router"],
  "tests/unit/cursor-agent-proto.test.js": ["9router"],
};

/** Directory basenames excluded at any depth (docs/REBRAND.md §1). */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "graphify-out",
  ".remember",
  ".omo",
  ".opencode",
  ".git", // rg never searches .git; keep the walk deterministic without git
]);
/** File basenames excluded at any depth. */
const EXCLUDED_FILES = new Set(["package-lock.json"]);
/** Binary / map asset extensions (docs/REBRAND.md §1). */
const EXCLUDED_EXTENSIONS = new Set([
  ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif", ".bmp",
]);

function isProvenance(relPath) {
  return PROVENANCE_ALLOWLIST.some((p) =>
    p.endsWith("/**") ? relPath.startsWith(p.slice(0, -2)) : relPath === p,
  );
}

/**
 * Deterministic depth-first walk of `root`. Yields root-relative POSIX paths.
 * Skips symlinks (matches rg's no-follow default), unreadable dirs, and the
 * §1 exclusions: node_modules, .next* (any depth), cli/app (root-anchored),
 * graphify-out, .remember, .omo, .opencode, .git, package-lock.json, *.map,
 * and binary image extensions.
 */
export function* walkBranding(root) {
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    let entries;
    try {
      entries = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      continue; // unreadable dir: skip, same as rg's silent behavior
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
      // symlinks and other entry kinds: skipped (rg -L not used)
    }
  }
}

function trimSnippet(line, max = 120) {
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Per-file exact line-pattern compat (docs/REBRAND.md §5, README case).
 * Unlike COMPAT_ALIASES (term-span overlap), these match a whole line against
 * a regex: a hit is compat only when its entire line matches one of the
 * patterns for that file. This allows the READMEs to keep exactly the
 * `dardcor-code migrate --from-9router` flag literal without letting any other
 * old-brand line through. Patterns are anchored so future brand mentions on
 * the same line still fail.
 */
export const LINE_PATTERN_COMPAT = {
  "README.md": [/dardcor-code migrate --from-9router/],
  "cli/README.md": [/dardcor-code migrate --from-9router/],
};

function lineIsPatternCompat(relPath, line) {
  const patterns = LINE_PATTERN_COMPAT[relPath];
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((re) => re.test(line));
}

/**
 * Scan one file's text. Returns hits as
 * `{ line, term, start, end, snippet, compat }` — `compat` true when the hit
 * span overlaps a match of a COMPAT_ALIASES term on the same line, or the
 * entire line matches a LINE_PATTERN_COMPAT pattern for that file.
 */
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
  return 0; // ties keep deterministic input order (stable sort; walk + matchAll are ordered)
}

/**
 * Scan a tree for pre-rebrand identifiers.
 *
 * @param {{ root: string }} opts root directory to scan
 * @returns {{
 *   ok: boolean,
 *   forbidden: Array<{file, line, term, snippet}>,
 *   allowlisted: Array<{file, line, term, snippet}>,
 *   compat: Array<{file, line, term, snippet}>,
 *   counts: { forbidden, allowlisted, compat, forbiddenFiles, allowlistedFiles, compatFiles },
 *   scannedFiles: number,
 * }}
 */
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
      continue; // raced file removal / unreadable: skip
    }
    if (buf.includes(0)) continue; // binary, matches rg's default skip
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
