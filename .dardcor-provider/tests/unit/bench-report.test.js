/**
 * tests/unit/bench-report.test.js — Phase 9 focused unit test for the report
 * writer in bench/report.js: raw-run aggregation (token/cache/latency/cost
 * contracts), deltas vs all-off, Markdown/JSON rendering, and baseline
 * extraction.
 *
 * Written but intentionally NOT run in this phase; the runner executes it.
 * Pure module — no network, no open-sse imports.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateRun, buildReport, findAllOff, renderJSON, renderMarkdown, extractBaseline,
  REPORT_SCHEMA, BASELINE_SCHEMA,
} from "../../bench/report.js";

const CONFIG = { id: "all-off", stream: false, settings: {} };

function fakeTurn({ prompt = 100, completion = 20, read = 0, create = 0, latencyMs = 10, ttfbMs = 10, costUsd = null, events = [] } = {}) {
  return {
    id: "t1", ok: true, cached: false, error: null, latencyMs, ttfbMs, costUsd, events,
    usage: { prompt_tokens: prompt, completion_tokens: completion, cache_read_input_tokens: read, cache_creation_input_tokens: create },
  };
}

function fakeRaw({ run, config = CONFIG, iterations, integrity = null, note = null }) {
  return { run, config, iterations, integrity, note };
}

describe("bench/report.js aggregateRun", () => {
  it("sums measured tokens across turns and iterations, keeping real cache splits", () => {
    const raw = fakeRaw({
      run: { id: "run-001", config: "all-off", fixture: "tool-heavy-refactor" },
      iterations: [
        {
          originalTokens: 500,
          turns: [
            fakeTurn({ prompt: 100, completion: 20, read: 0, create: 100 }),
            fakeTurn({ prompt: 200, completion: 30, read: 200, create: 0 }),
          ],
        },
        {
          originalTokens: 500,
          turns: [fakeTurn({ prompt: 100, completion: 20, read: 100, create: 0 })],
        },
      ],
    });
    const m = aggregateRun(raw);
    expect(m.tokens.sent).toBe(400);
    expect(m.tokens.received).toBe(70);
    expect(m.tokens.cacheRead).toBe(300);
    expect(m.tokens.cacheCreation).toBe(100);
    expect(m.tokens.original).toBe(1000);
    // savings = (1 - 400/1000) * 100 = 60%
    expect(m.tokens.savingsPct).toBe(60);
    // L0 token-weighted hit rate = 300 / 400
    expect(m.layers.L0.hitRate).toBeCloseTo(0.75, 4);
    expect(m.layers.L0.denominator).toBe("sent tokens");
  });

  it("computes L1/L2 hit rates as hits/probes with null when no probes", () => {
    const raw = fakeRaw({
      run: { id: "run-001", config: "l1-only", fixture: "multi-turn-session" },
      iterations: [{
        originalTokens: 100,
        turns: [
          fakeTurn({ events: [{ type: "cache_l1", action: "hit" }, { type: "cache_l1", action: "miss" }, { type: "cache_l1", action: "hit" }] }),
          fakeTurn({ events: [{ type: "cache_l2", action: "store" }] }), // L2 store is NOT a probe
        ],
      }],
    });
    const m = aggregateRun(raw);
    expect(m.layers.L1.hits).toBe(2);
    expect(m.layers.L1.misses).toBe(1);
    expect(m.layers.L1.probes).toBe(3);
    expect(m.layers.L1.hitRate).toBeCloseTo(2 / 3, 4);
    expect(m.layers.L2.probes).toBe(0);
    expect(m.layers.L2.hitRate).toBe(null);
    expect(m.layers.L2.disabledOffline).toBe(true);
  });

  it("collects L3 refs and bytesSaved from dedup events", () => {
    const raw = fakeRaw({
      run: { id: "run-001", config: "l3-only", fixture: "large-file-read" },
      iterations: [{
        originalTokens: 100,
        turns: [fakeTurn({ events: [{ type: "cache_l3", action: "dedup", refs: 2, bytesSaved: 5000 }] })],
      }],
    });
    const m = aggregateRun(raw);
    expect(m.layers.L3.refs).toBe(2);
    expect(m.layers.L3.bytesSaved).toBe(5000);
    expect(m.layers.L3.hitRate).toBe(null);
  });

  it("computes latency percentiles over per-turn samples and keeps cost null when absent", () => {
    const raw = fakeRaw({
      run: { id: "run-001", config: "all-off", fixture: "tool-heavy-refactor" },
      iterations: [{
        originalTokens: 100,
        turns: [
          fakeTurn({ latencyMs: 10, ttfbMs: 8 }),
          fakeTurn({ latencyMs: 20, ttfbMs: 15 }),
          fakeTurn({ latencyMs: 30, ttfbMs: 20 }),
        ],
      }],
    });
    const m = aggregateRun(raw);
    expect(m.latency.p50).toBe(20);
    expect(m.latency.p95).toBe(30);
    expect(m.latency.p99).toBe(30);
    expect(m.ttfb.p50).toBe(15);
    expect(m.costUsd).toBe(null);
    expect(m.costNote).toContain("no real pricing");
    expect(m.semantic.observations).toBe(0);
    expect(m.semantic.meanSimilarity).toBe(null);
  });

  it("embeds the integrity verdict and routing note", () => {
    const raw = fakeRaw({
      run: { id: "run-023", config: "all-on", fixture: "cache-integrity" },
      iterations: [{ originalTokens: 10, turns: [fakeTurn()] }],
      integrity: { checked: true, passed: true, regions: [{ name: "tools", identical: true }], restored: false },
      note: "routing strategy \"round-robin\" is app-layer combo expansion",
    });
    const m = aggregateRun(raw);
    expect(m.integrity.passed).toBe(true);
    expect(m.note).toContain("round-robin");
  });
});

describe("bench/report.js buildReport", () => {
  it("computes deltas against the same-fixture all-off run", () => {
    const runs = [
      aggregateRun(fakeRaw({ run: { id: "run-001", config: "all-off", fixture: "f1" }, iterations: [{ originalTokens: 100, turns: [fakeTurn({ prompt: 100, latencyMs: 10 })] }] })),
      aggregateRun(fakeRaw({ run: { id: "run-002", config: "comp-rtk", fixture: "f1" }, iterations: [{ originalTokens: 100, turns: [fakeTurn({ prompt: 60, latencyMs: 15 })] }] })),
    ];
    const report = buildReport({ meta: { mode: "mock" }, matrix: null, runs });
    const r2 = report.runs.find((r) => r.runId === "run-002");
    expect(r2.deltaVsAllOff.sentDeltaPct).toBe(-40); // 60 vs 100
    expect(r2.deltaVsAllOff.savingsVsAllOffPct).toBe(40);
    expect(r2.deltaVsAllOff.p95DeltaPct).toBe(50); // 15 vs 10
    expect(report.schema).toBe(REPORT_SCHEMA);
    expect(report.summary.runs).toBe(2);
  });

  it("findAllOff only matches the non-streaming all-off config", () => {
    const runs = [
      aggregateRun(fakeRaw({ run: { id: "a", config: "all-off-stream", fixture: "f1" }, config: { id: "all-off-stream", stream: true, settings: {} }, iterations: [] })),
      aggregateRun(fakeRaw({ run: { id: "b", config: "all-off", fixture: "f1" }, iterations: [] })),
    ];
    const off = findAllOff(runs, "f1");
    expect(off).not.toBe(null);
    expect(off.runId).toBe("b");
  });

  it("renders JSON and Markdown without throwing and mentions key metrics", () => {
    const report = buildReport({
      meta: { mode: "mock", generatedAt: "2026-08-09T00:00:00.000Z" },
      matrix: null,
      runs: [
        aggregateRun(fakeRaw({ run: { id: "run-001", config: "all-off", fixture: "f1" }, iterations: [{ originalTokens: 100, turns: [fakeTurn({ prompt: 100 })] }] })),
      ],
    });
    const json = renderJSON(report);
    expect(JSON.parse(json).schema).toBe(REPORT_SCHEMA);
    const md = renderMarkdown(report);
    expect(md).toContain("# MiawRouter Phase 9 Benchmark Report");
    expect(md).toContain("run-001");
    expect(md).toContain("savings%");
  });

  it("extractBaseline keeps only verifier-relevant fields", () => {
    const report = buildReport({
      meta: { mode: "mock" },
      matrix: null,
      runs: [aggregateRun(fakeRaw({ run: { id: "run-001", config: "all-off", fixture: "f1" }, iterations: [{ originalTokens: 100, turns: [fakeTurn({ prompt: 100, latencyMs: 10 })] }] }))],
    });
    const b = extractBaseline(report, { recordedAt: "2026-08-09T00:00:00.000Z" });
    expect(b.schema).toBe(BASELINE_SCHEMA);
    expect(b.recordedAt).toBe("2026-08-09T00:00:00.000Z");
    expect(b.runs["run-001"].tokens.sent).toBe(100);
    expect(b.runs["run-001"].latency.p95).toBe(10);
    expect(b.runs["run-001"].costUsd).toBe(null);
    expect(b.runs["run-001"].tokens).not.toHaveProperty("original"); // detail dropped
  });
});
