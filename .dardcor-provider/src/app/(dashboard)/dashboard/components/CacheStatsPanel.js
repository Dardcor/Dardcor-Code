"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import Card from "@/shared/components/Card";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { num, fmt, fmtBytes, pctOf, mergeServerStats } from "./cacheStatsUtils";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const POLL_MS = 30_000; // background poll to keep stats fresh
const STORAGE_KEY = "miawrouter.cacheStatsPanel.v1";

const LAYER_META = {
  L0: { name: "Provider L0", note: "prompt cache · provider-confirmed" },
  L1: { name: "Exact L1", note: "local response cache" },
  L2: { name: "Semantic L2", note: "local semantic cache" },
  L3: { name: "Dedup L3", note: "content-address · not a provider hit" },
};

function storageKey(period) {
  return `${STORAGE_KEY}.${period}`;
}

function loadPersisted(period) {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(period));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistStats(period, stats) {
  if (typeof window === "undefined" || !stats) return;
  try {
    sessionStorage.setItem(storageKey(period), JSON.stringify(stats));
  } catch {
    // best-effort
  }
}

function LayerCard({ layer, meta, hits, total, sub, rateLabel, title }) {
  const pct = pctOf(hits, total);
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-brand)] border p-3 bg-chassis"
      style={{ borderColor: "var(--color-rule)" }}
      title={title}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{meta.name}</span>
      <span className="text-[10px] leading-tight text-muted">{meta.note}</span>
      <div className="flex items-baseline gap-1">
        <span className={`font-mono tabular-nums text-lg font-semibold ${pct === null ? "text-ink" : "text-signal"}`}>
          {pct === null ? "—" : `${pct}%`}
        </span>
        <span className="font-mono tabular-nums text-[10px] text-muted">{rateLabel}</span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={pct === null ? `${meta.name}: no data` : `${meta.name} hit rate ${pct}%`}
      >
        {pct !== null && (
          <span className="bg-signal" style={{ width: `${pct}%` }} aria-hidden="true" />
        )}
      </div>
      <span className="font-mono tabular-nums text-[10px] text-muted">{sub}</span>
    </div>
  );
}

export default function CacheStatsPanel({ period: periodProp, setPeriod: setPeriodProp }) {
  const [periodLocal, setPeriodLocal] = useState(periodProp || "7d");
  const setPeriod = setPeriodProp ?? setPeriodLocal;
  const activePeriod = periodProp ?? periodLocal;

  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const hydratedRef = useRef(false);

  // Hydrate from sessionStorage on mount (once)
  useEffect(() => {
    if (hydratedRef.current) return;
    const stored = loadPersisted(activePeriod);
    if (stored) {
      setStats(stored);
      setStatus("ready");
    }
    hydratedRef.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist stats whenever they change
  useEffect(() => {
    if (!hydratedRef.current) return;
    persistStats(activePeriod, stats);
  }, [activePeriod, stats]);

  // Fetch from server; merge into existing stats so live counters don't drop.
  // Uses functional updater so we never need `stats` in the dependency array.
  const fetchStats = useCallback(async ({ showRefresh = false } = {}) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/cache/stats?period=${activePeriod}`, { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      if (data) {
        setStats((prev) => mergeServerStats(prev, data));
        setStatus("ready");
      } else {
        // Only show error if we have no existing data at all
        setStatus((prev) => (prev === "ready" ? "ready" : "error"));
        setError("Cache metrics are not available yet.");
      }
    } catch {
      setStatus((prev) => (prev === "ready" ? "ready" : "error"));
      setError("Failed to load cache metrics.");
    } finally {
      setRefreshing(false);
    }
  }, [activePeriod]);

  // Initial load + on period/retry change
  useEffect(() => {
    // If we already hydrated valid data for this period, skip the loading state
    const stored = loadPersisted(activePeriod);
    if (stored && retryKey === 0) {
      setStats(stored);
      setStatus("ready");
      // Still fetch fresh data in the background
      fetchStats();
    } else {
      setStatus("loading");
      setStats(null);
      fetchStats();
    }
  }, [activePeriod, retryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background poll to keep stats fresh
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      fetchStats();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  // Subscribe to cache SSE events — trigger a refresh when cache activity arrives
  useEffect(() => {
    let debounceTimer = null;
    const es = new EventSource("/api/events?type=cache");
    es.onmessage = () => {
      // Debounce: multiple events may arrive in bursts
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchStats(), 2000);
    };
    es.onerror = () => {
      // EventSource will auto-reconnect; no action needed
    };
    return () => {
      es.close();
      clearTimeout(debounceTimer);
    };
  }, [fetchStats]);

  const layers = stats?.layers || {};
  const ctx = stats?.context || {};
  const timeline = Array.isArray(stats?.timeline) ? stats.timeline : [];

  const l0 = layers.L0 || {};
  const l1 = layers.L1 || {};
  const l2 = layers.L2 || {};
  const l3 = layers.L3 || {};

  const l0Hits = num(l0.hits);
  const l0Probes = num(l0.probes);
  const l1Hits = num(l1.hits);
  const l1Attempts = num(l1.attempts);
  const l2Hits = num(l2.hits);
  const l2Attempts = num(l2.attempts);
  const l3Refs = num(l3.refs);
  const l3Bytes = num(l3.bytesSaved);

  const requests = num(ctx.requests);
  const bypassed = num(ctx.bypassed);
  const dispatched = num(ctx.dispatched);
  const reasons = ctx.bypassReasons && typeof ctx.bypassReasons === "object" ? ctx.bypassReasons : {};

  const hasAny =
    (l0Hits !== null && l0Probes !== null) ||
    l1Hits !== null ||
    l2Hits !== null ||
    l3Refs !== null ||
    requests !== null ||
    timeline.length > 0;

  const hasTimeline = timeline.some((t) => Number(t.hits) > 0 || Number(t.misses) > 0 || Number(t.providerHits) > 0);

  const chartData = timeline.map((t) => ({
    label: t.label ?? "",
    "Local hits": num(t.hits) ?? 0,
    Misses: num(t.misses) ?? 0,
    "Provider reads": num(t.providerHits) ?? 0,
  }));

  const handleManualRefresh = () => {
    fetchStats({ showRefresh: true });
  };

  return (
    <Card
      title="Cache stats"
      subtitle={`Hit/miss rates and timeline · ${activePeriod}`}
      padding="sm"
      action={
        <div className="flex items-center gap-2">
          <SegmentedControl
            ariaLabel="Cache stats period"
            options={PERIODS}
            value={activePeriod}
            onChange={setPeriod}
            size="sm"
          />
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            style={{ borderColor: "var(--color-rule)" }}
            aria-label="Refresh cache stats"
            title="Refresh now"
          >
            <span
              className={`material-symbols-outlined text-[14px] ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            >
              {refreshing ? "progress_activity" : "refresh"}
            </span>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      }
    >
      {status === "loading" && (
        <div className="flex h-40 items-center justify-center text-sm text-muted" role="status" aria-live="polite">
          Loading cache stats…
        </div>
      )}
      {status === "error" && (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 rounded-[var(--radius-brand)] border p-6 text-sm text-fail"
          style={{ borderColor: "var(--color-rule)" }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            className="rounded-md border px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
            style={{ borderColor: "var(--color-rule)" }}
          >
            Retry
          </button>
        </div>
      )}
      {status === "ready" && !hasAny && (
        <div
          className="flex h-24 items-center justify-center rounded-[var(--radius-brand)] border p-4 text-sm text-muted"
          style={{ borderColor: "var(--color-rule)" }}
          role="status"
        >
          No cache events recorded for this period.
        </div>
      )}
      {status === "ready" && hasAny && (
        <div className="flex flex-col gap-4" role="group" aria-label="Cache hit/miss stats">
          {/* Layer hit rates */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <LayerCard
              layer="L0"
              meta={LAYER_META.L0}
              hits={l0Hits ?? 0}
              total={l0Probes ?? 0}
              rateLabel="hit rate"
              title={`L0: ${fmt(l0Hits ?? 0)} provider-confirmed cache hits out of ${fmt(l0Probes ?? 0)} probes; ${fmtBytes(num(l0.readTokens) ?? 0)} cache_read tokens`}
              sub={`${fmt(l0Hits ?? 0)} hits / ${fmt(l0Probes ?? 0)} probes · ${fmtBytes(num(l0.readTokens) ?? 0)} read`}
            />
            <LayerCard
              layer="L1"
              meta={LAYER_META.L1}
              hits={l1Hits ?? 0}
              total={l1Attempts ?? 0}
              rateLabel="hit rate"
              title="L1 exact-match response cache: hits out of attempts"
              sub={`${fmt(l1Hits ?? 0)} / ${fmt(l1Attempts ?? 0)} attempts`}
            />
            <LayerCard
              layer="L2"
              meta={LAYER_META.L2}
              hits={l2Hits ?? 0}
              total={l2Attempts ?? 0}
              rateLabel="hit rate"
              title="L2 semantic response cache: hits out of attempts"
              sub={`${fmt(l2Hits ?? 0)} / ${fmt(l2Attempts ?? 0)} attempts`}
            />
            <div
              className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-brand)] border p-3 bg-chassis"
              style={{ borderColor: "var(--color-rule)" }}
              title="L3 content-address dedup — activity and bytes saved, not a provider cache hit"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{LAYER_META.L3.name}</span>
              <span className="text-[10px] leading-tight text-muted">{LAYER_META.L3.note}</span>
              <div className="flex items-baseline gap-1">
                <span className="font-mono tabular-nums text-lg font-semibold text-ink">{fmt(l3Refs ?? 0)}</span>
                <span className="font-mono tabular-nums text-[10px] text-muted">refs</span>
              </div>
              <div className="flex h-2 w-full rounded-full bg-surface-2" aria-hidden="true" />
              <span className="font-mono tabular-nums text-[10px] text-muted">
                {fmtBytes(l3Bytes ?? 0)} saved
              </span>
            </div>
          </div>

          {/* Context / bypass */}
          <div
            className="flex flex-col gap-1.5 rounded-[var(--radius-brand)] border p-3 bg-chassis"
            style={{ borderColor: "var(--color-rule)" }}
            role="group"
            aria-label="Cache bypass and dispatch context"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Context</span>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="font-mono tabular-nums text-[11px] text-muted">
                evaluated <span className="text-ink">{fmt(requests ?? 0)}</span>
              </span>
              <span className="font-mono tabular-nums text-[11px] text-muted">
                bypassed <span className="text-warn">{fmt(bypassed ?? 0)}</span>
              </span>
              <span className="font-mono tabular-nums text-[11px] text-muted">
                dispatched <span className="text-signal">{fmt(dispatched ?? 0)}</span>
              </span>
            </div>
            {Object.keys(reasons).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted">bypass reasons:</span>
                {Object.entries(reasons).map(([reason, count]) => (
                  <span
                    key={reason}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono tabular-nums text-[10px] text-muted"
                    style={{ borderColor: "var(--color-rule)" }}
                  >
                    {reason} · {fmt(num(count) ?? 0)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Timeline</span>
            {!hasTimeline ? (
              <p className="rounded-[var(--radius-brand)] border p-3 text-xs text-muted" style={{ borderColor: "var(--color-rule)" }} role="status">
                No per-bucket timeline recorded for this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200} aria-label="Cache hits, misses and provider cache reads over time">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value, name) => [fmt(Number(value) || 0), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="Local hits" stackId="a" fill="var(--color-signal)" />
                  <Bar dataKey="Misses" stackId="a" fill="var(--color-rule)" />
                  <Bar dataKey="Provider reads" stackId="a" fill="var(--color-warn)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <p className="text-[10px] text-muted" style={{ opacity: 0.85 }}>
            L1/L2 are local response-cache hits. L0 is provider-confirmed cache_read usage — token savings at the
            provider level. L3 dedup is activity, not a provider cache hit. Hit rates are computed from recorded
            attempts; no values are estimated.
          </p>
        </div>
      )}
    </Card>
  );
}
