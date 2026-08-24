"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/shared/components";

const MAX_COUNT = 999999;
const STORAGE_KEY = "dardcor-code.tokenSaverWire.v1"; // versioned — bump to discard stale sessionStorage payloads
const ACT_MS = 480;
const STAGE_IDS = ["caveman", "ponytail", "rtk", "headroom", "pxpipe", "provider"];
const STAGE_IDX = { caveman: 1, ponytail: 2, rtk: 3, headroom: 4, pxpipe: 5, provider: 6 }; // pipeline order past Client
const STAGES = [
  { id: "caveman", label: "Caveman", sub: "system inject", icon: "bolt" },
  { id: "ponytail", label: "Ponytail", sub: "system inject", icon: "bolt" },
  { id: "rtk", label: "RTK", sub: "tool_result", icon: "compress" },
  { id: "headroom", label: "Headroom", sub: "proxy", icon: "filter_alt" },
  { id: "pxpipe", label: "PXPIPE", sub: "image ctx", icon: "swap_vert" },
];
// Funnel: chips taper toward the provider, echoing the pipeline rail.
const FUNNEL_W = { caveman: 58, ponytail: 56, rtk: 46, headroom: 58, pxpipe: 52 };

const fmt = (n) => (n >= MAX_COUNT ? `${MAX_COUNT}+` : String(n));
const fmtBytes = (n) => {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};
const fmtTk = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const sstr = (v, max = 120) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
// Derived percentage — only from the actual bytes/tokens this stage reported.
const pctOf = (before, after) => {
  if (!(before > 0) || after === null || after >= before) return null;
  const p = Math.round((1 - after / before) * 100);
  return p > 0 ? p : null;
};

function timeOf(ts) {
  const ms = Number(ts);
  const d = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// Readable, always-visible status text for each stage — never animation-dependent.
function stageBadge(stage, st, config) {
  const configured = config?.[stage];
  switch (stage) {
    case "caveman":
    case "ponytail": {
      const m = st[stage];
      if (configured?.enabled === false) return "off";
      if (m && m.level) return `on · ${m.level}`;
      return configured?.enabled ? `on · ${configured.level}` : "—";
    }
    case "rtk": {
      if (configured?.enabled === false) return "off";
      const { hits, bytesBefore, bytesAfter } = st.rtk;
      const parts = [];
      if (hits > 0) parts.push(`${fmt(hits)} hits`);
      if (bytesBefore !== null && bytesAfter !== null) {
        const p = pctOf(bytesBefore, bytesAfter);
        parts.push(`${fmtBytes(bytesBefore)} → ${fmtBytes(bytesAfter)}${p !== null ? ` · −${p}%` : ""}`);
      }
      if (!parts.length) return configured?.enabled ? `on · ${configured.mode || "standard"}` : "—";
      return parts.join(" · ");
    }
    case "headroom": {
      if (configured?.enabled === false) return "off";
      const m = st.headroom;
      if (!m) return configured?.enabled ? "enabled" : "—";
      if (!m.applied) return m.reason || "skipped";
      const parts = [];
      if (m.bodyBefore !== null && m.bodyAfter !== null) parts.push(`body ${fmtBytes(m.bodyBefore)} → ${fmtBytes(m.bodyAfter)}`);
      if (m.tokensBefore !== null && m.tokensAfter !== null) parts.push(`proxy ${fmtTk(m.tokensBefore)} → ${fmtTk(m.tokensAfter)}`);
      return parts.length ? parts.join(" · ") : "applied";
    }
    case "pxpipe": {
      if (configured?.enabled === false) return "off";
      const m = st.pxpipe;
      if (!m) return configured?.enabled ? "enabled" : "—";
      if (!m.applied) return m.reason || "skipped";
      const parts = [];
      if (m.savedPct !== null) parts.push(`est. −${Math.round(m.savedPct)}%`);
      if (m.tokensBeforeEst !== null && m.tokensAfterEst !== null) parts.push(`${fmtTk(m.tokensBeforeEst)} → ${fmtTk(m.tokensAfterEst)}`);
      if (m.imageCount !== null) parts.push(`${m.imageCount} img`);
      return parts.length ? parts.join(" · ") : "applied";
    }
    default:
      return "";
  }
}

function StageNode({ stage, badge, enabled, active, kind }) {
  return (
    <div
      className={`tsw-chip relative flex shrink-0 flex-col items-center rounded-[5px] border bg-chassis px-1 py-0.5 ${enabled === false ? "opacity-60" : ""} ${active ? "tsw-node-act" : ""}`}
      style={{
        minWidth: FUNNEL_W[stage.id],
        borderColor: enabled === true ? "color-mix(in srgb,var(--color-signal) 50%,var(--color-rule))" : "var(--color-rule)",
      }}
      data-kind={kind}
      title={`${stage.label} — ${stage.sub} · ${badge}`}
    >
      {active && (
        <span className="tsw-badge" aria-hidden="true">
          {badge}
        </span>
      )}
      <span className="material-symbols-outlined text-[14px] leading-none text-muted" aria-hidden="true">{stage.icon}</span>
      <span className="text-[9px] font-semibold uppercase leading-tight tracking-wide text-muted">{stage.label}</span>
      <span className="max-w-full truncate font-mono tabular-nums text-[9px] leading-tight text-muted" title={badge}>
        {badge}
      </span>
    </div>
  );
}

function EndpointNode({ label, icon, stat, title, active, kind }) {
  return (
    <div
      className={`flex min-w-[44px] shrink-0 flex-col items-center ${active ? "tsw-node-act" : ""}`}
      data-kind={kind}
      title={title}
    >
      <span className="text-[9px] font-semibold uppercase leading-tight tracking-wide text-muted">{label}</span>
      <span className="material-symbols-outlined text-[16px] leading-none text-muted" aria-hidden="true">{icon}</span>
      <span className="max-w-[80px] truncate font-mono tabular-nums text-[9px] leading-tight text-muted">{stat}</span>
    </div>
  );
}

function Seg({ active, kind, packet, delay }) {
  return (
    <span
      className={`tsw-seg ${active ? "tsw-seg-act" : "tsw-rail-idle"}`}
      style={{ animationDelay: delay }}
      data-kind={active ? kind : ""}
      aria-hidden="true"
    >
      {packet ? <span className="tsw-packet" /> : "›"}
    </span>
  );
}

function createInitialState() {
  return {
    req: 0,
    caveman: null,
    ponytail: null,
    rtk: { hits: 0, bytesBefore: null, bytesAfter: null },
    headroom: null,
    pxpipe: null,
    provider: null,
    latest: "",
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const n = (v, max, fallback = 0) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), max) : fallback;
  };
  const b = (v) => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.min(x, Number.MAX_SAFE_INTEGER) : null;
  };
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const lvl = (v) => {
    const o = obj(v);
    const level = sstr(o.level, 12);
    return level ? { level } : null;
  };
  const rtk = obj(raw.rtk);
  const hasHeadroom = raw.headroom && typeof raw.headroom === "object" && !Array.isArray(raw.headroom);
  const hasPxpipe = raw.pxpipe && typeof raw.pxpipe === "object" && !Array.isArray(raw.pxpipe);
  const headroom = obj(raw.headroom);
  const pxpipe = obj(raw.pxpipe);
  const provider = obj(raw.provider);
  return {
    req: n(raw.req, MAX_COUNT),
    caveman: lvl(raw.caveman),
    ponytail: lvl(raw.ponytail),
    rtk: {
      hits: n(rtk.hits, MAX_COUNT),
      bytesBefore: b(rtk.bytesBefore),
      bytesAfter: b(rtk.bytesAfter),
    },
    headroom: hasHeadroom ? {
      applied: headroom.applied === true,
      bodyBefore: b(headroom.bodyBefore),
      bodyAfter: b(headroom.bodyAfter),
      tokensBefore: b(headroom.tokensBefore),
      tokensAfter: b(headroom.tokensAfter),
      reason: sstr(headroom.reason, 120),
    } : null,
    pxpipe: hasPxpipe ? {
      applied: pxpipe.applied === true,
      tokensBeforeEst: b(pxpipe.tokensBeforeEst),
      tokensAfterEst: b(pxpipe.tokensAfterEst),
      savedPct: b(pxpipe.savedPct),
      imageCount: b(pxpipe.imageCount),
      reason: sstr(pxpipe.reason, 120),
    } : null,
    provider:
      provider.provider || provider.model
        ? { provider: sstr(provider.provider, 40), model: sstr(provider.model, 60) }
        : null,
    latest: typeof raw.latest === "string" ? raw.latest.slice(0, 300) : "",
  };
}

function loadState() {
  if (typeof window === "undefined") return null;
  try {
    return normalizeState(JSON.parse(sessionStorage.getItem(STORAGE_KEY)));
  } catch {
    return null;
  }
}

export default function TokenSaverWire() {
  const [state, setState] = useState(createInitialState);
  const [config, setConfig] = useState(null);
  const [conn, setConn] = useState("connecting"); // connecting | live | disconnected
  const [act, setAct] = useState(null); // transient activity: { id, stage, note, kind }
  const actTimer = useRef(null);
  const actIdRef = useRef(0);
  const actQueue = useRef([]);
  const hydratedRef = useRef(false);

  // Declared before the hydrate effect: on mount the persist effect runs while
  // hydratedRef is false, so the empty initial state can never overwrite
  // stored data before hydration applies it.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage unavailable/quota exceeded — persistence is best-effort
    }
  }, [state]);

  useEffect(() => {
    const stored = loadState();
    if (stored) setState(stored);
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => {
        if (cancelled || !settings) return;
        setConfig({
          caveman: { enabled: settings.cavemanEnabled === true, level: sstr(settings.cavemanLevel, 12) || "full" },
          ponytail: { enabled: settings.ponytailEnabled === true, level: sstr(settings.ponytailLevel, 12) || "full" },
          rtk: { enabled: settings.rtkEnabled !== false, mode: sstr(settings.rtkMode, 12) || "standard" },
          headroom: { enabled: settings.headroomEnabled === true },
          pxpipe: { enabled: settings.pxpipeEnabled === true },
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const triggerAct = (stage, note, kind) => {
    actQueue.current.push({ id: ++actIdRef.current, stage, note, kind });
    if (actTimer.current) return;

    const playNext = () => {
      const next = actQueue.current.shift();
      if (!next) {
        setAct(null);
        actTimer.current = null;
        return;
      }
      setAct(next);
      actTimer.current = setTimeout(() => {
        actTimer.current = null;
        playNext();
      }, ACT_MS);
    };
    playNext();
  };

  useEffect(() => {
    const es = new EventSource("/api/events?type=saver");
    es.onopen = () => setConn("live");
    es.onerror = () => setConn("disconnected");

    es.onmessage = (e) => {
      setConn("live");
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!msg || msg.type !== "saver" || !msg.event || typeof msg.event !== "object") return;
      const ev = msg.event;
      if (!STAGE_IDS.includes(ev.stage)) return; // unknown stages are ignored
      const t = timeOf(ev.ts || Date.now());
      const line = (parts) => parts.filter(Boolean).join(" · ");
      const s = ev.stage;

      if (s === "caveman" || s === "ponytail") {
        const level = sstr(ev.level, 12);
        const label = s === "caveman" ? "Caveman" : "Ponytail";
        setState((prev) => ({
          ...prev,
          [s]: { level },
          latest: line([`${t} ${label} on`, level]),
        }));
        triggerAct(s, level ? `on · ${level}` : "on", "ok");
      } else if (s === "rtk") {
        const before = num(ev.bytesBefore);
        const after = num(ev.bytesAfter);
        const hits = num(ev.hits);
        const p = before !== null && after !== null ? pctOf(before, after) : null;
        setState((prev) => ({
          ...prev,
          rtk: {
            hits: Math.min(prev.rtk.hits + (hits || 0), MAX_COUNT),
            bytesBefore: before !== null ? before : prev.rtk.bytesBefore,
            bytesAfter: after !== null ? after : prev.rtk.bytesAfter,
          },
          latest: line([
            `${t} RTK`,
            hits ? `${hits} hits` : "",
            before !== null && after !== null ? `${fmtBytes(before)} → ${fmtBytes(after)}` : "",
            p !== null ? `−${p}%` : "",
          ]),
        }));
        triggerAct("rtk", p !== null ? `−${p}%` : "applied", "ok");
      } else if (s === "headroom") {
        const applied = ev.applied === true;
        const meta = {
          applied,
          bodyBefore: num(ev.bodyBefore),
          bodyAfter: num(ev.bodyAfter),
          tokensBefore: num(ev.tokensBefore),
          tokensAfter: num(ev.tokensAfter),
          reason: sstr(ev.reason, 120),
        };
        setState((prev) => ({
          ...prev,
          headroom: meta,
          latest: line([`${t} Headroom`, applied ? "applied" : meta.reason ? `skipped · ${meta.reason}` : "skipped"]),
        }));
        triggerAct("headroom", applied ? "applied" : meta.reason || "skipped", applied ? "ok" : "skip");
      } else if (s === "pxpipe") {
        const applied = ev.applied === true;
        const before = num(ev.tokensBeforeEst);
        const after = num(ev.tokensAfterEst);
        let pct = num(ev.savedPct);
        if (pct === null) pct = pctOf(before, after); // derived — still an estimate
        const meta = {
          applied,
          tokensBeforeEst: before,
          tokensAfterEst: after,
          savedPct: pct !== null ? Math.min(pct, 100) : null,
          imageCount: num(ev.imageCount),
          reason: sstr(ev.reason, 120),
        };
        const note = applied ? (pct !== null ? `est. −${Math.round(meta.savedPct)}%` : "applied") : meta.reason || "skipped";
        setState((prev) => ({
          ...prev,
          pxpipe: meta,
          latest: line([`${t} PXPIPE`, note]),
        }));
        triggerAct("pxpipe", note, applied ? "ok" : "skip");
      } else if (s === "provider") {
        const provider = sstr(ev.provider, 40);
        const model = sstr(ev.model, 60);
        setState((prev) => ({
          ...prev,
          req: Math.min(prev.req + 1, MAX_COUNT),
          provider: { provider, model },
          latest: line([`${t} → dispatch`, provider, model]),
        }));
        triggerAct("provider", "dispatch", "ok");
      }
    };

    return () => {
      es.close();
      clearTimeout(actTimer.current);
      actQueue.current = [];
    };
  }, []);

  const connMeta = {
    connecting: { text: "Connecting…", cls: "text-warn", dot: "bg-warn" },
    live: { text: "Live", cls: "text-ink", dot: "bg-signal" },
    disconnected: { text: "Disconnected — reconnecting", cls: "text-fail", dot: "bg-fail" },
  }[conn];

  const providerStat =
    state.provider && state.provider.provider
      ? `${state.provider.provider}${state.provider.model ? `/${state.provider.model}` : ""}`
      : "—";

  return (
    <Card
      title="Token saver wire"
      subtitle="Configured stages and live compression telemetry"
      padding="sm"
    >
      <style>{`.tsw-seg{position:relative;display:inline-flex;align-items:center;justify-content:center;width:.5rem;font-size:.625rem;line-height:1;color:var(--color-muted)}
.tsw-packet{position:absolute;top:50%;left:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:9999px;background:var(--tsw-glow,var(--color-signal));box-shadow:0 0 6px color-mix(in srgb,var(--tsw-glow,var(--color-signal)) 70%,transparent);animation:tsw-packet-run .6s ease-in-out 1}
.tsw-packet::after{content:"";position:absolute;inset:0;border-radius:9999px;background:inherit;animation:tsw-packet-run .6s ease-in-out .15s 1}
.tsw-seg-act{color:var(--tsw-glow,var(--color-signal));animation:tsw-seg-pulse 1.2s ease-in-out 1}
.tsw-rail-idle{animation:tsw-rail-pulse 2.4s ease-in-out infinite} /* ambient rail shimmer — decorative only, no data implication */
.tsw-node-act{background-color:color-mix(in srgb,var(--tsw-glow,var(--color-signal)) 12%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--tsw-glow,var(--color-signal)) 40%,transparent);transition:background-color .3s ease,box-shadow .3s ease}
.tsw-badge{position:absolute;top:-9px;right:-4px;display:inline-flex;align-items:center;max-width:120px;padding:2px 5px;border-radius:9999px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--color-chassis);border:1px solid color-mix(in srgb,var(--tsw-glow,var(--color-signal)) 60%,transparent);color:var(--tsw-glow,var(--color-signal));box-shadow:var(--shadow-soft)}
.tsw-log-entry{border-radius:3px;animation:tsw-log-reveal .8s ease-out 1}
.tsw-node-act[data-kind="ok"],.tsw-seg-act[data-kind="ok"]{--tsw-glow:var(--color-signal)}
.tsw-node-act[data-kind="skip"],.tsw-seg-act[data-kind="skip"]{--tsw-glow:var(--color-warn)}
@keyframes tsw-packet-run{0%{transform:translateX(-4px) scale(.5);opacity:0}40%{opacity:1}100%{transform:translateX(4px) scale(1);opacity:0}}
@keyframes tsw-seg-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes tsw-rail-pulse{0%,100%{opacity:.3}50%{opacity:.6}}
@keyframes tsw-log-reveal{from{background-color:color-mix(in srgb,var(--color-signal) 16%,transparent)}to{background-color:transparent}}
@media (prefers-reduced-motion: reduce){.tsw-node-act,.tsw-seg-act,.tsw-packet,.tsw-packet::after,.tsw-rail-idle,.tsw-log-entry{animation:none!important}.tsw-node-act{transition:none}.tsw-packet{opacity:0}}`}</style>
      <div
        className="flex flex-col gap-2 rounded-[var(--radius-brand)] border p-2.5 bg-chassis"
        style={{ borderColor: "var(--color-rule)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">
            Token saver telemetry ·{" "}
            <span className="font-mono tabular-nums text-ink">{fmt(state.req)}</span> dispatches
          </span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${connMeta.cls}`}>
            <span className={`size-2 rounded-full ${connMeta.dot}`} aria-hidden="true" />
            <span className="sr-only">Token-saver stream: </span>
            {connMeta.text}
          </span>
        </div>

        {act && (
          <p className={`truncate text-[10px] font-medium ${act.kind === "ok" ? "text-signal" : "text-warn"}`}>
            {act.note}
          </p>
        )}

        <div className="overflow-x-auto pb-0.5">
          <div
            role="group"
            aria-label="Token-saver pipeline: client, Caveman, Ponytail, RTK, Headroom, PXPIPE, provider"
            className="flex min-w-max items-center gap-x-0.5"
          >
            <EndpointNode
              label="Client"
              icon="terminal"
              stat={`${fmt(state.req)} dispatches`}
              title="Client: the AI tool sending requests"
            />
            {STAGES.map((stage, i) => {
              const segActive = !!act && STAGE_IDX[act.stage] >= i + 1;
              const packet = !!act && STAGE_IDX[act.stage] === i + 1;
              const nodeActive = !!act && act.stage === stage.id;
              return (
                <div key={stage.id} className="flex items-center gap-x-0.5">
                  <Seg active={segActive} kind={segActive ? act.kind : ""} packet={packet} delay={`${(i % 3) * 0.35}s`} />
                  <StageNode
                    stage={stage}
                    badge={stageBadge(stage.id, state, config)}
                    enabled={config?.[stage.id]?.enabled}
                    active={nodeActive}
                    kind={nodeActive ? act.kind : ""}
                  />
                </div>
              );
            })}
            <div className="flex items-center gap-x-0.5">
              <Seg
                active={!!act && act.stage === "provider"}
                kind={act && act.stage === "provider" ? act.kind : ""}
                packet={!!act && act.stage === "provider"}
                delay="0s"
              />
              <EndpointNode
                label="Provider"
                icon="cloud"
                stat={providerStat}
                title={providerStat === "—" ? "Provider: the upstream model API" : `Provider: ${providerStat}`}
                active={!!act && act.stage === "provider"}
                kind={act && act.stage === "provider" ? act.kind : ""}
              />
            </div>
          </div>
        </div>

        <p className="text-[9px] text-muted" style={{ opacity: 0.85 }}>
          RTK/Headroom: reported deltas · PXPIPE: estimate.
        </p>

        <p
          key={state.latest}
          role="status"
          aria-live="polite"
          className="tsw-log-entry truncate border-t pt-1.5 font-mono text-[10px] text-muted"
          style={{ borderColor: "var(--color-rule)" }}
          title={state.latest}
        >
          {state.latest || "Waiting for token-saver events — run a request to see activity."}
        </p>
      </div>
    </Card>
  );
}
