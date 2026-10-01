#!/usr/bin/env node
// Phase 1 Wave 0.2 — baseline characterization gate.
//
// Usage (from repo root):
//   node scripts/test-baseline.mjs              run the suite and compare against the committed
//                                               characterization; exit 0 ONLY when every current
//                                               failure matches (same id AND same SHA-256 signature)
//                                               and no failure is unclassified.
//   node scripts/test-baseline.mjs --record     deliberate maintenance flag: rewrite the
//                                               characterization from the current run, keeping the
//                                               category of each known failure id and REFUSING
//                                               (no write, exit 1) any current failure whose id has
//                                               no category in the existing file. Removed failures
//                                               are dropped here — never in normal mode.
//   node scripts/test-baseline.mjs --json F     compare against a pre-captured vitest JSON run
//                                               (no suite spawn; used by tests/scratch work).
//
// Normal execution NEVER writes the baseline. pass->fail (new), brand-new, removed and
// signature-changed failures all produce explicit deltas and a non-zero exit.
//
// The gate never blesses unexplained failures: every entry in the characterization must carry
// a category that exists in the `categories` map and is not "unclassified".
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TESTS_DIR = path.join(ROOT, "tests");
const VITEST_BIN = path.join(TESTS_DIR, "node_modules", "vitest", "vitest.mjs");
const CHAR_PATH = process.env.TEST_BASELINE_CHAR_PATH
  ? path.resolve(process.env.TEST_BASELINE_CHAR_PATH)
  : path.join(TESTS_DIR, "__baseline__", "phase1-characterization.json");

export function normalizeTestPath(fileName) {
  let p = String(fileName || "").replaceAll("\\", "/");
  const marker = "/tests/";
  const idx = p.lastIndexOf(marker);
  return idx >= 0 ? p.slice(idx + 1) : p;
}

// Normalization for signature input: strips environment-specific noise (repo root,
// node_modules install paths, file:// scheme, Windows separators, whitespace runs)
// and drops every stack frame after the first — V8 async-stack capture beyond the
// assertion site is non-deterministic (observed: processTicksAndRejections vs the
// vitest runner frame flip run-to-run), while the first frame (the assertion site
// in the test file) is stable. ponytail: root-relative stable, not cross-machine —
// a different checkout path still shifts frame lines; that surfaces as "changed".
export function normalizeFailureText(text) {
  const lines = String(text || "").split("\n");
  const kept = [];
  let sawFrame = false;
  for (const line of lines) {
    if (/^\s*at /.test(line)) {
      if (sawFrame) break;
      sawFrame = true;
    }
    kept.push(line);
  }
  let t = kept.join("\n");
  t = t.replaceAll("\\", "/");
  t = t.replaceAll("file://", "");
  t = t.replaceAll(ROOT, "<ROOT>");
  t = t.replaceAll(/[^\s"'<>()]+node_modules[^\s"'<>()]*/g, "<NM>");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// Flaky entries (e.g. db-concurrent lost-update counts) vary numerically run to run.
// Their class signature strips digits from the first line so "expected 13 to be 50"
// and "expected 12 to be 50" compare equal, while a real change of shape (a TypeError,
// a different assertion) still flips the signature.
export function flakyClassSignature(text) {
  const firstLine = String(text || "").split("\n")[0];
  return sha256(normalizeFailureText(firstLine.replace(/\d+/g, "N")));
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function failureSignature(failureMessages, fallbackMessage = "") {
  const raw = Array.isArray(failureMessages) && failureMessages.length
    ? failureMessages.join("\n")
    : String(fallbackMessage || "");
  return sha256(normalizeFailureText(raw));
}

// Flatten a vitest JSON run into Map<stableId, {signature, kind, file, firstLine}>.
// Assertion failures use `path :: fullName`; file-level collection/load failures
// (status "failed" with no failed assertions) use `path :: [collection]`.
export function buildFailureSet(run) {
  const failures = new Map();
  for (const tr of run.testResults || []) {
    const file = normalizeTestPath(tr.name);
    const failed = (tr.assertionResults || []).filter((a) => a.status === "failed");
    if (failed.length) {
      for (const a of failed) {
        const id = `${file} :: ${a.fullName}`;
        const messages = a.failureMessages || [];
        failures.set(id, {
          signature: failureSignature(messages),
          classSignature: flakyClassSignature(messages[0] || ""),
          kind: "assertion",
          file,
          firstLine: (messages[0] || "").split("\n")[0].slice(0, 160),
        });
      }
    } else if (tr.status === "failed") {
      const message = tr.message || "";
      failures.set(`${file} :: [collection]`, {
        signature: failureSignature(null, message),
        classSignature: flakyClassSignature(message),
        kind: "collection",
        file,
        firstLine: message.split("\n")[0].slice(0, 160),
      });
    }
  }
  return failures;
}

export function compareFailures(actual, baseline) {
  const matched = [];
  const changed = [];
  const newFailures = [];
  const removed = [];
  for (const [id, b] of baseline) {
    const a = actual.get(id);
    if (!a) removed.push(id);
    else {
      const aSig = b.flaky ? a.classSignature : a.signature;
      const bSig = b.flaky ? b.classSignature : b.signature;
      if (aSig !== bSig) changed.push(id);
      else matched.push(id);
    }
  }
  for (const id of actual.keys()) {
    if (!baseline.has(id)) newFailures.push(id);
  }
  return { matched, changed, newFailures, removed };
}

// Returns a list of integrity problems (empty = valid).
export function verifyCharacterization(char) {
  const problems = [];
  if (!char || typeof char !== "object") return ["characterization is not an object"];
  if (!char.categories || typeof char.categories !== "object") problems.push("missing `categories` map");
  if (!Array.isArray(char.failures)) problems.push("missing `failures` array");
  if (problems.length) return problems;
  const ids = new Set();
  for (const entry of char.failures) {
    if (typeof entry.id !== "string" || !entry.id) problems.push(`failure entry missing id: ${JSON.stringify(entry)}`);
    else if (ids.has(entry.id)) problems.push(`duplicate failure id: ${entry.id}`);
    ids.add(entry.id);
    const cat = entry.category;
    if (typeof cat !== "string" || !cat.trim()) problems.push(`entry has no category: ${entry.id}`);
    else if (cat === "unclassified") problems.push(`entry is unclassified: ${entry.id}`);
    else if (!char.categories[cat]) problems.push(`entry references unknown category "${cat}": ${entry.id}`);
    if (typeof entry.signature !== "string" || !/^[0-9a-f]{64}$/.test(entry.signature || "")) {
      problems.push(`entry has invalid signature: ${entry.id}`);
    }
    if (entry.flaky && (typeof entry.classSignature !== "string" || !/^[0-9a-f]{64}$/.test(entry.classSignature || ""))) {
      problems.push(`flaky entry has invalid class signature: ${entry.id}`);
    }
  }
  return problems;
}

// verdict.pass = true only when failures match exactly AND the characterization is fully
// classified. `report` is a human-readable delta summary.
export function evaluateGate(actual, char) {
  const problems = verifyCharacterization(char);
  if (problems.length) {
    return { pass: false, report: `CHARACTERIZATION INVALID:\n${problems.map((p) => `  - ${p}`).join("\n")}` };
  }
  const baseline = new Map(char.failures.map((f) => [f.id, f]));
  const d = compareFailures(actual, baseline);
  const lines = [];
  let ok = true;
  if (d.newFailures.length) {
    ok = false;
    lines.push(`NEW FAILURES (pass->fail or brand new): ${d.newFailures.length}`);
    d.newFailures.forEach((id) => lines.push(`  + ${id}`));
  }
  if (d.changed.length) {
    ok = false;
    lines.push(`CHANGED FAILURES (same id, different signature): ${d.changed.length}`);
    d.changed.forEach((id) => lines.push(`  ~ ${id}`));
  }
  if (d.removed.length) {
    ok = false; // improvements must require a deliberate baseline update, never silent rewriting
    lines.push(`REMOVED FAILURES (improvements — baseline update required via --record after review): ${d.removed.length}`);
    d.removed.forEach((id) => lines.push(`  - ${id}`));
  }
  if (ok) lines.push(`All ${d.matched.length} characterized failures match exactly (same id + signature).`);
  return { pass: ok, report: lines.join("\n") };
}

function runVitest() {
  const tmpOut = path.join(mkdtempSync(path.join(tmpdir(), "w02-gate-")), "run.json");
  const res = spawnSync(process.execPath, [VITEST_BIN, "run", "--reporter=json", `--outputFile=${tmpOut}`], {
    cwd: TESTS_DIR,
    encoding: "utf8",
    timeout: 900_000,
  });
  if (res.error) {
    console.error(`Failed to run vitest: ${res.error.message}`);
    process.exit(2);
  }
  if (!existsSync(tmpOut)) {
    console.error(`Vitest exited with code ${res.status} but produced no JSON output.\n${res.stdout.slice(-2000)}`);
    process.exit(2);
  }
  const run = JSON.parse(readFileSync(tmpOut, "utf8"));
  rmSync(path.dirname(tmpOut), { recursive: true, force: true });
  return run;
}

export function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data, "utf8");
  try {
    renameSync(tmp, file);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    // Windows cannot replace an existing file with renameSync.
    rmSync(file);
    renameSync(tmp, file);
  }
}

function loadCharacterization() {
  if (!existsSync(CHAR_PATH)) {
    console.error(`Missing characterization file: ${CHAR_PATH}`);
    console.error("It must be created manually with evidence-triaged categories (never by the gate).");
    process.exit(2);
  }
  return JSON.parse(readFileSync(CHAR_PATH, "utf8"));
}

function summarizeRun(run) {
  const failedFiles = (run.testResults || []).filter((t) => t.status === "failed").length;
  const skipped = (run.testResults || []).reduce(
    (n, t) => n + (t.assertionResults || []).filter((a) => a.status === "skipped").length, 0);
  return {
    numTotalTests: run.numTotalTests ?? run.testResults.reduce((n, t) => n + (t.assertionResults || []).length, 0),
    numPassedTests: run.numPassedTests ?? 0,
    numFailedTests: run.numFailedTests ?? 0,
    numSkippedTests: skipped,
    numTotalFiles: (run.testResults || []).length,
    numFailedFiles: failedFiles,
  };
}

function main() {
  const args = process.argv.slice(2);
  const record = args.includes("--record");
  const help = args.includes("--help") || args.includes("-h");
  const jsonIdx = args.indexOf("--json");
  const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

  if (help) {
    console.log(`Usage: node scripts/test-baseline.mjs [--record] [--json <vitest-json>]
  (no flags)  run the suite (from tests/) and gate on the committed characterization
  --record    deliberate baseline rewrite; refuses unclassified entries; requires a category
              for every current failure id in the existing file (new ids are never auto-blessed)
  --json F    compare against a pre-captured vitest JSON instead of spawning the suite`);
    process.exit(0);
  }

  const run = jsonPath ? JSON.parse(readFileSync(jsonPath, "utf8")) : runVitest();
  const char = loadCharacterization();
  const actual = buildFailureSet(run);
  const meta = summarizeRun(run);

  if (record) {
    const baselineById = new Map(char.failures.map((f) => [f.id, f]));
    const unclassified = [];
    const entries = [];
    for (const [id, cur] of actual) {
      const prev = baselineById.get(id);
      if (!prev || !prev.category) { unclassified.push(id); continue; }
      entries.push({
        id,
        category: prev.category,
        kind: cur.kind,
        file: cur.file,
        firstLine: cur.firstLine,
        signature: prev.flaky ? prev.signature : cur.signature,
        ...(prev.flaky ? { flaky: true, classSignature: prev.classSignature } : {}),
      });
    }
    if (unclassified.length) {
      console.error(`RECORD REFUSED: ${unclassified.length} current failure(s) have no category in the existing characterization.`);
      unclassified.forEach((id) => console.error(`  ? ${id}`));
      console.error("Add a categorized entry manually (with evidence) or fix the failure. Nothing was written.");
      process.exit(1);
    }
    const removed = [...baselineById.keys()].filter((id) => !actual.has(id));
    entries.sort((a, b) => a.id.localeCompare(b.id));
    const next = {
      schemaVersion: 1,
      generatedBy: "scripts/test-baseline.mjs --record",
      generatedAt: new Date().toISOString(),
      meta,
      catalogReconciliation: char.catalogReconciliation || {},
      categories: char.categories,
      failures: entries,
    };
    writeAtomic(CHAR_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`Baseline rewritten: ${entries.length} failures recorded (${removed.length} removed, ${unclassified.length} refused).`);
    if (removed.length) {
      console.log("Removed (no longer failing):");
      removed.forEach((id) => console.log(`  - ${id}`));
    }
    process.exit(0);
  }

  const verdict = evaluateGate(actual, char);
  console.log(`Run: ${meta.numTotalFiles} files (${meta.numFailedFiles} failed) · ${meta.numTotalTests} tests (${meta.numPassedTests} pass / ${meta.numFailedTests} fail / ${meta.numSkippedTests} skip)`);
  console.log(`Current failure entries: ${actual.size} (${[...actual.values()].filter((v) => v.kind === "collection").length} collection-level)`);
  console.log(verdict.report);
  if (!verdict.pass) {
    console.error("\nGATE FAILED — baseline update requires the deliberate --record flag after human review; the gate never rewrites automatically.");
    process.exit(1);
  }
  console.log(`\n✅ GATE PASS — ${actual.size} failure entries match the committed characterization exactly (no deltas, all classified).`);
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
