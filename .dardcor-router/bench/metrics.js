/**
 * bench/metrics.js — Phase 9 pure metric math for the offline benchmark runner.
 *
 * Every function here is a pure function over numbers/arrays: no I/O, no
 * imports beyond nothing, deterministic given the same input. The runner
 * (bench/run.mjs) and report writer (bench/report.js) share these so that the
 * report, the baseline, and the verifier all agree on how a metric is computed.
 *
 * Contract notes:
 *  - Percentiles use nearest-rank: for n samples, p is sample
 *    ceil(p/100 * n) (1-based) of the sorted list. p50 of [a] is a.
 *  - All aggregation is null-safe: an empty list yields null, never NaN/0.
 *  - Deltas return null when the base is missing (so downstream code can
 *    distinguish "no comparison" from "0% change").
 */

/** Sum of an array of numbers. null for empty. */
export function sum(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let total = 0;
  for (const v of arr) total += Number(v);
  return total;
}

/** Arithmetic mean. null for empty. */
export function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return sum(arr) / arr.length;
}

/** Sort a copy numerically (stable, deterministic). */
export function sortedAsc(arr) {
  return (Array.isArray(arr) ? [...arr] : []).sort((a, b) => a - b);
}

/**
 * Nearest-rank percentile of an unsorted array.
 * @param {number[]} arr
 * @param {number} p - percentile in [0,100]
 * @returns {number|null} null for empty arrays.
 */
export function percentile(arr, p) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sorted = sortedAsc(arr);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** p50/p95/p99 of an array. Null fields for empty input. */
export function percentiles(arr, ps = [50, 95, 99]) {
  const out = {};
  for (const p of ps) out[`p${p}`] = percentile(arr, p);
  out.count = Array.isArray(arr) ? arr.length : 0;
  out.mean = mean(arr);
  return out;
}

/** Round to `digits` decimals; keeps null. */
export function round(value, digits = 3) {
  if (value === null || value === undefined) return null;
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** num/den as a fraction in [0,1]; null when den is 0 or missing. */
export function safeRatio(num, den) {
  const d = Number(den);
  if (!d) return null;
  return Number(num) / d;
}

/** Percentage change (current - base)/base * 100. null when base missing/0. */
export function deltaPercent(current, base) {
  const b = Number(base);
  if (current === null || current === undefined || !b) return null;
  return ((Number(current) - b) / b) * 100;
}

/** Percentage-point difference current - base (for rates). null when either side missing. */
export function deltaPp(current, base) {
  if (current === null || current === undefined || base === null || base === undefined) return null;
  return Number(current) - Number(base);
}

/**
 * Aggregate raw numbers into the metric shape the report consumes.
 * { count, sum, mean, p50, p95, p99 } — every field null-safe.
 */
export function aggregateNumbers(arr) {
  return percentiles(arr);
}

/** True when a number is a finite real (used to validate metric inputs). */
export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
