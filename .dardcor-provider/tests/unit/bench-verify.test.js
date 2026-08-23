/**
 * tests/unit/bench-verify.test.js — Phase 9 focused unit test for the
 * regression verifier in bench/verify.mjs: documented default thresholds,
 * null-metric skipping, and whole-report regression detection.
 *
 * Written but intentionally NOT run in this phase; the runner executes it.
 * Pure module — no network, no open-sse imports.
 */

import { describe, it, expect } from "vitest";
import { compareRun, verifyReport, DEFAULT_THRESHOLDS } from "../../bench/verify.mjs";

const BASE = {
  tokens: { savingsPct: 40 },
  layers: { L0: { hitRate: 0.5 }, L1: { hitRate: 0.8 }, L2: { hitRate: null } },
  latency: { p95: 100 },
  costUsd: null,
};

const CUR = (over) => ({
  runId: "run-001",
  tokens: { savingsPct: 40 },
  layers: { L0: { hitRate: 0.5 }, L1: { hitRate: 0.8 }, L2: { hitRate: null } },
  latency: { p95: 100 },
  costUsd: null,
  ...over,
});

describe("bench/verify.mjs DEFAULT_THRESHOLDS", () => {
  it("documents the required defaults", () => {
    expect(DEFAULT_THRESHOLDS).toMatchObject({
      hitRatePp: 5,
      p95Pct: 0.2,
      costPct: 0.1,
      tokenSavingsPp: 10,
    });
  });
});

describe("bench/verify.mjs compareRun", () => {
  it("passes when every metric is within thresholds", () => {
    const r = compareRun(CUR(), BASE);
    expect(r.passed).toBe(true);
    expect(r.checks.every((c) => c.skipped || c.pass)).toBe(true);
  });

  it("fails when the L1 hit rate drops more than 5pp below baseline", () => {
    const r = compareRun(CUR({ layers: { L0: { hitRate: 0.5 }, L1: { hitRate: 0.74 }, L2: { hitRate: null } } }), BASE);
    // 0.74 is 6pp below 0.80 → regression
    expect(r.passed).toBe(false);
    const l1 = r.checks.find((c) => c.metric === "layers.L1.hitRate");
    expect(l1.pass).toBe(false);
    expect(l1.detail).toContain("below threshold");
    // exactly 5pp below is still a pass
    const ok = compareRun(CUR({ layers: { L0: { hitRate: 0.5 }, L1: { hitRate: 0.75 }, L2: { hitRate: null } } }), BASE);
    expect(ok.passed).toBe(true);
  });

  it("fails when p95 latency exceeds baseline × 1.20", () => {
    const r = compareRun(CUR({ latency: { p95: 121 } }), BASE);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.metric === "latency.p95").pass).toBe(false);
    const ok = compareRun(CUR({ latency: { p95: 120 } }), BASE); // boundary allowed
    expect(ok.passed).toBe(true);
  });

  it("fails when cost exceeds baseline × 1.10 (when both are non-null)", () => {
    const baseCost = { ...BASE, costUsd: 1.0 };
    const ok = compareRun(CUR({ costUsd: 1.1 }), baseCost);
    expect(ok.passed).toBe(true);
    const bad = compareRun(CUR({ costUsd: 1.11 }), baseCost);
    expect(bad.passed).toBe(false);
    expect(bad.checks.find((c) => c.metric === "costUsd").pass).toBe(false);
  });

  it("fails when token savings fall more than 10pp below baseline", () => {
    const bad = compareRun(CUR({ tokens: { savingsPct: 29 } }), BASE);
    expect(bad.passed).toBe(false);
    const ok = compareRun(CUR({ tokens: { savingsPct: 30 } }), BASE); // exactly 10pp below
    expect(ok.passed).toBe(true);
  });

  it("skips null metrics instead of comparing them as 0", () => {
    const r = compareRun(
      CUR({ costUsd: null, layers: { L0: { hitRate: null }, L1: { hitRate: null }, L2: { hitRate: null } }, latency: { p95: null }, tokens: { savingsPct: null } }),
      { ...BASE, costUsd: null, layers: { L0: { hitRate: null }, L1: { hitRate: null }, L2: { hitRate: null } }, latency: { p95: null }, tokens: { savingsPct: null } }
    );
    expect(r.passed).toBe(true);
    expect(r.checks.every((c) => c.skipped)).toBe(true);
    for (const c of r.checks) expect(c.detail).toContain("null metric skipped");
  });
});

describe("bench/verify.mjs verifyReport", () => {
  const report = {
    schema: "miaw-bench-report/1",
    runs: [
      { runId: "run-001", ...CUR() },
      { runId: "run-002", tokens: { savingsPct: 40 }, layers: { L0: { hitRate: 0.5 }, L1: { hitRate: 0.8 }, L2: { hitRate: null } }, latency: { p95: 100 }, costUsd: null },
    ],
  };
  const baseline = {
    schema: "miaw-bench-baseline/1",
    runs: {
      "run-001": BASE,
      "run-002": { ...BASE, latency: { p95: 200 } }, // baseline p95 higher than current — fine
    },
  };

  it("passes when nothing regressed and notes null-skipped metrics", () => {
    const r = verifyReport({ report, baseline });
    expect(r.passed).toBe(true);
    expect(r.regressions).toHaveLength(0);
    // run-002's p95 (100) is below its baseline (200) — pass; L2 nulls skipped
    expect(r.skipped.some((s) => s.metric === "layers.L2.hitRate")).toBe(true);
  });

  it("reports a regression and fails the whole report", () => {
    const badReport = {
      ...report,
      runs: [{ ...report.runs[0], layers: { L0: { hitRate: 0.5 }, L1: { hitRate: 0.4 }, L2: { hitRate: null } } }, report.runs[1]],
    };
    const r = verifyReport({ report: badReport, baseline });
    expect(r.passed).toBe(false);
    expect(r.regressions.some((g) => g.metric === "layers.L1.hitRate" && g.runId === "run-001")).toBe(true);
  });

  it("skips runs missing from the baseline instead of failing them", () => {
    const extra = { ...report, runs: [...report.runs, { runId: "run-999", ...CUR() }] };
    const r = verifyReport({ report: extra, baseline });
    expect(r.passed).toBe(true);
    expect(r.skipped.some((s) => s.runId === "run-999" && s.detail.includes("missing from baseline"))).toBe(true);
  });

  it("honors threshold overrides", () => {
    const r = verifyReport({
      report: { ...report, runs: [{ ...report.runs[0], latency: { p95: 110 } }, report.runs[1]] },
      baseline,
      thresholds: { p95Pct: 0.05 }, // only +5% allowed → 110 > 105 → regression
    });
    expect(r.passed).toBe(false);
    expect(r.regressions.some((g) => g.metric === "latency.p95")).toBe(true);
  });

  it("rejects a baseline with the wrong schema instead of false-passing", () => {
    expect(() => verifyReport({ report, baseline: { schema: "miaw-bench-baseline/999", runs: {} } }))
      .toThrow(/baseline schema mismatch/);
  });

  it("rejects a report with the wrong schema", () => {
    expect(() => verifyReport({ report: { schema: "not-a-report", runs: [] }, baseline }))
      .toThrow(/report schema mismatch/);
  });
});
