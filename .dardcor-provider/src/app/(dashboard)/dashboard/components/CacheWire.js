"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/shared/components";

const MAX_COUNT = 999999;
const STORAGE_KEY = "miawrouter.cacheWire.v2"; // versioned — bumped from v1 (log → latest-line shape) to discard stale payloads
const ACT_MS = 1200; // transient activity window, cleared by a ref-managed timer
const LAYER_IDX = { L0: 1, L1: 2, L2: 3, L3: 4 }; // pipeline order past Router
const KIND_META = {
  hit: { glyph: "●", word: "hit", cls: "text-signal" },
  activity: { glyph: "›", word: "activity", cls: "text-warn" },
  dedup: { glyph: "◆", word: "dedup", cls: "text-ink" },
};

const NODES = ["L0", "L1", "L2", "L3"];
const NODE_LABELS = {
  L0: "Prompt cache",
  L1: "Exact cache",
  L2: "Semantic cache",
  L3: "Dedup",
};
const NODE_TITLES = {
  L0: "L0 prompt-cache orchestration — breakpoints and provider cache_read usage",
  L1: "L1 exact-match response cache",
  L2: "L2 semantic response cache (embedding similarity)",
  L3: "L3 content-address dedup — activity and savings, not a provider cache hit",
};

const fmt = (n) => (n >= MAX_COUNT ? `${MAX_COUNT}+` : String(n));
const fmtBytes = (n) => {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

function LayerNode({ layer, hits, savings, active, kind }) {
  const showHits = layer !== "L3";
  return (
    <div
      className={`relative flex shrink-0 flex-col items-center gap-0.5 min-w-[64px] ${active ? "cw-node-act" : ""}`}
      data-kind={kind}
      title={NODE_TITLES[layer]}
    >
      {active && (
        <span className="cw-badge" aria-hidden="true">
          <span>{KIND_META[kind].glyph}</span>
          {KIND_META[kind].word}
        </span>
      )}
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{layer}</span>
      <span className="w-full truncate text-center text-[10px] leading-tight text-muted">{NODE_LABELS[layer]}</span>
      <div className="flex items-baseline gap-1">
        {showHits ? (
          <span
            className={`font-mono tabular-nums text-base font-semibold ${hits > 0 ? "text-signal" : "text-ink"}`}
            title={layer === "L0" ? "Provider-confirmed cache hits" : "Local response-cache hits"}
          >
            {fmt(hits)}
          </span>
        ) : (
          <span className="font-mono tabular-nums text-base font-semibold text-ink" title="Blocks deduped">
            {fmt(savings.refs)}
          </span>
        )}
        <span className="font-mono tabular-nums text-[10px] text-muted">{showHits ? "hits" : "refs"}</span>
      </div>
      {!showHits && (
        <span className="font-mono tabular-nums text-[10px] text-muted" title="Bytes saved by dedup">
          {fmtBytes(savings.bytes)} saved
        </span>
      )}
    </div>
  );
}

function RouteSeg({ active, kind }) {
  return (
    <span className={`cw-seg ${active ? "cw-seg-act" : ""}`} data-kind={kind} aria-hidden="true">
      {active ? <span className="cw-packet">{KIND_META[kind].glyph}</span> : "→"}
    </span>
  );
}

function EndpointNode({ label, icon, stat, title }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5 min-w-[52px]" title={title}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">{icon}</span>
      <span className="font-mono tabular-nums text-[10px] text-muted">{stat}</span>
    </div>
  );
}

function timeOf(ts) {
  const ms = Number(ts);
  const d = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function createInitialState() {
  return {
    hits: { L0: 0, L1: 0, L2: 0 },
    events: 0,
    savings: { refs: 0, bytes: 0 },
    interlock: { restored: 0, stable: 0, breakpoints: null },
    latest: "",
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const num = (v, max, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
  };
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const hits = obj(raw.hits);
  const savings = obj(raw.savings);
  const interlock = obj(raw.interlock);
  return {
    hits: { L0: num(hits.L0, MAX_COUNT), L1: num(hits.L1, MAX_COUNT), L2: num(hits.L2, MAX_COUNT) },
    events: num(raw.events, MAX_COUNT),
    savings: { refs: num(savings.refs, MAX_COUNT), bytes: num(savings.bytes, Number.MAX_SAFE_INTEGER) },
    interlock: {
      restored: num(interlock.restored, MAX_COUNT),
      stable: num(interlock.stable, MAX_COUNT),
      breakpoints:
        interlock.breakpoints === null || interlock.breakpoints === undefined
          ? null
          : num(interlock.breakpoints, MAX_COUNT, null),
    },
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

export default function CacheWire() {
  const [state, setState] = useState(createInitialState);
  const [conn, setConn] = useState("connecting"); // connecting | live | disconnected
  const [act, setAct] = useState(null); // transient activity: { id, layer, kind, label }
  const actTimer = useRef(null);
  const actIdRef = useRef(0);
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

  const triggerAct = (layer, kind, label) => {
    clearTimeout(actTimer.current);
    const id = ++actIdRef.current;
    setAct({ id, layer, kind, label });
    actTimer.current = setTimeout(() => {
      setAct((prev) => (prev && prev.id === id ? null : prev));
    }, ACT_MS);
  };

  useEffect(() => {
    const es = new EventSource("/api/events?type=cache");
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
      if (!msg || msg.type !== "cache" || !msg.event || typeof msg.event !== "object") return;
      const ev = msg.event;
      const t = timeOf(ev.ts || Date.now());
      const who = ev.provider ? (ev.model ? `${ev.provider}/${ev.model}` : ev.provider) : "";
      const line = (parts) => parts.filter(Boolean).join(" · ");
      const hit = (layer, log) =>
        setState((prev) => ({
          ...prev,
          hits: { ...prev.hits, [layer]: Math.min(prev.hits[layer] + 1, MAX_COUNT) },
          events: Math.min(prev.events + 1, MAX_COUNT),
          latest: log,
        }));
      const bump = (log) =>
        setState((prev) => ({
          ...prev,
          events: Math.min(prev.events + 1, MAX_COUNT),
          latest: log,
        }));

      let layer = null;
      let kind = null;
      let label = null;
      if (ev.type === "cache_probe" || ev.type === "cache_usage") layer = "L0";
      else if (ev.type === "cache_l1") layer = "L1";
      else if (ev.type === "cache_l2") layer = "L2";
      else if (ev.type === "cache_l3") layer = "L3";
      if (layer) {
        if (ev.type === "cache_probe") {
          kind = "activity";
          label = "L0 probe";
        } else if (ev.type === "cache_usage") {
          kind = Number(ev.cacheRead) > 0 ? "hit" : "activity";
          label = `${layer} ${kind === "hit" ? "hit" : "miss"}`;
        } else if (ev.type === "cache_l3") {
          kind = "dedup";
          label = "L3 dedup";
        } else if (ev.action === "hit") {
          kind = "hit";
          label =
            ev.type === "cache_l2" && ev.similarity !== undefined
              ? `L2 hit · ${(ev.similarity * 100).toFixed(1)}%`
              : `${layer} hit`;
        } else {
          kind = "activity";
          label = `${layer} ${ev.action ?? "activity"}`;
        }
        triggerAct(layer, kind, label);
      }

      if (ev.type === "cache_probe") {
        const parts = [`${t} L0 probe`, who];
        if (ev.stable) parts.push(`${ev.breakpoints ?? 0} breakpoints`);
        else if (ev.turns !== undefined) parts.push(`${ev.turns}/2 turns to stable`);
        if (ev.restored) parts.push("prefix restored");
        setState((prev) => ({
          ...prev,
          events: Math.min(prev.events + 1, MAX_COUNT),
          interlock: {
            restored: Math.min(prev.interlock.restored + (ev.restored ? 1 : 0), MAX_COUNT),
            stable: Math.min(prev.interlock.stable + (ev.stable ? 1 : 0), MAX_COUNT),
            breakpoints:
              Number.isFinite(ev.breakpoints) && ev.breakpoints >= 0
                ? ev.breakpoints
                : prev.interlock.breakpoints,
          },
          latest: line(parts),
        }));
      } else if (ev.type === "cache_usage") {
        if (Number(ev.cacheRead) > 0) {
          hit("L0", line([`${t} L0 hit`, who, `${ev.cacheRead} read`]));
        } else {
          bump(line([`${t} L0 miss`, who, `${ev.cacheCreation ?? 0} written`]));
        }
      } else if (ev.type === "cache_l1") {
        if (ev.action === "hit") hit("L1", line([`${t} L1 hit`, who]));
        else bump(line([`${t} L1 ${ev.action ?? "event"}`, who]));
      } else if (ev.type === "cache_l2") {
        if (ev.action === "hit") {
          const sim = ev.similarity !== undefined ? `${(ev.similarity * 100).toFixed(1)}% sim` : null;
          hit("L2", line([`${t} L2 hit`, who, sim]));
        } else {
          bump(line([`${t} L2 ${ev.action ?? "event"}`, who]));
        }
      } else if (ev.type === "cache_l3") {
        const refs = Number(ev.refs) || 0;
        const bytes = Number(ev.bytesSaved) || 0;
        setState((prev) => ({
          ...prev,
          events: Math.min(prev.events + 1, MAX_COUNT),
          savings: {
            refs: Math.min(prev.savings.refs + refs, MAX_COUNT),
            bytes: Math.min(prev.savings.bytes + bytes, Number.MAX_SAFE_INTEGER),
          },
          latest: line([`${t} L3 dedup`, who, `${refs} refs`, fmtBytes(bytes)]),
        }));
      } else {
        bump(line([`${t} cache ${ev.type}`, who]));
      }
    };

    return () => {
      es.close();
      clearTimeout(actTimer.current);
    };
  }, []);

  const connMeta = {
    connecting: { text: "Connecting…", cls: "text-warn", dot: "bg-warn" },
    live: { text: "Live", cls: "text-ink", dot: "bg-signal" },
    disconnected: { text: "Disconnected — reconnecting", cls: "text-fail", dot: "bg-fail" },
  }[conn];

  return (
    <Card title="Cache wire" subtitle="Client → router → cache layers → provider · live runtime telemetry" padding="sm">
      <style>{`.cw-seg{position:relative;display:inline-flex;align-items:center;justify-content:center;width:.75rem;font-size:.75rem;line-height:1;color:var(--color-muted)}
.cw-packet{animation:cw-packet-pop .5s ease-out 1}
.cw-seg-act{animation:cw-seg-pulse 1.2s ease-in-out 1}
.cw-node-act{background-color:color-mix(in srgb,var(--cw-glow,var(--color-signal)) 12%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--cw-glow,var(--color-signal)) 40%,transparent);transition:background-color .3s ease,box-shadow .3s ease;animation:cw-node-pulse 1.2s ease-out 1}
.cw-badge{position:absolute;top:-9px;right:-4px;display:inline-flex;align-items:center;gap:3px;padding:2px 5px;border-radius:9999px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9px;line-height:1;text-transform:uppercase;letter-spacing:.04em;background:var(--color-chassis);border:1px solid color-mix(in srgb,var(--cw-glow,var(--color-signal)) 60%,transparent);color:var(--cw-glow,var(--color-signal));box-shadow:var(--shadow-soft)}
.cw-log-entry{border-radius:3px;animation:cw-log-reveal .8s ease-out 1}
.cw-seg-act[data-kind="hit"],.cw-node-act[data-kind="hit"],.cw-packet[data-kind="hit"]{--cw-glow:var(--color-signal);color:var(--color-signal)}
.cw-seg-act[data-kind="activity"],.cw-node-act[data-kind="activity"],.cw-packet[data-kind="activity"]{--cw-glow:var(--color-warn);color:var(--color-warn)}
.cw-seg-act[data-kind="dedup"],.cw-node-act[data-kind="dedup"],.cw-packet[data-kind="dedup"]{--cw-glow:var(--color-ink);color:var(--color-ink)}
@keyframes cw-node-pulse{0%,100%{box-shadow:0 0 0 1px color-mix(in srgb,var(--cw-glow,var(--color-signal)) 40%,transparent)}50%{box-shadow:0 0 0 1px color-mix(in srgb,var(--cw-glow,var(--color-signal)) 65%,transparent),0 0 10px color-mix(in srgb,var(--cw-glow,var(--color-signal)) 45%,transparent)}}
@keyframes cw-seg-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes cw-packet-pop{0%{transform:scale(.4);opacity:0}35%{transform:scale(1.2);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes cw-log-reveal{from{background-color:color-mix(in srgb,var(--color-signal) 16%,transparent)}to{background-color:transparent}}
@media (prefers-reduced-motion: reduce){.cw-node-act,.cw-seg-act,.cw-packet,.cw-log-entry{animation:none!important}.cw-node-act{transition:none}.cw-packet{opacity:0}}`}</style>
      <div
        className="flex flex-col gap-2.5 rounded-[var(--radius-brand)] border p-3 bg-chassis"
        style={{ borderColor: "var(--color-rule)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">Cache telemetry</span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${connMeta.cls}`}>
            <span className={`size-2 rounded-full ${connMeta.dot}`} aria-hidden="true" />
            <span className="sr-only">Cache stream: </span>
            {connMeta.text}
          </span>
        </div>

        <p className="flex h-4 items-center gap-1.5 text-[11px] font-medium">
          {act ? (
            <>
              <span aria-hidden="true" className={KIND_META[act.kind].cls}>
                {KIND_META[act.kind].glyph}
              </span>
              <span className={KIND_META[act.kind].cls}>{act.label}</span>
            </>
          ) : (
            <span className="text-muted">Live</span>
          )}
        </p>

        <div
          role="group"
          aria-label="Cache pipeline: client, router, cache layers L0 through L3, provider"
          className="flex flex-wrap items-center gap-x-1 gap-y-1.5"
        >
          <EndpointNode label="Client" icon="terminal" stat={`${fmt(state.events)} events`} title="Client: the AI tool sending requests" />
          <RouteSeg active={!!act} kind={act?.kind} />
          <EndpointNode label="Router" icon="hub" stat={`${fmt(state.events)} events`} title="MiawRouter gateway — cache events seen" />
          {NODES.map((layer) => (
            <div key={layer} className="flex items-center gap-x-1">
              <RouteSeg
                active={!!act && LAYER_IDX[act.layer] >= LAYER_IDX[layer]}
                kind={act?.kind}
              />
              <LayerNode
                layer={layer}
                hits={state.hits[layer]}
                savings={state.savings}
                active={act?.layer === layer}
                kind={act?.kind}
              />
            </div>
          ))}
          <div className="flex items-center gap-x-1">
            <RouteSeg active={false} />
            <EndpointNode label="Provider" icon="cloud" stat="upstream" title="Provider: the upstream model API" />
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2"
          style={{ borderColor: "var(--color-rule)" }}
        >
          <span className="text-xs font-medium text-ink">Prefix interlock</span>
          <span
            className="font-mono tabular-nums text-[11px] text-muted"
            title="Probes where a protected-prefix edit was restored before dispatch"
          >
            restored <span className="text-warn">{fmt(state.interlock.restored)}</span>
          </span>
          <span
            className="font-mono tabular-nums text-[11px] text-muted"
            title="Probes that reached a stable prefix"
          >
            stable <span className="text-ink">{fmt(state.interlock.stable)}</span>
          </span>
          <span
            className="font-mono tabular-nums text-[11px] text-muted"
            title="Latest observed breakpoint count inserted for a stable prefix"
          >
            breakpoints <span className="text-ink">{state.interlock.breakpoints === null ? "—" : String(state.interlock.breakpoints)}</span>
          </span>
          <span className="text-[10px] text-muted" style={{ opacity: 0.85 }}>
            Raw runtime telemetry — not billed savings or a measured claim.
          </span>
        </div>

        <p
          key={state.latest}
          role="status"
          aria-live="polite"
          className="cw-log-entry truncate border-t pt-2 font-mono text-[11px] text-muted"
          style={{ borderColor: "var(--color-rule)" }}
          title={state.latest}
        >
          {state.latest || "Waiting for cache events — run a request to see activity."}
        </p>
      </div>
    </Card>
  );
}
