#!/usr/bin/env node
/**
 * bench/run.mjs — Phase 9 offline benchmark runner (CLI).
 *
 * Replays the bench fixtures through the REAL chat pipeline (RTK/caveman/
 * ponytail → L0 begin → translation → executor) with the deterministic
 * MockProvider as the only upstream, then writes a `dardcor-bench-report/1`
 * document as JSON and Markdown.
 *
 * Guarantees:
 *  - Network-free by default. `--real` is REJECTED (real-provider mode is
 *    unimplemented; the harness uses MockProvider and must be wired before
 *    this gate can be enabled).
 *  - Deterministic ordering: runs execute in matrix order, iterations
 *    sequentially, each measured iteration on a fresh MockProvider (cold
 *    provider-prefix simulation) with the same connectionId so L0/L1 module
 *    state warms exactly as in a long-lived process.
 *  - `--record-baseline` writes ONLY from an actual completed run (refuses
 *    when any selected run failed completely) and never fabricates a baseline.
 *  - `--verify` compares the fresh report against a recorded baseline with the
 *    documented thresholds and exits nonzero on regression.
 *
 * Usage:
 *   node bench/run.mjs [--matrix bench/matrix.json] [--fixture id[,id]...]
 *     [--config id[,id]...] [--output bench/out] [--format json|md|both]
 *     [--warmup N] [--iterations N] [--record-baseline [path]] [--verify path]
 *     [--threshold key=value ...] [--real] [--help]
 *
 * Exit codes: 0 ok, 1 verify regression, 2 usage/IO error.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BENCH_DIR = join(REPO_ROOT, "bench");
const DEFAULT_OUT_DIR = join(BENCH_DIR, "out");

import { aggregateRun, buildReport, renderJSON, renderMarkdown, extractBaseline, BASELINE_SCHEMA } from "./report.js";
import { verifyReport, DEFAULT_THRESHOLDS } from "./verify.mjs";
import {
  installMockFetch, loadOpenSse, replayFixture, replayTurn, takeLastOutboundBody, setActiveProvider,
} from "./harness.js";
import { checkFixtureIntegrity } from "./integrity.js";

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

function usage() {
  return `Usage: node bench/run.mjs [options]

Offline Phase 9 benchmark runner (network-free, mock provider only).

Options:
  --matrix <path>       config matrix JSON             (default: bench/matrix.json)
  --fixture <id[,id]>   restrict to fixture id(s)      (repeatable)
  --config <id[,id]>    restrict to config id(s)       (repeatable)
  --output <dir>        output directory               (default: bench/out)
  --format <fmt>        json | md | both               (default: both)
  --warmup <n>          warm-up replay passes          (default: 0)
  --iterations <n>      measured replay passes         (default: 1)
  --record-baseline [path]  write baseline from this completed run
                           (default: <output>/baseline.json)
  --verify <path>       compare report vs baseline after the run
  --threshold key=val   override a verify threshold (repeatable;
                        keys: ${Object.keys(DEFAULT_THRESHOLDS).join(", ")})
  --real                REJECTED (real-provider mode is unimplemented;
                        must be wired before this gate can be enabled)
  --help, -h            show this help

Exit codes: 0 ok, 1 verify regression, 2 usage/IO error.
`;
}

function parseArgs(argv) {
  const opt = {
    matrix: join(BENCH_DIR, "matrix.json"),
    fixtures: new Set(),
    configs: new Set(),
    output: DEFAULT_OUT_DIR,
    format: "both",
    warmup: 0,
    iterations: 1,
    recordBaseline: null, // null = off; false = default path; string = path
    verify: null,
    thresholds: {},
    real: false,
    help: false,
  };
  const thresholdArgs = [];
  const addMany = (set, value) => {
    for (const part of value.split(",")) {
      const v = part.trim();
      if (v) set.add(v);
    }
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--matrix": opt.matrix = argv[++i]; break;
      case "--fixture": addMany(opt.fixtures, argv[++i]); break;
      case "--config": addMany(opt.configs, argv[++i]); break;
      case "--output": opt.output = argv[++i]; break;
      case "--format": opt.format = argv[++i]; break;
      case "--warmup": opt.warmup = parseInt(argv[++i], 10); break;
      case "--iterations": opt.iterations = parseInt(argv[++i], 10); break;
      case "--record-baseline": {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) { opt.recordBaseline = next; i++; }
        else opt.recordBaseline = false;
        break;
      }
      case "--verify": opt.verify = argv[++i]; break;
      case "--threshold": thresholdArgs.push(argv[++i]); break;
      case "--real": opt.real = true; break;
      case "--help":
      case "-h": opt.help = true; break;
      default:
        throw new Error(`unknown argument "${a}"`);
    }
  }
  if (opt.warmup < 0 || !Number.isInteger(opt.warmup)) throw new Error("--warmup must be a non-negative integer");
  if (opt.iterations < 1 || !Number.isInteger(opt.iterations)) throw new Error("--iterations must be a positive integer");
  if (!["json", "md", "both"].includes(opt.format)) throw new Error(`--format must be json|md|both, got "${opt.format}"`);
  for (const t of thresholdArgs) {
    const eq = t.indexOf("=");
    if (eq === -1) throw new Error(`--threshold expects key=value, got "${t}"`);
    const key = t.slice(0, eq);
    const val = Number(t.slice(eq + 1));
    if (!(key in DEFAULT_THRESHOLDS)) throw new Error(`unknown threshold key "${key}" (valid: ${Object.keys(DEFAULT_THRESHOLDS).join(", ")})`);
    if (!Number.isFinite(val) || val < 0) throw new Error(`--threshold ${key} must be a non-negative number`);
    opt.thresholds[key] = val;
  }
  return opt;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv) {
  const opt = parseArgs(argv);
  if (opt.help) {
    process.stdout.write(usage());
    return 0;
  }

  // --- --real gate: unconditionally rejected (harness is MockProvider) ------
  if (opt.real) {
    console.error(
      "run.mjs: --real rejected — the Phase 9 runner uses MockProvider " +
      "(bench/harness.js replayFixture) and has no real-provider execution " +
      "path. Real-provider mode is unimplemented and must be wired before " +
      "this gate can be enabled."
    );
    return 2;
  }

  // --- inputs --------------------------------------------------------------
  const matrix = JSON.parse(await readText(opt.matrix));
  if (matrix.schema !== "dardcor-bench-matrix/1") throw new Error(`matrix schema mismatch: ${matrix.schema}`);
  const fixtureIds = new Set(matrix.fixtures);
  for (const id of opt.fixtures) {
    if (!fixtureIds.has(id)) throw new Error(`unknown fixture "${id}" (valid: ${[...fixtureIds].join(", ")})`);
  }
  const configIds = new Set(matrix.configs.map((c) => c.id));
  for (const id of opt.configs) {
    if (!configIds.has(id)) throw new Error(`unknown config "${id}" (valid: ${[...configIds].sort().join(", ")})`);
  }

  const configById = new Map(matrix.configs.map((c) => [c.id, c]));
  const fixtureById = new Map();
  for (const id of fixtureIds) {
    fixtureById.set(id, JSON.parse(await readText(join(BENCH_DIR, "fixtures", `${id}.json`))));
  }

  const selectedRuns = matrix.runs.filter((r) =>
    (opt.fixtures.size === 0 || opt.fixtures.has(r.fixture))
    && (opt.configs.size === 0 || opt.configs.has(r.config))
  );
  if (selectedRuns.length === 0) throw new Error("no runs selected (check --fixture/--config filters)");

  // --- harness setup (fetch install MUST precede the open-sse import) ------
  installMockFetch();
  const sse = await loadOpenSse();
  const countTokens = (body) => { try { return sse.countBodyTokens(body) || 0; } catch { return 0; } };
  const costFn = (provider, model, usage) => {
    if (provider === "mock") return null; // mock has no real pricing — cost stays null, never 0
    try {
      const pricing = sse.getPricingForModel(provider, model);
      return pricing ? sse.calculateCostFromTokens(usage, pricing) : null;
    } catch {
      return null;
    }
  };

  // --- run the matrix ------------------------------------------------------
  mkdirSync(opt.output, { recursive: true });
  const notes = [
    "network-free mock-only run; real providers require a separately configured implementation",
    "L2 semantic cache fails closed offline (no embeddings backend) — no L2 observations",
    "routing strategies are app-layer combo expansion; the offline harness uses a direct single-provider route",
    "headroom (external /v1/compress proxy) and pxpipe (Claude-only image compressor) are excluded offline",
    "cost is null for the mock provider (no real pricing exists); never a fake 0",
    "latency/TTFB are measured wall-clock through the real pipeline; content metrics are deterministic",
  ];

  const rawResults = [];
  let anyRunFullyFailed = false;
  for (const run of selectedRuns) {
    const fixture = fixtureById.get(run.fixture);
    const config = configById.get(run.config);
    process.stderr.write(`run ${run.id} (${run.config} / ${run.fixture})…\n`);
    try {
      const raw = await replayFixture({
        fixture, config, runId: run.id,
        iterations: opt.iterations, warmup: opt.warmup,
        countTokens, costFn,
      });
      // Cache-integrity fixture: assert prefix byte-identity through the real
      // pipeline using the captured outbound bodies.
      let integrity = null;
      if (run.fixture === "cache-integrity") {
        const { MockProvider } = await loadOpenSse();
        const provider = new MockProvider();
        setActiveProvider(provider); // integrity replay must hit ITS OWN provider, not the last measured one
        const integrityReplay = async (body) => {
          const res = await replayTurn({
            turn: { id: "integrity", request: body }, config, runId: run.id,
            provider, countTokens, costFn,
          });
          return { ok: res.ok, error: res.error, outboundBody: takeLastOutboundBody(), events: res.events };
        };
        integrity = await checkFixtureIntegrity({ fixture, config, replay: integrityReplay });
      }
      const fullyFailed = raw.iterations.every((it) => it.turns.every((t) => !t.ok));
      if (fullyFailed) {
        anyRunFullyFailed = true;
        raw.note = [raw.note, "RUN FAILED: every turn errored"].filter(Boolean).join("; ");
      }
      rawResults.push({ raw, integrity });
    } catch (e) {
      anyRunFullyFailed = true;
      rawResults.push({
        raw: {
          run: { id: run.id, config: config.id, fixture: fixture.id },
          config, iterations: [],
          note: `RUN ERROR: ${e.message}`,
        },
        integrity: { checked: true, passed: false, turns: [], crossTurn: { stable: false, regions: {}, tailOnlyChurn: null }, restored: false },
      });
    }
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    mode: "mock",
    matrix: opt.matrix,
    fixtures: [...new Set(selectedRuns.map((r) => r.fixture))].sort(),
    warmupIterations: opt.warmup,
    measuredIterations: opt.iterations,
    node: process.version,
    notes,
  };

  const runs = rawResults.map(({ raw, integrity }) => aggregateRun({ ...raw, integrity }));
  const report = buildReport({ meta, matrix, runs });

  // --- outputs -------------------------------------------------------------
  if (opt.format === "json" || opt.format === "both") {
    writeFileSync(join(opt.output, "report.json"), renderJSON(report));
  }
  if (opt.format === "md" || opt.format === "both") {
    writeFileSync(join(opt.output, "report.md"), renderMarkdown(report));
  }
  process.stderr.write(`report written to ${join(opt.output, "report." + (opt.format === "json" ? "json" : opt.format === "md" ? "md" : "json+md"))}\n`);

  // --- --record-baseline: only from an actual completed run ----------------
  if (opt.recordBaseline !== null) {
    if (anyRunFullyFailed) {
      console.error("run.mjs: refusing to record a baseline — at least one selected run failed completely. Fix the failure and re-run.");
      return 2;
    }
    const baselinePath = resolve(opt.recordBaseline === false ? join(opt.output, "baseline.json") : opt.recordBaseline);
    const baseline = extractBaseline(report);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stderr.write(`baseline recorded to ${baselinePath}\n`);
  }

  // --- --verify ------------------------------------------------------------
  if (opt.verify) {
    if (!existsSync(opt.verify)) throw new Error(`baseline not found: ${opt.verify}`);
    const baseline = JSON.parse(await readText(opt.verify));
    if (baseline.schema !== BASELINE_SCHEMA) {
      console.error(`run.mjs: --verify baseline schema mismatch: ${baseline.schema} (expected ${BASELINE_SCHEMA})`);
      return 2;
    }
    const result = verifyReport({ report, baseline, thresholds: opt.thresholds });
    if (result.regressions.length) {
      console.error("REGRESSION — benchmark moved outside documented thresholds:");
      for (const r of result.regressions) {
        console.error(`  ✗ ${r.runId}.${r.metric}: current=${r.current} baseline=${r.baseline} (${r.detail})`);
      }
    }
    if (result.skipped.length) {
      console.warn(`Skipped ${result.skipped.length} comparison(s):`);
      for (const s of result.skipped) console.warn(`  - ${s.runId}${s.metric ? "." + s.metric : ""}: ${s.detail}`);
    }
    console.log(result.passed ? "PASS — no regressions." : "FAIL — regressions found.");
    return result.passed ? 0 : 1;
  }

  return 0;
}

function readText(path) {
  return import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
}

const isMain = process.argv[1] && (import.meta.url === new URL(`file://${process.argv[1]}`).href
  || import.meta.url.endsWith(process.argv[1].split("/").pop()));
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`run.mjs: ${e.message}`);
    console.error(usage());
    process.exitCode = 2;
  });
}
