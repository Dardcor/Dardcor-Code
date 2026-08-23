// Metric persistence + aggregation for cache hit/miss/bypass and token-saver
// savings. Pure helpers are tested without a DB; persisted stats are tested
// against a real adapter (temp DATA_DIR).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  aggregateCacheMetrics,
  aggregateSaverMetrics,
  buildCacheMetricRows,
  buildCacheEventMetricRows,
  buildSaverMetricRows,
  periodToSince,
} from "@/lib/db/repos/metricsRepo.js";

describe("buildCacheMetricRows", () => {
  it("returns no rows for streaming requests", () => {
    expect(buildCacheMetricRows({ stream: true, cacheable: true, l1On: true, l2On: true })).toEqual([]);
  });

  it("returns no rows when every cache layer is off", () => {
    expect(buildCacheMetricRows({ stream: false, cacheable: true, l1On: false, l2On: false })).toEqual([]);
  });

  it("records an L1 hit only (L2 never attempted after an L1 hit)", () => {
    const rows = buildCacheMetricRows({
      stream: false, cacheable: true, l1On: true, l2On: true, l1Hit: true, l2Hit: false,
      provider: "anthropic", model: "claude",
    });
    expect(rows.map((r) => [r.name, r.outcome])).toEqual([["l1", "hit"]]);
    expect(rows[0]).toMatchObject({ kind: "cache", provider: "anthropic", model: "claude" });
  });

  it("records L1 miss then L2 hit", () => {
    const rows = buildCacheMetricRows({
      stream: false, cacheable: true, l1On: true, l2On: true, l1Hit: false, l2Hit: true,
    });
    expect(rows.map((r) => [r.name, r.outcome])).toEqual([["l1", "miss"], ["l2", "hit"]]);
  });

  it("records a full miss pair when both layers miss", () => {
    const rows = buildCacheMetricRows({
      stream: false, cacheable: true, l1On: true, l2On: true, l1Hit: false, l2Hit: false,
    });
    expect(rows.map((r) => [r.name, r.outcome])).toEqual([["l1", "miss"], ["l2", "miss"]]);
  });

  it("records an L2-only lookup when L1 is off", () => {
    const rows = buildCacheMetricRows({ stream: false, cacheable: true, l1On: false, l2On: true, l2Hit: true });
    expect(rows.map((r) => [r.name, r.outcome])).toEqual([["l2", "hit"]]);
  });

  it("records bypass rows (not misses) when the request is ineligible", () => {
    const rows = buildCacheMetricRows({ stream: false, cacheable: false, l1On: true, l2On: true });
    expect(rows.map((r) => [r.name, r.outcome])).toEqual([["l1", "bypass"], ["l2", "bypass"]]);
  });

  it("marks L2 as bypass (not miss) when the L2 gate rejects the prompt", () => {
    const rows = buildCacheMetricRows({
      stream: false, cacheable: true, l1On: true, l2On: true, l1Hit: false, l2Hit: false, l2Attempted: false,
    });
    expect(rows.map((r) => [r.name, r.outcome])).toEqual([["l1", "miss"], ["l2", "bypass"]]);
  });
});

describe("buildCacheEventMetricRows", () => {
  it("maps provider cache probes and usage without treating zero reads as hits", () => {
    expect(buildCacheEventMetricRows({ type: "cache_probe", provider: "p", model: "m" }))
      .toEqual([{ kind: "cache", name: "l0", outcome: "probe", provider: "p", model: "m" }]);
    expect(buildCacheEventMetricRows({ type: "cache_usage", provider: "p", model: "m", cacheRead: 120 }))
      .toEqual([{ kind: "cache", name: "l0", outcome: "hit", provider: "p", model: "m", value: 120, valueBasis: "tokens" }]);
    expect(buildCacheEventMetricRows({ type: "cache_usage", cacheRead: 0 })[0]).toMatchObject({ name: "l0", outcome: "miss", value: 0 });
  });

  it("maps L3 dedup refs and saved bytes into separate persisted counters", () => {
    expect(buildCacheEventMetricRows({ type: "cache_l3", action: "dedup", refs: 2, bytesSaved: 5000 }))
      .toEqual([
        { kind: "cache", name: "l3_refs", outcome: "dedup", provider: null, model: null, value: 2, valueBasis: "count" },
        { kind: "cache", name: "l3_bytes", outcome: "dedup", provider: null, model: null, value: 5000, valueBasis: "bytes" },
      ]);
  });

  it("ignores unrelated and malformed cache events", () => {
    expect(buildCacheEventMetricRows(null)).toEqual([]);
    expect(buildCacheEventMetricRows({ type: "cache_l1", action: "hit" })).toEqual([]);
    expect(buildCacheEventMetricRows({ type: "cache_l3", action: "dedup", refs: -1, bytesSaved: "nope" })).toEqual([]);
  });
});

describe("aggregateCacheMetrics", () => {
  it("computes hit/miss/bypass per layer with attempted = hit + miss", () => {
    const out = aggregateCacheMetrics([
      { name: "l1", outcome: "hit" },
      { name: "l1", outcome: "miss" },
      { name: "l1", outcome: "miss" },
      { name: "l1", outcome: "bypass" },
      { name: "l2", outcome: "hit" },
      { name: "l2", outcome: "hit" },
    ]);
    expect(out.l1).toEqual({ hit: 1, miss: 2, bypass: 1, attempted: 3, hitRate: 0.3333, missRate: 0.6667 });
    expect(out.l2).toEqual({ hit: 2, miss: 0, bypass: 0, attempted: 2, hitRate: 1, missRate: 0 });
  });

  it("excludes bypasses from the hit-rate denominator", () => {
    const out = aggregateCacheMetrics([
      { name: "l1", outcome: "hit" },
      { name: "l1", outcome: "bypass" },
      { name: "l1", outcome: "bypass" },
    ]);
    expect(out.l1.hitRate).toBe(1);
    expect(out.l1.attempted).toBe(1);
    expect(out.l1.miss).toBe(0);
  });

  it("ignores rows of other kinds", () => {
    const out = aggregateCacheMetrics([
      { name: "l1", outcome: "hit" },
      { kind: "saver", name: "rtk", outcome: "provider" },
    ]);
    expect(out.l1.hit).toBe(1);
    expect(out.rtk).toBeUndefined();
  });

  it("returns empty stats for no rows", () => {
    expect(aggregateCacheMetrics([])).toEqual({});
  });
});

describe("buildSaverMetricRows", () => {
  it("computes rtk byte savings", () => {
    const rows = buildSaverMetricRows([{ stage: "rtk", bytesBefore: 1000, bytesAfter: 400 }], { provider: "p", model: "m" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "saver", name: "rtk", outcome: "provider", value: 600, valueBasis: "bytes", provider: "p", model: "m" });
  });

  it("marks headroom savings as reported", () => {
    const rows = buildSaverMetricRows([{ stage: "headroom", tokensSaved: 123 }]);
    expect(rows[0]).toMatchObject({ name: "headroom", value: 123, valueBasis: "reported" });
  });

  it("derives headroom savings from before/after tokens when tokensSaved is absent", () => {
    const rows = buildSaverMetricRows([{ stage: "headroom", tokensBefore: 500, tokensAfter: 200 }]);
    expect(rows[0]).toMatchObject({ name: "headroom", value: 300, valueBasis: "reported" });
  });

  it("marks pxpipe savings as estimate", () => {
    const rows = buildSaverMetricRows([{ stage: "pxpipe", tokensSavedEst: 45 }]);
    expect(rows[0]).toMatchObject({ name: "pxpipe", value: 45, valueBasis: "estimate" });
  });

  it("records applied-only stages with no value", () => {
    const rows = buildSaverMetricRows([{ stage: "caveman", applied: true }, { stage: "ponytail", applied: true }]);
    expect(rows.map((r) => [r.name, r.value, r.valueBasis])).toEqual([["caveman", null, null], ["ponytail", null, null]]);
  });

  it("does not fabricate savings from zero deltas", () => {
    const rows = buildSaverMetricRows([{ stage: "rtk", bytesBefore: 100, bytesAfter: 100 }]);
    expect(rows[0].value).toBeNull();
    expect(rows[0].valueBasis).toBeNull();
  });

  it("drops the provider dispatch marker from savings rows", () => {
    const rows = buildSaverMetricRows([{ stage: "rtk", bytesBefore: 10, bytesAfter: 2 }, { stage: "provider" }]);
    expect(rows.map((r) => r.name)).toEqual(["rtk"]);
  });
});

describe("aggregateSaverMetrics", () => {
  it("counts dispatched requests from dispatch rows", () => {
    const out = aggregateSaverMetrics([
      { name: "dispatch", outcome: "provider" },
      { name: "dispatch", outcome: "provider" },
      { name: "rtk", outcome: "provider", value: 100, valueBasis: "bytes" },
    ]);
    expect(out.dispatched).toBe(2);
  });

  it("sums savings per basis without mixing units", () => {
    const out = aggregateSaverMetrics([
      { name: "rtk", outcome: "provider", value: 100, valueBasis: "bytes" },
      { name: "rtk", outcome: "provider", value: 50, valueBasis: "bytes" },
      { name: "headroom", outcome: "provider", value: 30, valueBasis: "reported" },
      { name: "pxpipe", outcome: "provider", value: 20, valueBasis: "estimate" },
    ]);
    expect(out.totals).toEqual({ bytes: 150, reported: 30, estimate: 20 });
    expect(out.byStage.rtk).toEqual({ applied: 2, savings: 150, basis: "bytes" });
    expect(out.byBasis.bytes).toEqual({ count: 2, value: 150 });
  });

  it("counts saver savings only when outcome is provider", () => {
    const out = aggregateSaverMetrics([
      { name: "rtk", outcome: "cache_hit", value: 999, valueBasis: "bytes" },
      { name: "rtk", outcome: "provider", value: 5, valueBasis: "bytes" },
    ]);
    expect(out.byStage.rtk.savings).toBe(5);
    expect(out.totals.bytes).toBe(5);
  });

  it("counts applied stages with zero savings", () => {
    const out = aggregateSaverMetrics([
      { name: "caveman", outcome: "provider", value: null, valueBasis: null },
    ]);
    expect(out.byStage.caveman).toEqual({ applied: 1, savings: 0, basis: null });
  });
});

describe("periodToSince", () => {
  it("returns null for all", () => {
    expect(periodToSince("all")).toBeNull();
    expect(periodToSince("bogus")).toBeNull();
  });

  it("returns an ISO timestamp roughly 7 days in the past", () => {
    const since = periodToSince("7d");
    const delta = Date.now() - new Date(since).getTime();
    expect(delta).toBeGreaterThan(6.9 * 86400000);
    expect(delta).toBeLessThan(7.1 * 86400000);
  });
});

describe("persisted metrics (real adapter)", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "miawrouter-metrics-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();
  });

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("persists cache metrics and aggregates them by period", async () => {
    const { saveMetrics, getCacheStats } = await import("@/lib/db/repos/metricsRepo.js");
    await saveMetrics([
      { kind: "cache", name: "l1", outcome: "hit", provider: "anthropic", model: "claude", ts: new Date(Date.now() - 60000).toISOString() },
      { kind: "cache", name: "l1", outcome: "miss", provider: "anthropic", model: "claude", ts: new Date().toISOString() },
      { kind: "cache", name: "l2", outcome: "bypass", provider: "anthropic", model: "claude", ts: new Date().toISOString() },
    ]);
    const stats = await getCacheStats({ period: "24h" });
    expect(stats.l1).toMatchObject({ hit: 1, miss: 1, bypass: 0, attempted: 2, hitRate: 0.5 });
    expect(stats.l2).toMatchObject({ hit: 0, miss: 0, bypass: 1 });
  });

  it("persists and aggregates L0 and L3 event counters", async () => {
    const { saveMetrics, buildCacheEventMetricRows, getCacheStats } = await import("@/lib/db/repos/metricsRepo.js");
    await saveMetrics([
      ...buildCacheEventMetricRows({ type: "cache_probe", provider: "anthropic", model: "claude" }),
      ...buildCacheEventMetricRows({ type: "cache_usage", provider: "anthropic", model: "claude", cacheRead: 80 }),
      ...buildCacheEventMetricRows({ type: "cache_usage", provider: "anthropic", model: "claude", cacheRead: 0 }),
      ...buildCacheEventMetricRows({ type: "cache_l3", action: "dedup", refs: 3, bytesSaved: 900 }),
    ]);

    const stats = await getCacheStats({ period: "24h" });
    expect(stats.layers.L0).toEqual({ probes: 1, hits: 1, readTokens: 80 });
    expect(stats.layers.L3).toEqual({ refs: 3, bytesSaved: 900 });
    expect(stats.timeline[0]).toMatchObject({ providerHits: 1 });
  });

  it("getCacheStats honors the period window", async () => {
    const { saveMetrics, getCacheStats } = await import("@/lib/db/repos/metricsRepo.js");
    await saveMetrics([
      { kind: "cache", name: "l1", outcome: "hit", ts: new Date(Date.now() - 8 * 86400000).toISOString() },
    ]);
    expect((await getCacheStats({ period: "7d" })).l1?.hit ?? 0).toBe(0);
    expect((await getCacheStats({ period: "30d" })).l1.hit).toBe(1);
  });

  it("persists saver savings and exposes provider-outcome aggregates", async () => {
    const { saveMetrics, getSaverStats } = await import("@/lib/db/repos/metricsRepo.js");
    await saveMetrics([
      { kind: "saver", name: "dispatch", outcome: "provider", provider: "openai", model: "gpt" },
      { kind: "saver", name: "rtk", outcome: "provider", value: 200, valueBasis: "bytes", provider: "openai", model: "gpt" },
      { kind: "saver", name: "pxpipe", outcome: "provider", value: 40, valueBasis: "estimate", provider: "openai", model: "gpt" },
    ]);
    const stats = await getSaverStats({ period: "7d" });
    expect(stats.dispatched).toBe(1);
    expect(stats.totals).toEqual({ bytes: 200, reported: 0, estimate: 40 });
    expect(stats.byStage.rtk.savings).toBe(200);
  });

  it("saveMetric is fail-open when the table is missing", async () => {
    const repo = await import("@/lib/db/repos/metricsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("DROP TABLE metricEvents");
    await expect(repo.saveMetric({ kind: "cache", name: "l1", outcome: "hit" })).resolves.toBe(false);
  });
});
