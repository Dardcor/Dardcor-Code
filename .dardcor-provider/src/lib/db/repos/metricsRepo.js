// Persistent cache hit/miss/bypass + token-saver savings metrics. Append-only,
// fail-open: every write/read here swallows errors and never throws, so metric
// failures can never break a request. No secrets are ever stored (provider /
// model only).
import { getAdapter } from "../driver.js";

const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

let lastWarnTs = 0;
function logThrottled(e) {
  const now = Date.now();
  if (now - lastWarnTs > 30000) {
    lastWarnTs = now;
    console.warn("[metrics] write/read failed:", e?.message || e);
  }
}

const round4 = (n) => Math.round(n * 10000) / 10000;

export function periodToSince(period = "7d") {
  if (!period || period === "all") return null;
  if (period === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const ms = PERIOD_MS[period];
  return ms ? new Date(Date.now() - ms).toISOString() : null;
}

// Per-layer cache lookup decision rows. Attempted lookups (hit/miss) are what
// hit-rate is computed over; ineligible requests are marked "bypass", never
// "miss". Streaming requests and fully-disabled caches produce no rows.
export function buildCacheMetricRows({ stream = false, cacheable = false, l1On = false, l2On = false, l1Hit = false, l2Hit = false, l2Attempted = true, provider = null, model = null } = {}) {
  const rows = [];
  if (stream || (!l1On && !l2On)) return rows;
  const base = { kind: "cache", provider: provider || null, model: model || null };
  if (!cacheable) {
    if (l1On) rows.push({ ...base, name: "l1", outcome: "bypass" });
    if (l2On) rows.push({ ...base, name: "l2", outcome: "bypass" });
    return rows;
  }
  if (l1On) rows.push({ ...base, name: "l1", outcome: l1Hit ? "hit" : "miss" });
  if (l2On && !l1Hit) {
    rows.push({ ...base, name: "l2", outcome: l2Attempted ? (l2Hit ? "hit" : "miss") : "bypass" });
  }
  return rows;
}

// Convert the existing realtime L0/L3 cache events into append-only counters.
// L3 uses separate rows because refs (count) and saved bytes are different units.
export function buildCacheEventMetricRows(event) {
  if (!event || typeof event !== "object") return [];
  const base = { kind: "cache", provider: event.provider || null, model: event.model || null };
  if (event.type === "cache_probe") {
    return [{ ...base, name: "l0", outcome: "probe" }];
  }
  if (event.type === "cache_usage") {
    const readTokens = Number(event.cacheRead);
    if (!Number.isFinite(readTokens) || readTokens < 0) return [];
    return [{ ...base, name: "l0", outcome: readTokens > 0 ? "hit" : "miss", value: readTokens, valueBasis: "tokens" }];
  }
  if (event.type !== "cache_l3" || event.action !== "dedup") return [];
  const rows = [];
  const refs = Number(event.refs);
  const bytes = Number(event.bytesSaved);
  if (Number.isFinite(refs) && refs > 0) rows.push({ ...base, name: "l3_refs", outcome: "dedup", value: refs, valueBasis: "count" });
  if (Number.isFinite(bytes) && bytes > 0) rows.push({ ...base, name: "l3_bytes", outcome: "dedup", value: bytes, valueBasis: "bytes" });
  return rows;
}

// Per-stage saver savings for a provider-dispatched request. Every stage maps
// to its own row carrying its own basis so no aggregation ever mixes bytes
// with tokens or reported with estimated figures. Applied-only stages
// (caveman/ponytail) are recorded with value null.
const SAVER_BASES = {
  rtk: (s) => {
    const before = Number(s.bytesBefore);
    const after = Number(s.bytesAfter);
    if (!Number.isFinite(before) || !Number.isFinite(after) || after < 0) return null;
    const saved = before - after;
    return saved > 0 ? { value: saved, basis: "bytes" } : null;
  },
  headroom: (s) => {
    const reported = Number(s.tokensSaved);
    if (Number.isFinite(reported) && reported > 0) return { value: reported, basis: "reported" };
    const before = Number(s.tokensBefore);
    const after = Number(s.tokensAfter);
    if (!Number.isFinite(before) || !Number.isFinite(after) || after < 0) return null;
    const saved = before - after;
    return saved > 0 ? { value: saved, basis: "reported" } : null;
  },
  pxpipe: (s) => {
    const est = Number(s.tokensSavedEst);
    return Number.isFinite(est) && est > 0 ? { value: est, basis: "estimate" } : null;
  },
};

export function buildSaverMetricRows(stages = [], { provider = null, model = null } = {}) {
  const rows = [];
  for (const s of stages || []) {
    const stage = s && s.stage;
    if (!stage || stage === "provider") continue;
    const row = { kind: "saver", name: stage, outcome: "provider", provider: provider || null, model: model || null, value: null, valueBasis: null };
    const calc = SAVER_BASES[stage];
    const r = calc && calc(s);
    if (r) {
      row.value = r.value;
      row.valueBasis = r.basis;
    }
    rows.push(row);
  }
  return rows;
}

// Pure aggregation over cache rows → per-layer { hit, miss, bypass, attempted, hitRate, missRate }.
// Attempted = hit + miss (bypasses are NOT misses and never touch hit-rate).
export function aggregateCacheMetrics(rows = []) {
  const out = {};
  for (const r of rows) {
    if (!r || (r.kind && r.kind !== "cache") || !r.name) continue;
    const o = out[r.name] ||= { hit: 0, miss: 0, bypass: 0, attempted: 0, hitRate: 0, missRate: 0 };
    if (r.outcome === "hit") o.hit += 1;
    else if (r.outcome === "miss") o.miss += 1;
    else if (r.outcome === "bypass") o.bypass += 1;
  }
  for (const o of Object.values(out)) {
    o.attempted = o.hit + o.miss;
    o.hitRate = o.attempted > 0 ? round4(o.hit / o.attempted) : 0;
    o.missRate = o.attempted > 0 ? round4(o.miss / o.attempted) : 0;
  }
  return out;
}

// Pure aggregation over saver rows → dispatched count, per-stage applied +
// savings, and totals split by basis so mixed units are never summed.
// Savings count ONLY rows whose outcome is "provider".
export function aggregateSaverMetrics(rows = []) {
  const out = { dispatched: 0, byStage: {}, totals: { bytes: 0, reported: 0, estimate: 0 }, byBasis: {} };
  for (const r of rows) {
    if (!r || (r.kind && r.kind !== "saver") || !r.name) continue;
    if (r.name === "dispatch") {
      if (r.outcome === "provider") out.dispatched += 1;
      continue;
    }
    if (r.outcome !== "provider") continue;
    const st = out.byStage[r.name] ||= { applied: 0, savings: 0, basis: r.valueBasis || null };
    st.applied += 1;
    const v = Number(r.value);
    if (Number.isFinite(v) && v > 0 && r.valueBasis) {
      st.savings = round4(st.savings + v);
      out.totals[r.valueBasis] = round4((out.totals[r.valueBasis] || 0) + v);
      const bucket = (out.byBasis[r.valueBasis] ||= { count: 0, value: 0 });
      bucket.count += 1;
      bucket.value = round4(bucket.value + v);
    }
  }
  return out;
}

function insertMetricRow(db, row) {
  if (!row || !row.kind || !row.name || !row.outcome) return false;
  db.run(
    `INSERT INTO metricEvents(ts, kind, name, outcome, provider, model, value, valueBasis) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.ts || new Date().toISOString(),
      row.kind,
      row.name,
      row.outcome,
      row.provider || null,
      row.model || null,
      row.value == null ? null : Number(row.value),
      row.valueBasis || null,
    ]
  );
  return true;
}

export async function saveMetrics(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  try {
    const db = await getAdapter();
    db.transaction(() => {
      for (const row of rows) insertMetricRow(db, row);
    });
    return true;
  } catch (e) {
    logThrottled(e);
    return false;
  }
}

export async function saveMetric(row) {
  return saveMetrics(row ? [row] : []);
}

async function queryRows(kind, { period = "7d", provider = null, model = null } = {}) {
  try {
    const db = await getAdapter();
    const conds = ["kind = ?"];
    const params = [kind];
    const since = periodToSince(period);
    if (since) {
      conds.push("ts >= ?");
      params.push(since);
    }
    if (provider) {
      conds.push("provider = ?");
      params.push(provider);
    }
    if (model) {
      conds.push("model = ?");
      params.push(model);
    }
    return db.all(`SELECT ts, name, outcome, provider, model, value, valueBasis FROM metricEvents WHERE ${conds.join(" AND ")} ORDER BY ts ASC`, params);
  } catch (e) {
    logThrottled(e);
    return [];
  }
}

export async function getCacheStats(filter = {}) {
  const rows = await queryRows("cache", filter);
  const raw = aggregateCacheMetrics(rows);
  const layer = (name) => {
    const item = raw[name] || {};
    return {
      hits: item.hit || 0,
      misses: item.miss || 0,
      bypass: item.bypass || 0,
      attempts: item.attempted || 0,
      hitRate: item.hitRate || 0,
    };
  };
  const timeline = new Map();
  for (const row of rows) {
    const label = String(row.ts || "").slice(0, 10);
    if (!label) continue;
    const bucket = timeline.get(label) || { label, hits: 0, misses: 0, providerHits: 0 };
    if ((row.name === "l1" || row.name === "l2") && row.outcome === "hit") bucket.hits += 1;
    if ((row.name === "l1" || row.name === "l2") && row.outcome === "miss") bucket.misses += 1;
    if (row.name === "l0" && row.outcome === "hit") bucket.providerHits += 1;
    timeline.set(label, bucket);
  }
  const sumValues = (name) => rows.reduce((total, row) => row.name === name ? total + (Number(row.value) || 0) : total, 0);
  const l0 = rows.filter((row) => row.name === "l0");
  const localRows = rows.filter((row) => row.name === "l1" || row.name === "l2");
  const bypassReasons = {};
  for (const row of rows) if (row.outcome === "bypass") bypassReasons[row.name] = (bypassReasons[row.name] || 0) + 1;
  const visual = {
    period: filter.period || "7d",
    layers: {
      L0: {
        probes: l0.filter((row) => row.outcome === "probe").length,
        hits: l0.filter((row) => row.outcome === "hit").length,
        readTokens: sumValues("l0"),
      },
      L1: layer("l1"),
      L2: layer("l2"),
      L3: { refs: sumValues("l3_refs"), bytesSaved: sumValues("l3_bytes") },
    },
    context: {
      requests: localRows.length,
      bypassed: localRows.filter((row) => row.outcome === "bypass").length,
      dispatched: localRows.filter((row) => row.outcome === "miss").length,
      bypassReasons,
    },
    timeline: [...timeline.values()],
  };
  return { ...raw, ...visual };
}

export async function getSaverStats(filter = {}) {
  const rows = await queryRows("saver", filter);
  const raw = aggregateSaverMetrics(rows);
  const stages = {};
  for (const [name, item] of Object.entries(raw.byStage)) {
    stages[name] = {
      requests: item.applied,
      savings: item.savings,
      valueBasis: item.basis,
      bytesBefore: item.basis === "bytes" ? item.savings : null,
      bytesAfter: item.basis === "bytes" ? 0 : null,
    };
  }
  return raw;
}
