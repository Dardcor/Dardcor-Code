/**
 * tests/unit/bench-metrics.test.js — Phase 9 focused unit test for the pure
 * metric math in bench/metrics.js (percentiles, means, deltas, rounding).
 *
 * Written but intentionally NOT run in this phase; the runner executes it.
 * No network, no open-sse imports — pure function contracts only.
 */

import { describe, it, expect } from "vitest";
import {
  sum, mean, percentile, percentiles, round, safeRatio, deltaPercent, deltaPp, sortedAsc,
} from "../../bench/metrics.js";

describe("bench/metrics.js", () => {
  it("sum/mean are null for empty input", () => {
    expect(sum([])).toBe(null);
    expect(mean([])).toBe(null);
    expect(sum([1, 2, 3])).toBe(6);
    expect(mean([2, 4])).toBe(3);
  });

  it("percentile uses nearest-rank on the sorted values", () => {
    expect(percentile([3, 1, 2], 50)).toBe(2); // sorted [1,2,3], rank ceil(1.5)=2
    expect(percentile([1, 2, 3, 4], 50)).toBe(2); // rank ceil(2)=2
    expect(percentile([1, 2, 3, 4], 95)).toBe(4); // rank ceil(3.8)=4
    expect(percentile([1, 2, 3, 4], 99)).toBe(4);
    expect(percentile([], 50)).toBe(null);
  });

  it("percentiles returns p50/p95/p99/count/mean", () => {
    const p = percentiles([1, 2, 3, 4, 5]);
    expect(p.p50).toBe(3);
    expect(p.p95).toBe(5);
    expect(p.p99).toBe(5);
    expect(p.count).toBe(5);
    expect(p.mean).toBe(3);
  });

  it("sortedAsc returns a sorted copy and never mutates the input", () => {
    const input = [5, 1, 3];
    const out = sortedAsc(input);
    expect(out).toEqual([1, 3, 5]);
    expect(input).toEqual([5, 1, 3]);
  });

  it("round keeps null and respects digits", () => {
    expect(round(null)).toBe(null);
    expect(round(0.123456, 2)).toBe(0.12);
    expect(round(2.5, 0)).toBe(3);
  });

  it("safeRatio returns null when the denominator is 0", () => {
    expect(safeRatio(3, 4)).toBe(0.75);
    expect(safeRatio(3, 0)).toBe(null);
    expect(safeRatio(0, 5)).toBe(0);
  });

  it("deltaPercent is null when the base is missing or 0", () => {
    expect(deltaPercent(120, 100)).toBe(20);
    expect(deltaPercent(90, 100)).toBe(-10);
    expect(deltaPercent(5, 0)).toBe(null);
    expect(deltaPercent(null, 100)).toBe(null);
  });

  it("deltaPp computes percentage-point difference and is null-safe", () => {
    expect(deltaPp(0.9, 0.8)).toBe(0.1);
    expect(deltaPp(0.5, null)).toBe(null);
    expect(deltaPp(null, 0.5)).toBe(null);
  });
});
