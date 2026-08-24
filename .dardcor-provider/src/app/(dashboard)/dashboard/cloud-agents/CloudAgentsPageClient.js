"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Button, CardSkeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const STATUS_URL = "/api/agents";

/* ── Helpers ─────────────────────────────────────────────────────── */

function timeAgo(ts) {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function statusColor(status) {
  switch (status) {
    case "configured":
      return "success";
    case "available":
      return "info";
    case "running":
      return "primary";
    case "error":
      return "error";
    default:
      return "default";
  }
}

/* ── Agent Card ──────────────────────────────────────────────────── */

function AgentCard({ agent, lifecycle, expanded, onToggle }) {
  const state = agent.status.state;
  const isCloud = agent.kind === "cloud-cli";
  const isCli = agent.kind === "cli";
  const capabilities = Object.entries(agent.capabilities || {});

  return (
    <Card padding="sm" className="overflow-hidden">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "size-9 rounded-lg flex items-center justify-center shrink-0",
              state === "running"
                ? "bg-green-500/10 text-green-600"
                : state === "error"
                  ? "bg-red-500/10 text-red-600"
                  : state === "configured"
                    ? "bg-blue-500/10 text-blue-600"
                    : "bg-surface-3 text-text-muted"
            )}
          >
            <span className="material-symbols-outlined text-[18px]">
              {isCloud ? "cloud" : isCli ? "terminal" : "smart_toy"}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-text-main">
                {agent.name}
              </h3>
              <Badge variant={statusColor(state)} size="sm" dot>
                {state}
              </Badge>
              <Badge variant={isCloud ? "info" : "default"} size="sm">
                {agent.kind}
              </Badge>
            </div>
            {agent.status.error && <p className="text-xs text-red-500 mt-0.5">{agent.status.error}</p>}
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
          {/* Capabilities */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Capabilities
            </h4>
            {capabilities.length === 0 ? (
              <p className="text-xs text-text-muted">No capabilities listed</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(agent.capabilities || {}).map(([capability, supported]) => (
                  <span
                    key={capability}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-[11px] font-mono text-text-main border border-border-subtle"
                  >
                    <span className={cn("material-symbols-outlined text-[10px]", supported ? "text-green-600" : "text-text-muted")}>
                      {supported ? "check_circle" : "cancel"}
                    </span>
                    {capability}: {supported ? "yes" : "no"}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Probe Result
            </h4>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-mono text-text-muted">
              <span>available: {agent.status.available ? "yes" : "no"}</span>
              <span>configured: {agent.status.configured ? "yes" : "no"}</span>
              <span>running: {agent.status.running ? "yes" : "no"}</span>
            </div>
          </div>

          {lifecycle && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                Latest Lifecycle Event
              </h4>
              <p className="text-xs text-text-muted">
                {lifecycle.action} · {lifecycle.status} · {timeAgo(lifecycle.createdAt)}
                {lifecycle.error && <span className="text-red-500 ml-2">{lifecycle.error}</span>}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Summary Cards ───────────────────────────────────────────────── */

function SummaryCards({ data, loading }) {
  const agents = data?.agents || [];
  const configured = agents.filter((a) => a.status.configured).length;
  const running = agents.filter((a) => a.status.running).length;
  const errors = agents.filter((a) => a.status.state === "error").length;
  const cloudAgents = agents.filter((a) => a.kind === "cloud-cli").length;
  const cliAgents = agents.filter((a) => a.kind === "cli").length;

  const items = [
    {
      title: "Total Agents",
      value: loading ? "—" : agents.length,
      icon: "smart_toy",
      sub: loading
        ? ""
        : `${cloudAgents} cloud CLI · ${cliAgents} CLI`,
    },
    {
      title: "Configured",
      value: loading ? "—" : configured,
      icon: "check_circle",
      sub: loading
        ? ""
        : `of ${agents.length} agent${agents.length !== 1 ? "s" : ""}`,
      accent: configured > 0 ? "text-green-600" : "text-text-muted",
    },
    {
      title: "Running",
      value: loading ? "—" : running,
      icon: "play_circle",
      sub: loading ? "" : "reported by probes",
      accent: running > 0 ? "text-green-600" : "text-text-muted",
    },
    {
      title: "Errors",
      value: loading ? "—" : errors,
      icon: "error",
      sub: loading ? "" : "need attention",
      accent: errors > 0 ? "text-red-500" : "text-text-muted",
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
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          Agent Registry
          <Badge variant="info" size="sm">
            Registry
          </Badge>
        </h1>
        <p className="text-sm text-text-muted">
          Registered CLI, cloud CLI, and desktop integrations with probe-backed status.
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

export default function CloudAgentsPageClient() {
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
      setError(err.message || "Failed to load agent status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = (name) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  const agents = data?.agents || [];
  const filtered =
    filter === "all"
      ? agents
      : filter === "cloud-cli"
        ? agents.filter((a) => a.kind === "cloud-cli")
        : filter === "cli"
          ? agents.filter((a) => a.kind === "cli")
          : filter === "configured"
            ? agents.filter((a) => a.status.configured)
            : filter === "error"
              ? agents.filter((a) => a.status.state === "error")
              : agents;

  const filterOptions = [
    { value: "all", label: `All (${agents.length})` },
    {
      value: "cloud-cli",
      label: `Cloud CLI (${agents.filter((a) => a.kind === "cloud-cli").length})`,
    },
    {
      value: "cli",
      label: `CLI (${agents.filter((a) => a.kind === "cli").length})`,
    },
    {
      value: "configured",
      label: `Configured (${agents.filter((a) => a.status.configured).length})`,
    },
    {
      value: "error",
      label: `Errors (${agents.filter((a) => a.status.state === "error").length})`,
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

      {/* Agent list header with filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-text-main flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">
            smart_toy
          </span>
          Registered Agents
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

      {/* Agent cards */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">
              smart_toy
            </span>
            <p className="text-sm text-text-muted">
              {agents.length === 0
                ? "No agents registered."
                : `No ${filter} agents found.`}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              lifecycle={data?.lifecycle?.find((event) => event.agentId === agent.id)}
              expanded={!!expanded[agent.id]}
              onToggle={() => toggleExpand(agent.id)}
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
              <strong className="text-text-main">Agent kinds</strong>{" "}
              identify CLI, cloud CLI, and desktop integrations.
            </p>
            <p>
              <strong className="text-text-main">CLI Agents</strong>{" "}
              are command-line tools configured to use Dardcor Code as their backend provider.
            </p>
            <p>
              <strong className="text-text-main">Status</strong>{" "}
              is derived from each integration probe. Running appears only when a probe reports it;
              otherwise the registry reports configured, available, unavailable, or error.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
