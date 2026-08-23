#!/usr/bin/env node
/**
 * bench/verify.mjs — Phase 9 regression verifier.
 *
 * Compares a freshly generated report (bench/report.js `miaw-bench-report/1`)
 * against a user-recorded baseline (`miaw-bench-baseline/1`, written only by
 * `bench/run.mjs --record-baseline` from an actual completed run) and fails
 * when any compared metric crosses its threshold. Null metrics are skipped,
 * never treated as 0.
 *
 * Default thresholds (documented in the --help output and CHANGELOG):
 *   hitRatePp      5    current hit rate must not fall more than 5 percentage
 *                       points below baseline (per cache layer with probes)
 *   p95Pct         0.20 current p95 latency must not exceed baseline × 1.20
 *   costPct        0.10 measured cost must not exceed baseline × 1.10
 *   tokenSavingsPp 10   current token-savings % must not fall more than 10
 *                       percentage points below baseline
 *
 * Exit codes: 0 = no regressions, 1 = at least one regression, 2 = usage/IO
 * error. Pure compare functions live at the top so unit tests can import them
 * without touching the CLI.
 */

import { readFileSync, existsSync } from "node:fs";
import { BASELINE_SCHEMA, REPORT_SCHEMA } from "./report.js";
import { round } from "./metrics.js";

export const DEFAULT_THRESHOLDS = Object.freeze({
  hitRatePp: 5,        // percentage points
  p95Pct: 0.2,         // relative
  costPct: 0.1,        // relative
  tokenSavingsPp: 10,  // percentage points
});

/**
 * Pure comparison of one run's metrics against its baseline entry.
 * @param {object} current - report run metrics (aggregateRun output shape)
 * @param {object} base - baseline run entry (extractBaseline shape)
 * @param {object} thresholds - override of DEFAULT_THRESHOLDS (partial ok)
 * @returns {{ runId: string, passed: boolean, checks: object[] }}
 */
export function compareRun(current, base, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const checks = [];

  // Hit rates (percentage points) — per layer that reports a rate.
  for (const layer of ["L0", "L1", "L2"]) {
    const cur = current?.layers?.[layer]?.hitRate ?? null;
    const baseVal = base?.layers?.[layer]?.hitRate ?? null;
    checks.push(checkPp(`layers.${layer}.hitRate`, cur, baseVal, t.hitRatePp, "lower-is-worse below threshold"));
  }

  // p95 latency (relative increase allowed).
  checks.push(checkRelative("latency.p95", current?.latency?.p95 ?? null, base?.latency?.p95 ?? null, t.p95Pct, "higher-is-worse above threshold"));

  // Measured cost (relative increase allowed).
  checks.push(checkRelative("costUsd", current?.costUsd ?? null, base?.costUsd ?? null, t.costPct, "higher-is-worse above threshold"));

  // Token savings (percentage points — savings falling is a regression).
  checks.push(checkPp("tokens.savingsPct", current?.tokens?.savingsPct ?? null, base?.tokens?.savingsPct ?? null, t.tokenSavingsPp, "lower-is-worse below threshold"));

  return {
    runId: current?.runId ?? "unknown",
    passed: checks.every((c) => c.skipped || c.pass),
    checks,
  };
}

/** Relative check: current must be <= base * (1 + tol). */
function checkRelative(name, cur, baseVal, tolerance, how) {
  if (cur === null || cur === undefined || baseVal === null || baseVal === undefined) {
    return skip(name, cur, baseVal, `null metric skipped (never compared as 0)`);
  }
  const limit = Number(baseVal) * (1 + tolerance);
  const pass = Number(cur) <= limit;
  return { metric: name, current: cur, baseline: baseVal, tolerance, pass, skipped: false, how, detail: `limit=${round(limit, 4)}, ${pass ? "within" : "exceeds"} tolerance` };
}

/** Percentage-point check: current must be >= base - tol. */
function checkPp(name, cur, baseVal, tolerance, how) {
  if (cur === null || cur === undefined || baseVal === null || baseVal === undefined) {
    return skip(name, cur, baseVal, `null metric skipped (never compared as 0)`);
  }
  const floor = Number(baseVal) - tolerance;
  const pass = Number(cur) >= floor;
  return { metric: name, current: cur, baseline: baseVal, tolerance, pass, skipped: false, how, detail: `floor=${round(floor, 4)}, ${pass ? "within" : "below"} threshold` };
}

function skip(name, cur, baseVal, detail) {
  return { metric: name, current: cur ?? null, baseline: baseVal ?? null, tolerance: null, pass: true, skipped: true, how: "skipped", detail };
}

/**
 * Verify a whole report against a baseline document.
 * @param {object} report - report object
 * @param {object} baseline - baseline object (extractBaseline shape)
 * @param {object} thresholds - partial overrides
 * @returns {{ passed: boolean, regressions: object[], skipped: object[], checks: object[] }}
 */
export function verifyReport({ report, baseline, thresholds = {} }) {
  if (!report || !baseline) throw new Error("verifyReport requires both a report and a baseline");
  if (report.schema !== REPORT_SCHEMA) {
    throw new Error(`verifyReport: report schema mismatch: ${report.schema} (expected ${REPORT_SCHEMA})`);
  }
  if (baseline.schema !== BASELINE_SCHEMA) {
    throw new Error(`verifyReport: baseline schema mismatch: ${baseline.schema} (expected ${BASELINE_SCHEMA})`);
  }
  const baselineRuns = baseline.runs || {};
  const results = [];
  const regressions = [];
  const skipped = [];

  for (const run of report.runs || []) {
    const base = baselineRuns[run.runId];
    if (!base) {
      skipped.push({ runId: run.runId, detail: "run missing from baseline (baseline must be re-recorded with --record-baseline)" });
      continue;
    }
    const res = compareRun(run, base, thresholds);
    results.push(res);
    for (const c of res.checks) {
      if (c.skipped) skipped.push({ runId: run.runId, metric: c.metric, detail: c.detail });
      else if (!c.pass) regressions.push({ runId: run.runId, metric: c.metric, current: c.current, baseline: c.baseline, detail: c.detail });
    }
  }

  return {
    passed: regressions.length === 0,
    regressions,
    skipped,
    checks: results,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseThresholds(args) {
  const out = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq === -1) throw new Error(`--threshold expects key=value, got "${arg}"`);
    const key = arg.slice(0, eq);
    const val = Number(arg.slice(eq + 1));
    if (!Number.isFinite(val) || val < 0) throw new Error(`--threshold ${key}=${arg.slice(eq + 1)} is not a non-negative number`);
    if (!(key in DEFAULT_THRESHOLDS)) throw new Error(`unknown threshold key "${key}" (valid: ${Object.keys(DEFAULT_THRESHOLDS).join(", ")})`);
    out[key] = val;
  }
  return out;
}

function usage() {
  return `Usage: node bench/verify.mjs --report <report.json> --baseline <baseline.json> [--threshold key=value ...]

Compares a miaw-bench-report/1 against a miaw-bench-baseline/1 and exits
nonzero on regression. Null metrics are skipped, never compared as 0.

Default thresholds:
  --threshold hitRatePp=5        hit rate may fall up to 5pp below baseline
  --threshold p95Pct=0.20        p95 latency may rise up to 20% above baseline
  --threshold costPct=0.10       measured cost may rise up to 10% above baseline
  --threshold tokenSavingsPp=10  token savings may fall up to 10pp below baseline

Exit codes: 0 pass, 1 regression, 2 usage/IO error.
`;
}

async function main(argv) {
  const args = [...argv];
  const opt = { report: null, baseline: null, thresholds: {} };
  const thresholdArgs = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--report") opt.report = args[++i];
    else if (a === "--baseline") opt.baseline = args[++i];
    else if (a === "--threshold") thresholdArgs.push(args[++i]);
    else if (a === "--help" || a === "-h") { process.stdout.write(usage()); return 0; }
    else throw new Error(`unknown argument "${a}"`);
  }
  opt.thresholds = parseThresholds(thresholdArgs);
  if (!opt.report || !opt.baseline) throw new Error("--report and --baseline are required");
  for (const p of [opt.report, opt.baseline]) {
    if (!existsSync(p)) throw new Error(`file not found: ${p}`);
  }

  const report = JSON.parse(readFileSync(opt.report, "utf8"));
  const baseline = JSON.parse(readFileSync(opt.baseline, "utf8"));
  if (report.schema !== REPORT_SCHEMA) throw new Error(`report schema mismatch: ${report.schema}`);
  if (baseline.schema !== BASELINE_SCHEMA) throw new Error(`baseline schema mismatch: ${baseline.schema}`);

  const result = verifyReport({ report, baseline, thresholds: opt.thresholds });

  if (result.regressions.length) {
    console.error("REGRESSION — benchmark moved outside documented thresholds:");
    for (const r of result.regressions) {
      console.error(`  ✗ ${r.runId}.${r.metric}: current=${r.current} baseline=${r.baseline} (${r.detail})`);
    }
  }
  if (result.skipped.length) {
    console.warn(`Skipped ${result.skipped.length} comparison(s) (null or missing):`);
    for (const s of result.skipped) console.warn(`  - ${s.runId}${s.metric ? "." + s.metric : ""}: ${s.detail}`);
  }
  console.log(result.passed ? "PASS — no regressions." : "FAIL — regressions found.");
  return result.passed ? 0 : 1;
}

const isMain = process.argv[1] && (import.meta.url === new URL(`file://${process.argv[1]}`).href
  || import.meta.url.endsWith(process.argv[1].split("/").pop()));
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`verify.mjs: ${e.message}`);
    console.error(usage());
    process.exitCode = 2;
  });
}
