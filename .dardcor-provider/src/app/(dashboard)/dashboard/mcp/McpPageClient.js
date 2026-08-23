"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Button, CardSkeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const STATUS_URL = "/api/mcp/status";

/* ── Helpers ─────────────────────────────────────────────────────── */

const transportColor = (t) => {
  if (t === "stdio") return "primary";
  if (t === "sse") return "info";
  return "default";
};

const transportIcon = (t) => {
  if (t === "stdio") return "terminal";
  if (t === "sse") return "swap_vert";
  return "language";
};

function timeAgo(ts) {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/* ── Health Bar ──────────────────────────────────────────────────── */

function HealthBar({ health }) {
  if (!health || health.total === 0) {
    return (
      <span className="text-xs text-text-muted">No forwarded tool calls recorded</span>
    );
  }
  const pct = Math.round((health.ok / health.total) * 100);
  const color =
    pct >= 95 ? "bg-green-500" : pct >= 70 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden min-w-[60px]">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-text-muted tabular-nums shrink-0">
        {pct}% ({health.ok}/{health.total})
      </span>
    </div>
  );
}

/* ── Plugin Card ─────────────────────────────────────────────────── */

function PluginCard({ plugin, expanded, onToggle }) {
  const isLocal = plugin.type === "local";
  const statusLabel = isLocal
    ? plugin.running
      ? "Running"
      : "Stopped"
    : "Remote";
  const statusVariant = isLocal
    ? plugin.running
      ? "success"
      : "error"
    : "info";

  return (
    <Card padding="sm" className="overflow-hidden">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "size-9 rounded-lg flex items-center justify-center shrink-0",
              isLocal && plugin.running
                ? "bg-green-500/10 text-green-600"
                : isLocal && !plugin.running
                ? "bg-surface-3 text-text-muted"
                : "bg-blue-500/10 text-blue-600"
            )}
          >
            <span className="material-symbols-outlined text-[18px]">
              {isLocal ? "dns" : "cloud"}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-text-main">
                {plugin.title || plugin.name}
              </h3>
              <Badge variant={statusVariant} size="sm" dot>
                {statusLabel}
              </Badge>
              <Badge variant={transportColor(plugin.transport)} size="sm">
                <span className="material-symbols-outlined text-[11px]">
                  {transportIcon(plugin.transport)}
                </span>
                {plugin.transport.toUpperCase()}
              </Badge>
              {plugin.oauth && (
                <Badge variant="warning" size="sm">
                  OAuth
                </Badge>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5 truncate">
              {plugin.description}
            </p>
          </div>
        </div>

        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-surface-2 transition-colors text-text-muted cursor-pointer shrink-0"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <span
            className="material-symbols-outlined text-[18px] transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
          >
            expand_more
          </span>
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 space-y-4 pt-4 border-t border-border-subtle">
          {/* Health */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
               Forwarded Tool Calls
            </h4>
            <HealthBar health={plugin.health} />
            {plugin.health?.lastTs && (
              <p className="text-[11px] text-text-muted mt-1">
                Last: {timeAgo(plugin.health.lastTs)}
                {plugin.health.fail > 0 && (
                  <span className="text-red-500 ml-2">
                    {plugin.health.fail} failure
                    {plugin.health.fail !== 1 ? "s" : ""}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Tools */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Registered Tools ({plugin.tools.length})
            </h4>
            {plugin.tools.length === 0 ? (
              <p className="text-xs text-text-muted">No tools registered</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {plugin.tools.map((t) => (
                  <span
                    key={t.name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-[11px] font-mono text-text-main border border-border-subtle"
                  >
                    <span className="material-symbols-outlined text-[10px] text-text-muted">
                      build
                    </span>
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* URL for remote */}
          {plugin.url && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                Endpoint
              </h4>
              <code className="text-[11px] font-mono text-text-muted break-all">
                {plugin.url}
              </code>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Summary Cards ───────────────────────────────────────────────── */

function SummaryCards({ data, loading }) {
  const bridge = data?.bridge;
  const items = [
    {
      title: "Total Plugins",
      value: loading ? "—" : (bridge?.localCount ?? 0) + (bridge?.remoteCount ?? 0),
      icon: "cable",
      sub: loading
        ? ""
        : `${bridge?.localCount ?? 0} local · ${bridge?.remoteCount ?? 0} remote`,
    },
    {
      title: "Bridges Running",
      value: loading ? "—" : bridge?.runningCount ?? 0,
      icon: "play_circle",
      sub: loading
        ? ""
        : `of ${bridge?.localCount ?? 0} local stdio bridge${
            (bridge?.localCount ?? 0) !== 1 ? "s" : ""
          }`,
      accent: (bridge?.runningCount ?? 0) > 0 ? "text-green-600" : "text-text-muted",
    },
    {
      title: "Registered Tools",
      value: loading ? "—" : bridge?.totalTools ?? 0,
      icon: "build",
      sub: "across all plugins",
    },
    {
      title: "Gateway MCP",
       value: loading ? "—" : data?.api?.responding ? "Responding" : "Error",
      icon: "health_and_safety",
      accent: loading
        ? "text-text-muted"
         : data?.api?.responding
        ? "text-green-600"
        : "text-red-500",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.title} padding="sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 rounded-md bg-bg text-text-muted">
              <span className="material-symbols-outlined text-[18px]">
                {item.icon}
              </span>
            </div>
            <span className="text-xs text-text-muted">{item.title}</span>
          </div>
          <p className={cn("text-2xl font-semibold", item.accent || "text-text-main")}>
            {item.value}
          </p>
          {item.sub && (
            <p className="text-[11px] text-text-muted mt-0.5">{item.sub}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ── Page Header ─────────────────────────────────────────────────── */

function PageHeader({ loading, refresh }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold">MCP</h1>
        <p className="text-sm text-text-muted">
          Model Context Protocol — bridge status, transports, tools, and
           forwarded-call telemetry.
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={refresh}
        disabled={loading}
        icon="refresh"
      >
        {loading ? "Loading…" : "Refresh"}
      </Button>
    </div>
  );
}

/* ── Main Page Component ─────────────────────────────────────────── */

export default function McpPageClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(STATUS_URL, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err.message || "Failed to load MCP status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = (name) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  const plugins = data?.plugins || [];
  const filtered =
    filter === "all"
      ? plugins
      : filter === "local"
      ? plugins.filter((p) => p.type === "local")
      : plugins.filter((p) => p.type === "remote");

  const filterOptions = [
    { value: "all", label: `All (${plugins.length})` },
    {
      value: "local",
      label: `Local (${
        plugins.filter((p) => p.type === "local").length
      })`,
    },
    {
      value: "remote",
      label: `Remote (${
        plugins.filter((p) => p.type === "remote").length
      })`,
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <PageHeader loading={loading} refresh={load} />

      {error && (
        <Card className="border-red-500/30 text-sm text-red-500" padding="sm">
          {error}
        </Card>
      )}

      <SummaryCards data={data} loading={loading} />

      {/* Plugin list header with filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-text-main flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">
            extension
          </span>
          MCP Plugins
        </h2>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                filter === opt.value
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Plugin cards */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">
              cable
            </span>
            <p className="text-sm text-text-muted">
              {plugins.length === 0
                ? "No MCP plugins configured."
                : `No ${filter} plugins found.`}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((plugin) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              expanded={!!expanded[plugin.name]}
              onToggle={() => toggleExpand(plugin.name)}
            />
          ))}
        </div>
      )}

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">
            info
          </span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">Local stdio bridges</strong>{" "}
              spawn on demand when a client connects via SSE, and shut down
              after the last session disconnects.
            </p>
            <p>
              <strong className="text-text-main">Remote plugins</strong>{" "}
              connect to external MCP servers over HTTPS. OAuth-enabled
              servers require authentication before tools can be listed.
            </p>
            <p>
              Tool names shown are the safe, registered names — no API keys
              or credentials are exposed through this page.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
