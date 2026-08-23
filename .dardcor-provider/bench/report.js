/**
 * bench/report.js — Phase 9 report writer (pure).
 *
 * Turns the raw per-iteration harness results into the `miaw-bench-report/1`
 * document: per-run metrics with defined denominators, deltas against the
 * same-fixture `all-off` run, plus JSON and Markdown renderers. Everything in
 * this module is pure — no fs, no network, no open-sse imports — so the
 * verifier and the unit tests can consume the same shapes.
 *
 * Metric contracts (all documented in the rendered Markdown too):
 *  - tokens.sent/received: measured upstream usage from the mock provider
 *    (real BPE counts), summed over turns and measured iterations.
 *  - tokens.cacheRead / tokens.cacheCreation: provider-reported cache billing.
 *  - L0 hit rate = cacheRead / sent (token-weighted; denominator = sent tokens).
 *  - L1/L2 hit rate = hits / (hits + misses); null when no probes (L2 is
 *    disabled offline — no embeddings backend — and fails closed to a miss).
 *  - L3 has no hit rate; it reports refs and bytesSaved from dedup events.
 *  - latency/ttfb: nearest-rank p50/p95/p99 over per-turn samples.
 *  - costUsd: null when no real pricing exists (the mock provider has none).
 *  - savingsPct = (1 - sent/original) * 100 against the raw fixture bytes.
 */

import {
  mean, percentiles, safeRatio, deltaPercent, deltaPp, round,
} from "./metrics.js";

export const REPORT_SCHEMA = "miaw-bench-report/1";
export const BASELINE_SCHEMA = "miaw-bench-baseline/1";

// ---------------------------------------------------------------------------
// Raw-run aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate one run's raw harness results (one or more measured iterations)
 * into the run metrics object stored in the report.
 *
 * @param {object} raw - {
 *   run: { id, config, fixture },
 *   config: config object from the matrix,
 *   iterations: [ { turns: [{ id, ok, latencyMs, ttfbMs, costUsd, usage }], providerTotals, originalTokens } ],
 *   integrity: { checked, passed, regions, restored } | null,
 *   note: string|null
 * }
 * @returns {object} run metrics
 */
export function aggregateRun(raw) {
  const { run, config, iterations, integrity, note } = raw;
  const latencies = [];
  const ttfb = [];
  let sent = 0;
  let received = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let originalTokens = 0;
  let costTotal = null;
  let costCount = 0;
  let turnCount = 0;

  const layers = {
    L1: { hits: 0, misses: 0 },
    L2: { hits: 0, misses: 0, stores: 0, embedErrors: 0, falseHits: 0, similarities: [] },
    L3: { dedups: 0, refs: 0, bytesSaved: 0 },
  };
  let l0Probes = 0;
  let l0Stable = 0;
  let l0Restored = 0;

  for (const it of iterations) {
    originalTokens += Number(it.originalTokens) || 0;
    for (const turn of it.turns) {
      turnCount++;
      if (Number.isFinite(turn.latencyMs)) latencies.push(turn.latencyMs);
      if (Number.isFinite(turn.ttfbMs)) ttfb.push(turn.ttfbMs);
      const u = turn.usage || {};
      sent += Number(u.prompt_tokens) || 0;
      received += Number(u.completion_tokens) || 0;
      cacheRead += Number(u.cache_read_input_tokens) || 0;
      cacheCreation += Number(u.cache_creation_input_tokens) || 0;
      if (Number.isFinite(turn.costUsd) && turn.costUsd !== null) {
        costTotal = (costTotal ?? 0) + turn.costUsd;
        costCount++;
      }
      for (const ev of turn.events || []) collectLayerEvent(ev);
    }
  }

  function collectLayerEvent(ev) {
    switch (ev.type) {
      case "cache_probe":
        l0Probes++;
        if (ev.stable) l0Stable++;
        if (ev.restored) l0Restored++;
        break;
      case "cache_l1":
        if (ev.action === "hit") layers.L1.hits++;
        else if (ev.action === "miss") layers.L1.misses++;
        break;
      case "cache_l2":
        if (ev.action === "hit") { layers.L2.hits++; if (Number.isFinite(ev.similarity)) layers.L2.similarities.push(ev.similarity); }
        else if (ev.action === "miss") layers.L2.misses++;
        else if (ev.action === "store") layers.L2.stores++;
        else if (ev.action === "embed_error") layers.L2.embedErrors++;
        else if (ev.action === "false_hit_removed") layers.L2.falseHits++;
        break;
      case "cache_l3":
        if (ev.action === "dedup") {
          layers.L3.dedups++;
          layers.L3.refs += Number(ev.refs) || 0;
          layers.L3.bytesSaved += Number(ev.bytesSaved) || 0;
        }
        break;
      default:
        break;
    }
  }

  const l1Probes = layers.L1.hits + layers.L1.misses;
  const l2Probes = layers.L2.hits + layers.L2.misses;
  const savingsPct = originalTokens > 0 ? (1 - sent / originalTokens) * 100 : null;

  return {
    runId: run.id,
    configId: config?.id ?? run.config,
    fixtureId: run.fixture,
    stream: Boolean(config?.stream),
    note: note ?? null,
    turns: turnCount,
    measuredIterations: iterations.length,
    tokens: {
      sent,
      received,
      cacheRead,
      cacheCreation,
      original: originalTokens,
      savingsPct: round(savingsPct, 2),
    },
    layers: {
      L0: {
        hitRate: sent > 0 ? round(safeRatio(cacheRead, sent), 4) : null,
        denominator: "sent tokens",
        probes: l0Probes,
        stableTurns: l0Stable,
        restoredTurns: l0Restored,
      },
      L1: {
        hits: layers.L1.hits,
        misses: layers.L1.misses,
        probes: l1Probes,
        hitRate: l1Probes > 0 ? round(safeRatio(layers.L1.hits, l1Probes), 4) : null,
        denominator: "probes",
      },
      L2: {
        hits: layers.L2.hits,
        misses: layers.L2.misses,
        probes: l2Probes,
        hitRate: l2Probes > 0 ? round(safeRatio(layers.L2.hits, l2Probes), 4) : null,
        denominator: "probes",
        disabledOffline: l2Probes === 0,
      },
      L3: {
        dedups: layers.L3.dedups,
        refs: layers.L3.refs,
        bytesSaved: layers.L3.bytesSaved,
        hitRate: null, // L3 is content-address dedup, not hit/miss
        denominator: "refs",
      },
    },
    latency: percentiles(latencies),
    ttfb: percentiles(ttfb),
    costUsd: costCount > 0 ? round(costTotal / costCount, 6) : null,
    costNote: costCount === 0 ? "no real pricing for the mock provider; cost is null, never a fake 0" : null,
    semantic: {
      observations: l2Probes,
      falseHits: layers.L2.falseHits,
      stores: layers.L2.stores,
      embedErrors: layers.L2.embedErrors,
      meanSimilarity: layers.L2.similarities.length > 0 ? round(mean(layers.L2.similarities), 4) : null,
      note: l2Probes === 0
        ? "L2 requires an embeddings backend; offline runs fail closed to a miss (no observations)"
        : null,
    },
    integrity: integrity ?? null,
  };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

/**
 * Build the full report document.
 * @param {object} input - { meta, matrix, runs: [aggregateRun() outputs] }
 * @returns {object} report
 */
export function buildReport({ meta, matrix, runs }) {
  const withDeltas = runs.map((r) => {
    const off = findAllOff(runs, r.fixtureId);
    let d = null;
    if (off) {
      const sentDelta = deltaPercent(r.tokens.sent, off.tokens.sent);
      d = {
        sentDeltaPct: round(sentDelta, 2),
        savingsVsAllOffPct: round(sentDelta === null ? null : -sentDelta, 2),
        l1HitRateDeltaPp: round(deltaPp(r.layers.L1.hitRate, off.layers.L1.hitRate), 4),
        l0HitRateDeltaPp: round(deltaPp(r.layers.L0.hitRate, off.layers.L0.hitRate), 4),
        p95DeltaPct: round(deltaPercent(r.latency.p95, off.latency.p95), 2),
      };
    }
    return { ...r, deltaVsAllOff: d };
  });

  return {
    schema: REPORT_SCHEMA,
    meta: meta ?? {},
    matrix: matrix ?? null,
    summary: {
      runs: withDeltas.length,
      fixtures: [...new Set(withDeltas.map((r) => r.fixtureId))].sort(),
      configs: [...new Set(withDeltas.map((r) => r.configId))].sort(),
    },
    runs: withDeltas,
  };
}

/** Find the all-off (non-streaming) run for a fixture. */
export function findAllOff(runs, fixtureId) {
  return runs.find((r) => r.configId === "all-off" && r.fixtureId === fixtureId && !r.stream) || null;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export function renderJSON(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderMarkdown(report) {
  const L = [];
  const m = report.meta || {};
  L.push("# MiawRouter Phase 9 Benchmark Report", "");
  L.push(`- schema: \`${report.schema}\``);
  L.push(`- generatedAt: ${m.generatedAt ?? "n/a"}`);
  L.push(`- mode: ${m.mode ?? "mock"} (network-free)`);
  L.push(`- matrix: ${m.matrix ?? "n/a"}`);
  L.push(`- fixtures: ${(report.summary?.fixtures || []).join(", ") || "n/a"}`);
  L.push(`- measuredIterations: ${m.measuredIterations ?? "n/a"} (warmup: ${m.warmupIterations ?? 0})`);
  L.push("");

  L.push("## Per-run metrics", "");
  L.push("| run | config | fixture | stream | sent | recv | orig | savings% | L0 hit% | L1 hit% | L2 hit% | L3 refs | p50 ms | p95 ms | cost $ | integrity |");
  L.push("|-----|--------|---------|--------|------|------|------|----------|---------|---------|---------|---------|--------|--------|--------|-----------|");
  for (const r of report.runs) {
    const t = r.tokens, la = r.layers;
    L.push(
      `| ${r.runId} | ${r.configId} | ${r.fixtureId} | ${r.stream ? "yes" : "no"} | ` +
      `${t.sent} | ${t.received} | ${t.original} | ${fmtPct(t.savingsPct)} | ` +
      `${fmtPct(la.L0.hitRate)} | ${fmtPct(la.L1.hitRate)} | ${fmtPct(la.L2.hitRate)} | ` +
      `${la.L3.refs} | ${fmtMs(r.latency.p50)} | ${fmtMs(r.latency.p95)} | ` +
      `${r.costUsd === null ? "null" : r.costUsd.toFixed(6)} | ${integrityBadge(r.integrity)} |`
    );
  }
  L.push("");

  L.push("## Metric definitions", "");
  L.push("`sent` = measured upstream prompt tokens (real BPE via the mock provider). `orig` = BPE tokens of the raw fixture bytes. `savings%` = (1 - sent/orig)×100. `L0 hit%` = cacheRead/sent (token-weighted). `L1/L2 hit%` = hits/probes; null means no probes (L2 fails closed offline without an embeddings backend). `L3 refs` = content-address dedup references emitted.", "");

  L.push("## Latency (ms, nearest-rank percentiles)", "");
  for (const r of report.runs) {
    L.push(`- **${r.runId}** (${r.configId} / ${r.fixtureId}): p50=${fmtMs(r.latency.p50)}, p95=${fmtMs(r.latency.p95)}, p99=${fmtMs(r.latency.p99)}, mean=${fmtMs(r.latency.mean)}, n=${r.latency.count}; TTFB p95=${fmtMs(r.ttfb.p95)}`);
  }
  L.push("");

  L.push("## Deltas vs all-off baseline", "");
  L.push("| run | sent Δ% | savings vs all-off | L1 hit Δpp | L0 hit Δpp | p95 Δ% |");
  L.push("|-----|---------|--------------------|------------|------------|--------|");
  for (const r of report.runs) {
    const d = r.deltaVsAllOff;
    L.push(d
      ? `| ${r.runId} | ${d.sentDeltaPct} | ${d.savingsVsAllOffPct} | ${fmt(d.l1HitRateDeltaPp)} | ${fmt(d.l0HitRateDeltaPp)} | ${fmt(d.p95DeltaPct)} |`
      : `| ${r.runId} | n/a (no all-off counterpart measured) | | | | |`);
  }
  L.push("");

  const integrityRuns = report.runs.filter((r) => r.integrity?.checked);
  if (integrityRuns.length > 0) {
    L.push("## Cache-integrity", "");
    for (const r of integrityRuns) {
      const i = r.integrity;
      const regions = (i.regions || []).map((rg) => `${rg.name}=${rg.identical ? "identical" : "MUTATED"}`).join(", ");
      L.push(`- **${r.runId}** (${r.configId}): ${i.passed ? "PASS" : "FAIL"} · ${regions} · l0Restored=${i.restored ? "yes" : "no"}`);
    }
    L.push("");
  }

  if (report.meta?.notes?.length) {
    L.push("## Notes", "");
    for (const n of report.meta.notes) L.push(`- ${n}`);
    L.push("");
  }
  return L.join("\n");
}

function fmtPct(v) { return v === null || v === undefined ? "null" : `${v.toFixed(2)}%`; }
function fmtMs(v) { return v === null || v === undefined ? "null" : v.toFixed(2); }
function fmt(v) { return v === null || v === undefined ? "null" : v; }
function integrityBadge(i) {
  if (!i || !i.checked) return "—";
  return i.passed ? "PASS" : "FAIL";
}

// ---------------------------------------------------------------------------
// Baseline extraction (for --record-baseline and the verifier)
// ---------------------------------------------------------------------------

/**
 * Extract the verifier-relevant subset of a report into a baseline document.
 * Only the metrics the verifier compares are kept; everything else (events,
 * notes, tokens detail) is intentionally dropped so the baseline is stable.
 */
export function extractBaseline(report, { recordedAt = new Date().toISOString() } = {}) {
  const runs = {};
  for (const r of report.runs) {
    runs[r.runId] = {
      configId: r.configId,
      fixtureId: r.fixtureId,
      tokens: { sent: r.tokens.sent, received: r.tokens.received, savingsPct: r.tokens.savingsPct },
      layers: {
        L0: { hitRate: r.layers.L0.hitRate },
        L1: { hitRate: r.layers.L1.hitRate },
        L2: { hitRate: r.layers.L2.hitRate },
        L3: { refs: r.layers.L3.refs, bytesSaved: r.layers.L3.bytesSaved },
      },
      latency: { p95: r.latency.p95 },
      ttfb: { p95: r.ttfb.p95 },
      costUsd: r.costUsd,
    };
  }
  return {
    schema: BASELINE_SCHEMA,
    recordedAt,
    meta: report.meta ?? {},
    runs,
  };
}
