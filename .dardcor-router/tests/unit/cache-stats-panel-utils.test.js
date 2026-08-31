import { describe, it, expect } from "vitest";
import {
  num,
  fmt,
  fmtBytes,
  pctOf,
  mergeServerStats,
} from "@/app/(dashboard)/dashboard/components/cacheStatsUtils";

// ── num ──────────────────────────────────────────────────────────────────
describe("num", () => {
  it("returns valid non-negative numbers", () => {
    expect(num(0)).toBe(0);
    expect(num(42)).toBe(42);
    expect(num(3.14)).toBe(3.14);
    expect(num("100")).toBe(100);
  });

  it("returns null for negatives, NaN, Infinity, non-numeric", () => {
    expect(num(-1)).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
    expect(num("abc")).toBeNull();
    expect(num(undefined)).toBeNull();
  });

  it("Number(null) is 0 — treated as valid zero", () => {
    expect(num(null)).toBe(0); // Number(null) === 0
  });
});

// ── fmt ──────────────────────────────────────────────────────────────────
describe("fmt", () => {
  it("formats millions", () => {
    expect(fmt(1500000)).toBe("1.5M");
    expect(fmt(1000000)).toBe("1.0M");
  });

  it("formats thousands", () => {
    expect(fmt(1500)).toBe("1.5K");
    expect(fmt(1000)).toBe("1.0K");
  });

  it("returns raw string for sub-thousand", () => {
    expect(fmt(0)).toBe("0");
    expect(fmt(42)).toBe("42");
    expect(fmt(999)).toBe("999");
  });
});

// ── fmtBytes ─────────────────────────────────────────────────────────────
describe("fmtBytes", () => {
  it("formats megabytes", () => {
    expect(fmtBytes(2 * 1048576)).toBe("2.0 MB");
  });

  it("formats kilobytes", () => {
    expect(fmtBytes(2048)).toBe("2.0 KB");
  });

  it("returns raw bytes for sub-KB", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
  });
});

// ── pctOf ────────────────────────────────────────────────────────────────
describe("pctOf", () => {
  it("computes percentage", () => {
    expect(pctOf(50, 100)).toBe(50);
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(0, 10)).toBe(0);
  });

  it("returns null when total is zero or negative", () => {
    expect(pctOf(5, 0)).toBeNull();
    expect(pctOf(5, -1)).toBeNull();
  });
});

// ── mergeServerStats ─────────────────────────────────────────────────────
describe("mergeServerStats", () => {
  const sampleStats = (overrides = {}) => ({
    period: "7d",
    layers: {
      L0: { probes: 100, hits: 40, readTokens: 5000 },
      L1: { attempts: 80, hits: 30 },
      L2: { attempts: 60, hits: 10 },
      L3: { refs: 200, bytesSaved: 4096 },
    },
    context: {
      requests: 500,
      bypassed: 50,
      dispatched: 450,
      bypassReasons: { streaming: 30, tools: 20 },
    },
    timeline: [
      { label: "Mon", hits: 10, misses: 5, providerHits: 3 },
      { label: "Tue", hits: 15, misses: 8, providerHits: 5 },
    ],
    ...overrides,
  });

  it("returns fresh when prev is null", () => {
    const fresh = sampleStats();
    expect(mergeServerStats(null, fresh)).toBe(fresh);
  });

  it("returns prev when fresh is null or invalid", () => {
    const prev = sampleStats();
    expect(mergeServerStats(prev, null)).toBe(prev);
    expect(mergeServerStats(prev, undefined)).toBe(prev);
    expect(mergeServerStats(prev, "bad")).toBe(prev);
  });

  it("keeps running max for layer counters", () => {
    const prev = sampleStats();
    const fresh = sampleStats({
      layers: {
        L0: { probes: 90, hits: 50, readTokens: 6000 }, // probes dropped, hits/readTokens up
        L1: { attempts: 100, hits: 20 }, // attempts up, hits dropped
        L2: { attempts: 60, hits: 10 },
        L3: { refs: 150, bytesSaved: 8192 }, // refs dropped, bytes up
      },
    });

    const merged = mergeServerStats(prev, fresh);

    expect(merged.layers.L0.probes).toBe(100); // kept max
    expect(merged.layers.L0.hits).toBe(50); // took fresh (higher)
    expect(merged.layers.L0.readTokens).toBe(6000); // took fresh (higher)
    expect(merged.layers.L1.attempts).toBe(100); // took fresh (higher)
    expect(merged.layers.L1.hits).toBe(30); // kept max
    expect(merged.layers.L3.refs).toBe(200); // kept max
    expect(merged.layers.L3.bytesSaved).toBe(8192); // took fresh (higher)
  });

  it("keeps running max for context counters", () => {
    const prev = sampleStats();
    const fresh = sampleStats({
      context: {
        requests: 400, // dropped
        bypassed: 60, // up
        dispatched: 340, // dropped
        bypassReasons: { streaming: 40 },
      },
    });

    const merged = mergeServerStats(prev, fresh);

    expect(merged.context.requests).toBe(500); // kept max
    expect(merged.context.bypassed).toBe(60); // took fresh (higher)
    expect(merged.context.dispatched).toBe(450); // kept max
    expect(merged.context.bypassReasons).toEqual({ streaming: 40 }); // always takes fresh
  });

  it("uses fresh timeline when non-empty", () => {
    const prev = sampleStats();
    const newTimeline = [{ label: "Wed", hits: 20, misses: 3, providerHits: 1 }];
    const fresh = sampleStats({ timeline: newTimeline });

    const merged = mergeServerStats(prev, fresh);
    expect(merged.timeline).toEqual(newTimeline);
  });

  it("keeps prev timeline when fresh timeline is empty", () => {
    const prev = sampleStats();
    const fresh = sampleStats({ timeline: [] });

    const merged = mergeServerStats(prev, fresh);
    expect(merged.timeline).toEqual(prev.timeline);
  });

  it("handles missing layers gracefully", () => {
    const prev = { layers: { L0: { probes: 10, hits: 5 } }, context: {}, timeline: [] };
    const fresh = { layers: { L0: { probes: 8, hits: 7 } }, context: {}, timeline: [] };

    const merged = mergeServerStats(prev, fresh);
    expect(merged.layers.L0.probes).toBe(10);
    expect(merged.layers.L0.hits).toBe(7);
  });

  it("handles layers present in fresh but missing from prev", () => {
    const prev = { layers: {}, context: {}, timeline: [] };
    const fresh = {
      layers: { L1: { attempts: 20, hits: 5 } },
      context: {},
      timeline: [],
    };

    const merged = mergeServerStats(prev, fresh);
    expect(merged.layers.L1).toEqual({ attempts: 20, hits: 5 });
  });

  it("handles undefined bypassReasons edge case", () => {
    const prev = sampleStats({ context: { ...sampleStats().context, bypassReasons: undefined } });
    const fresh = sampleStats({ context: { ...sampleStats().context, bypassReasons: { tools: 5 } } });

    const merged = mergeServerStats(prev, fresh);
    expect(merged.context.bypassReasons).toEqual({ tools: 5 });
  });

  it("preserves period from fresh", () => {
    const prev = sampleStats({ period: "7d" });
    const fresh = sampleStats({ period: "30d" });

    const merged = mergeServerStats(prev, fresh);
    expect(merged.period).toBe("30d");
  });
});
