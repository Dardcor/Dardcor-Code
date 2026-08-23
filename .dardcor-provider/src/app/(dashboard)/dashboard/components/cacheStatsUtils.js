/**
 * Pure utility functions for CacheStatsPanel.
 * Extracted for direct unit testing.
 */

export const MAX_COUNT = 999999;

/**
 * Safe numeric coercion: returns >= 0 finite number or null.
 */
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function fmt(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function fmtBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function pctOf(hits, total) {
  if (!(total > 0)) return null;
  return Math.round((hits / total) * 100);
}

/**
 * Merge a fresh server response into any previously-cached stats so that
 * accumulated counters never decrease — the server may report a wider
 * window on the next poll but we keep the running max for each numeric field.
 */
export function mergeServerStats(prev, fresh) {
  if (!fresh || typeof fresh !== "object") return prev;
  if (!prev) return fresh;

  const maxNum = (a, b) => {
    const an = num(a);
    const bn = num(b);
    if (an === null && bn === null) return null;
    if (an === null) return bn;
    if (bn === null) return an;
    return Math.max(an, bn);
  };

  const mergeLayer = (p, f) => {
    if (!p && !f) return undefined;
    if (!p) return f;
    if (!f) return p;
    const out = { ...p };
    for (const k of Object.keys(f)) {
      out[k] = maxNum(p[k], f[k]) ?? f[k];
    }
    return out;
  };

  return {
    ...fresh,
    layers: {
      L0: mergeLayer(prev.layers?.L0, fresh.layers?.L0),
      L1: mergeLayer(prev.layers?.L1, fresh.layers?.L1),
      L2: mergeLayer(prev.layers?.L2, fresh.layers?.L2),
      L3: mergeLayer(prev.layers?.L3, fresh.layers?.L3),
    },
    context: {
      requests: maxNum(prev.context?.requests, fresh.context?.requests) ?? fresh.context?.requests,
      bypassed: maxNum(prev.context?.bypassed, fresh.context?.bypassed) ?? fresh.context?.bypassed,
      dispatched: maxNum(prev.context?.dispatched, fresh.context?.dispatched) ?? fresh.context?.dispatched,
      bypassReasons: fresh.context?.bypassReasons || prev.context?.bypassReasons || {},
    },
    timeline: Array.isArray(fresh.timeline) && fresh.timeline.length > 0 ? fresh.timeline : prev.timeline,
  };
}
