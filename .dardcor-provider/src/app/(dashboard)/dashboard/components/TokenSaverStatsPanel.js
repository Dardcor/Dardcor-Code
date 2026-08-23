"use client";

import { useState, useEffect } from "react";
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

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const fmt = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};
const fmtBytes = (n) => {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// estimate: savings require bytes/context → token conversion. reported: deltas measured end to end.
const STAGES = [
  { id: "caveman", label: "Caveman", note: "system inject", estimate: false, badge: "reported" },
  { id: "ponytail", label: "Ponytail", note: "system inject", estimate: false, badge: "reported" },
  { id: "rtk", label: "RTK", note: "tool_result", estimate: true, badge: "est." },
  { id: "headroom", label: "Headroom", note: "proxy", estimate: false, badge: "proxy" },
  { id: "pxpipe", label: "PXPIPE", note: "image ctx", estimate: true, badge: "est." },
];

function pctOf(saved, total) {
  if (!(total > 0)) return null;
  return Math.round((saved / total) * 100);
}

function StageRow({ meta, st, maxSaved }) {
  const tokensBefore = num(st?.tokensBefore);
  const tokensAfter = num(st?.tokensAfter);
  const bytesBefore = num(st?.bytesBefore);
  const bytesAfter = num(st?.bytesAfter);
  const hits = num(st?.hits);
  const requests = num(st?.requests);
  const recordedSavings = num(st?.savings);

  // Prefer token deltas; fall back to bytes (RTK) — unit is shown explicitly.
  const hasTokens = tokensBefore !== null && tokensAfter !== null;
  const hasBytes = bytesBefore !== null && bytesAfter !== null;
  const before = hasTokens ? tokensBefore : bytesBefore;
  const after = hasTokens ? tokensAfter : bytesAfter;
  const unit = hasTokens ? "tok" : "B";
  const saved = recordedSavings !== null
    ? recordedSavings
    : before !== null && after !== null ? Math.max(0, before - after) : null;
  const pct = saved !== null && before !== null && before > 0 ? Math.round((saved / before) * 100) : null;
  const ofTotal = pctOf(saved, maxSaved);
  const showSaved = (n) => (unit === "B" ? fmtBytes(n) : fmt(n));

  const parts = [];
  if (requests !== null) parts.push(`${fmt(requests)} req`);
  if (hits !== null) parts.push(`${fmt(hits)} hits`);
  const metaLine = parts.join(" · ") || meta.note;

  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-brand)] border p-2.5 bg-chassis"
      style={{ borderColor: "var(--color-rule)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {meta.label}
          <span
            className={`rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-normal ${
              meta.estimate ? "border-warn/60 text-warn" : "text-muted"
            }`}
            style={!meta.estimate ? { borderColor: "var(--color-rule)" } : undefined}
            title={
              meta.estimate
                ? "Estimated: bytes/context converted to tokens"
                : meta.badge === "proxy"
                  ? "Proxy-reported token counts"
                  : "Measured end-to-end deltas"
            }
          >
            {meta.badge}
          </span>
        </span>
        <span className="truncate font-mono tabular-nums text-[9px] text-muted">{metaLine}</span>
      </div>
      {before === null || after === null ? (
        <p className="text-[10px] text-muted">No savings recorded for this period.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-1">
            <span className="font-mono tabular-nums text-base font-semibold text-ink">
              {saved !== null ? `−${showSaved(saved)}` : "—"}
            </span>
            <span className="font-mono tabular-nums text-[10px] text-muted">{unit} saved</span>
            {pct !== null && (
              <span className="ml-auto font-mono tabular-nums text-[10px] text-muted">−{pct}%</span>
            )}
          </div>
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
            role="img"
            aria-label={
              saved !== null ? `${meta.label}: ${showSaved(saved)} ${unit} saved` : `${meta.label}: no savings`
            }
          >
            {saved !== null && ofTotal !== null && (
              <span
                className={meta.estimate ? "bg-warn" : "bg-signal"}
                style={{ width: `${ofTotal}%` }}
                aria-hidden="true"
              />
            )}
          </div>
          <span className="font-mono tabular-nums text-[9px] text-muted">
            {showSaved(before)} → {showSaved(after)} {unit}
            {ofTotal !== null && ` · ${ofTotal}% of max stage`}
          </span>
        </>
      )}
    </div>
  );
}

export default function TokenSaverStatsPanel({ period: periodProp, setPeriod: setPeriodProp }) {
  const [periodLocal, setPeriodLocal] = useState(periodProp || "7d");
  const setPeriod = setPeriodProp ?? setPeriodLocal;
  const activePeriod = periodProp ?? periodLocal;
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/saver/stats?period=${activePeriod}`, { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (data) {
          setStats(data);
          setStatus("ready");
        } else {
          setStatus("error");
          setError("Token-saver metrics are not available yet.");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setError("Failed to load token-saver metrics.");
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activePeriod, retryKey]);

  const stages = stats?.stages || {};
  const provider = stats?.provider || {};
  const totals = stats?.totals || {};
  const timeline = Array.isArray(stats?.timeline) ? stats.timeline : [];
  const dispatched = num(provider.dispatched);

  // Per-stage saved values in a common unit (tokens; bytes for RTK without token deltas).
  const savedOf = (meta) => {
    const st = stages[meta.id];
    if (!st) return null;
    if (num(st.savings) !== null) return num(st.savings);
    const tb = num(st.tokensBefore);
    const ta = num(st.tokensAfter);
    if (tb !== null && ta !== null) return Math.max(0, tb - ta);
    const bb = num(st.bytesBefore);
    const ba = num(st.bytesAfter);
    return bb !== null && ba !== null ? Math.max(0, bb - ba) : null;
  };
  const savedAll = STAGES.map((m) => savedOf(m)).filter((v) => v !== null);
  const maxSaved = savedAll.length ? Math.max(...savedAll) : null;

  const savedTokens = num(totals.savedTokens);
  const estimatedTokens = num(totals.estimatedTokens);
  const hasAny = savedAll.length > 0 || dispatched !== null || timeline.length > 0;
  const hasTimeline = timeline.some((t) => Number(t.savedTokens) > 0 || Number(t.estimated) > 0);

  const chartData = timeline.map((t) => ({
    label: t.label ?? "",
    Reported: num(t.savedTokens) ?? 0,
    Estimated: num(t.estimated) ?? 0,
  }));

  return (
    <Card
      title="Token saver savings"
      subtitle="Weighted savings by stage and timeline"
      padding="sm"
      action={
        <SegmentedControl
          ariaLabel="Token saver period"
          options={PERIODS}
          value={activePeriod}
          onChange={setPeriod}
          size="sm"
        />
      }
    >
      {status === "loading" && (
        <div className="flex h-40 items-center justify-center text-sm text-muted" role="status" aria-live="polite">
          Loading token-saver stats…
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
          No token-saver events recorded for this period.
        </div>
      )}
      {status === "ready" && hasAny && (
        <div className="flex flex-col gap-4" role="group" aria-label="Token-saver savings by stage">
          {/* Per-stage savings */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {STAGES.map((meta) => (
              <StageRow key={meta.id} meta={meta} st={stages[meta.id]} maxSaved={maxSaved} />
            ))}
          </div>

          {/* Weighted totals */}
          <div
            className="flex flex-col gap-1.5 rounded-[var(--radius-brand)] border p-3 bg-chassis"
            style={{ borderColor: "var(--color-rule)" }}
            role="group"
            aria-label="Weighted savings totals"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Weighted total</span>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="font-mono tabular-nums text-[11px] text-muted">
                saved <span className="text-signal">{savedTokens !== null ? `−${fmt(savedTokens)} tok` : "—"}</span>
              </span>
              <span className="font-mono tabular-nums text-[11px] text-muted">
                of which estimated <span className="text-warn">{estimatedTokens !== null ? `${fmt(estimatedTokens)} tok` : "—"}</span>
              </span>
              <span className="font-mono tabular-nums text-[11px] text-muted">
                provider-dispatched <span className="text-ink">{dispatched !== null ? fmt(dispatched) : "—"}</span>
              </span>
            </div>
            <p className="text-[10px] text-muted" style={{ opacity: 0.85 }}>
              Weighted by stage: bars scale to the largest recorded stage savings for the period.
            </p>
          </div>

          {/* Timeline */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Timeline</span>
            {!hasTimeline ? (
              <p className="rounded-[var(--radius-brand)] border p-3 text-xs text-muted" style={{ borderColor: "var(--color-rule)" }} role="status">
                No per-bucket timeline recorded for this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200} aria-label="Token savings over time, reported and estimated">
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
                  <Bar dataKey="Reported" stackId="s" fill="var(--color-signal)" />
                  <Bar dataKey="Estimated" stackId="s" fill="var(--color-warn)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <p className="text-[10px] text-muted" style={{ opacity: 0.85 }}>
            RTK and PXPIPE savings are estimates (bytes/context converted to tokens); Headroom counts are
            proxy-reported. Savings are counted only for provider-dispatched requests — requests answered by the
            cache are excluded.
          </p>
        </div>
      )}
    </Card>
  );
}
