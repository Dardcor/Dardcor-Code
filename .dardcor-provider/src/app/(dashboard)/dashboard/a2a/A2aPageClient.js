"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Button, CardSkeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const STATUS_URL = "/api/a2a/status";

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
    case "completed":
      return "success";
    case "working":
      return "primary";
    case "submitted":
      return "info";
    case "failed":
      return "error";
    case "canceled":
      return "warning";
    default:
      return "default";
  }
}

function statusIcon(status) {
  switch (status) {
    case "completed":
      return "check_circle";
    case "working":
      return "progress_activity";
    case "submitted":
      return "schedule";
    case "failed":
      return "error";
    case "canceled":
      return "cancel";
    default:
      return "radio_button_unchecked";
  }
}

/* ── Agent Card Section ──────────────────────────────────────────── */

function AgentCardSection({ agentCard }) {
  if (!agentCard) return null;
  const caps = agentCard.capabilities || {};

  return (
    <Card padding="md">
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[24px] text-brand-500">
            smart_toy
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-text-main">
              {agentCard.name}
            </h2>
            <Badge variant="primary" size="sm">
              v{agentCard.version}
            </Badge>
          </div>
          <p className="text-sm text-text-muted mt-1">{agentCard.description}</p>
        </div>
      </div>

      {/* Capabilities row */}
      <div className="mt-4 pt-4 border-t border-border-subtle">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Capabilities
        </h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(caps).map(([key, val]) => (
            <div
              key={key}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border",
                val
                  ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
                  : "bg-surface-2 border-border-subtle text-text-muted"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[14px]",
                  val ? "text-green-500" : "text-text-subtle"
                )}
              >
                {val ? "check_circle" : "cancel"}
              </span>
              {key.replace(/([A-Z])/g, " $1").trim()}
            </div>
          ))}
        </div>
      </div>

      {/* I/O modes */}
      <div className="mt-4 pt-4 border-t border-border-subtle">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Input Modes
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {(agentCard.defaultInputModes || []).map((m) => (
                <code
                  key={m}
                  className="inline-block px-2 py-0.5 rounded bg-surface-2 text-[11px] font-mono text-text-main border border-border-subtle"
                >
                  {m}
                </code>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Output Modes
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {(agentCard.defaultOutputModes || []).map((m) => (
                <code
                  key={m}
                  className="inline-block px-2 py-0.5 rounded bg-surface-2 text-[11px] font-mono text-text-main border border-border-subtle"
                >
                  {m}
                </code>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Endpoint & Auth Section ─────────────────────────────────────── */

function EndpointSection({ endpoint }) {
  if (!endpoint) return null;
  const auth = endpoint.auth || {};

  return (
    <Card padding="md">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-[var(--radius-brand)] bg-bg text-text-muted">
          <span className="material-symbols-outlined text-[20px]">api</span>
        </div>
        <div>
          <h3 className="text-text-main font-semibold">Endpoint & Auth</h3>
          <p className="text-sm text-text-muted">Connection details</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Base URL */}
        <div>
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Gateway URL
          </span>
          <code className="block mt-1 px-3 py-2 rounded-md bg-surface-2 text-sm font-mono text-text-main break-all border border-border-subtle">
            {endpoint.endpoint || "—"}
          </code>
        </div>

        {/* A2A URL */}
        <div>
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            A2A Agent Endpoint
          </span>
          <code className="block mt-1 px-3 py-2 rounded-md bg-surface-2 text-sm font-mono text-text-main break-all border border-border-subtle">
            {endpoint.a2aEndpoint || "—"}
          </code>
        </div>

        {/* Auth state */}
        <div className="pt-3 border-t border-border-subtle">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
            Authentication
          </h4>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "material-symbols-outlined text-[16px]",
                  auth.requireLogin ? "text-green-500" : "text-text-muted"
                )}
              >
                {auth.requireLogin ? "lock" : "lock_open"}
              </span>
              <span className="text-xs text-text-main">
                {auth.requireLogin
                  ? "Login required"
                  : "Open access"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "material-symbols-outlined text-[16px]",
                  auth.hasApiKeys ? "text-green-500" : "text-yellow-500"
                )}
              >
                {auth.hasApiKeys ? "key" : "key_off"}
              </span>
              <span className="text-xs text-text-main">
                {auth.hasApiKeys
                  ? "API keys configured"
                  : "No API keys set"}
              </span>
            </div>
          </div>
        </div>

        {/* Machine ID */}
        <div className="pt-3 border-t border-border-subtle">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Machine ID
          </span>
          <code className="block mt-1 px-3 py-1.5 rounded bg-surface-2 text-[11px] font-mono text-text-muted break-all border border-border-subtle">
            {auth.machineId || "—"}
          </code>
        </div>
      </div>
    </Card>
  );
}

/* ── Skills Section ──────────────────────────────────────────────── */

function SkillsSection({ skills }) {
  const [expanded, setExpanded] = useState({});

  const toggle = (id) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (!skills || skills.length === 0) {
    return (
      <Card padding="lg">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">
            extension
          </span>
          <p className="text-sm text-text-muted">
            No skills advertised by this agent.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="md">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-[var(--radius-brand)] bg-bg text-text-muted">
          <span className="material-symbols-outlined text-[20px]">extension</span>
        </div>
        <div>
          <h3 className="text-text-main font-semibold">
            Agent Skills
          </h3>
          <p className="text-sm text-text-muted">
            {skills.length} skill{skills.length !== 1 ? "s" : ""} available
            <Badge variant="default" size="sm" className="ml-2">
              Read-only
            </Badge>
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded-[var(--radius-brand)] border border-border-subtle bg-bg/50 overflow-hidden"
          >
            <button
              onClick={() => toggle(skill.id)}
              className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-surface-2/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-8 rounded-md bg-brand-500/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[16px] text-brand-500">
                    bolt
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-main">
                      {skill.name}
                    </span>
                    <code className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-surface-2">
                      {skill.id}
                    </code>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 truncate">
                    {skill.description}
                  </p>
                </div>
              </div>
              <span
                className="material-symbols-outlined text-[18px] text-text-muted transition-transform shrink-0"
                style={{
                  transform: expanded[skill.id]
                    ? "rotate(180deg)"
                    : "rotate(0)",
                }}
              >
                expand_more
              </span>
            </button>

            {expanded[skill.id] && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border-subtle">
                {/* Tags */}
                {skill.tags && skill.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {skill.tags.map((tag) => (
                      <Badge key={tag} variant="default" size="sm">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Examples */}
                {skill.examples && skill.examples.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Examples
                    </h4>
                    <ul className="space-y-1">
                      {skill.examples.map((ex, i) => (
                        <li
                          key={i}
                          className="text-xs text-text-main flex items-start gap-2"
                        >
                          <span className="material-symbols-outlined text-[12px] text-text-muted mt-0.5 shrink-0">
                            arrow_right
                          </span>
                          {ex}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Task History Section ────────────────────────────────────────── */

function TaskHistorySection({ tasks }) {
  const isEmpty = !tasks || tasks.length === 0;

  return (
    <Card padding="md">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-[var(--radius-brand)] bg-bg text-text-muted">
          <span className="material-symbols-outlined text-[20px]">history</span>
        </div>
        <div>
          <h3 className="text-text-main font-semibold">Task History</h3>
          <p className="text-sm text-text-muted">
            {isEmpty
              ? "No tasks submitted yet"
              : `${tasks.length} task${tasks.length !== 1 ? "s" : ""} recorded`}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">
            inbox
          </span>
          <p className="text-sm text-text-muted">
            No A2A tasks have been submitted yet.
          </p>
          <p className="text-xs text-text-subtle mt-1">
            Tasks will appear here when agents send requests to this endpoint.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {tasks.slice(0, 20).map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-3 p-3 rounded-[var(--radius-brand)] hover:bg-surface-2/50 transition-colors"
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[18px] shrink-0",
                  task.status === "completed" && "text-green-500",
                  task.status === "working" && "text-brand-500 animate-pulse",
                  task.status === "submitted" && "text-blue-500",
                  task.status === "failed" && "text-red-500",
                  task.status === "canceled" && "text-yellow-500"
                )}
              >
                {statusIcon(task.status)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-main truncate">
                    {task.name}
                  </span>
                  <Badge variant={statusColor(task.status)} size="sm">
                    {task.status}
                  </Badge>
                  {task.skillId && (
                    <code className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-surface-2">
                      {task.skillId}
                    </code>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[11px] text-text-muted">
                    {timeAgo(task.createdAt)}
                  </span>
                  {task.completedAt && (
                    <span className="text-[11px] text-text-subtle">
                      completed {timeAgo(task.completedAt)}
                    </span>
                  )}
                  {task.error && (
                    <span className="text-[11px] text-red-500 truncate">
                      {task.error}
                    </span>
                  )}
                </div>
              </div>

              <code className="text-[10px] font-mono text-text-muted shrink-0">
                {task.id.length > 16 ? task.id.slice(0, 16) + "…" : task.id}
              </code>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Summary Cards ───────────────────────────────────────────────── */

function SummaryCards({ data, loading }) {
  const agentCard = data?.agentCard;
  const skills = agentCard?.skills || [];
  const tasks = data?.tasks || [];
  const auth = data?.endpoint?.auth || {};

  const items = [
    {
      title: "Agent Version",
      value: loading ? "—" : agentCard?.version || "—",
      icon: "smart_toy",
      accent: agentCard?.version ? "text-brand-500" : "text-text-muted",
    },
    {
      title: "Skills Advertised",
      value: loading ? "—" : skills.length,
      icon: "extension",
      sub: loading ? "" : skills.map((s) => s.name).join(", ") || "none",
    },
    {
      title: "Tasks Recorded",
      value: loading ? "—" : tasks.length,
      icon: "history",
      sub: loading
        ? ""
        : tasks.length > 0
        ? `${tasks.filter((t) => t.status === "completed").length} completed`
        : "no tasks yet",
    },
    {
      title: "Auth State",
      value: loading ? "—" : auth.requireLogin ? "Protected" : "Open",
      icon: auth.requireLogin ? "lock" : "lock_open",
      accent: loading
        ? "text-text-muted"
        : auth.requireLogin
        ? "text-green-600"
        : "text-yellow-600",
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
          <p
            className={cn(
              "text-2xl font-semibold",
              item.accent || "text-text-main"
            )}
          >
            {item.value}
          </p>
          {item.sub && (
            <p className="text-[11px] text-text-muted mt-0.5 truncate">
              {item.sub}
            </p>
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
          A2A
          <Badge variant="info" size="sm">
            Agent-to-Agent
          </Badge>
        </h1>
        <p className="text-sm text-text-muted">
          Agent card, endpoint state, advertised skills, and task history.
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

export default function A2aPageClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      setError(err.message || "Failed to load A2A status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const agentCard = data?.agentCard;
  const skills = agentCard?.skills || [];
  const tasks = data?.tasks || [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <PageHeader loading={loading} refresh={load} />

      {/* Error state */}
      {error && (
        <Card className="border-red-500/30 text-sm text-red-500" padding="sm">
          {error}
        </Card>
      )}

      {/* Summary cards */}
      <SummaryCards data={data} loading={loading} />

      {/* Loading skeleton */}
      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <>
          {/* Agent Card */}
          <AgentCardSection agentCard={agentCard} />

          {/* Two-column: Endpoint + Skills */}
          <div className="grid gap-6 lg:grid-cols-2">
            <EndpointSection endpoint={data?.endpoint} />
            <SkillsSection skills={skills} />
          </div>

          {/* Task History */}
          <TaskHistorySection tasks={tasks} />
        </>
      )}

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">
            info
          </span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">Agent-to-Agent (A2A)</strong>{" "}
              is an open protocol for agent interoperability. This page shows
              {"MiawRouter\u2019s agent card, the endpoint other agents can reach, and"}
              the skills it advertises.
            </p>
            <p>
              <strong className="text-text-main">Skills</strong> are
              read-only advertisements — they describe capabilities, not active
              services. Tasks appear when agents submit requests to this
              endpoint.
            </p>
            <p>
              <strong className="text-text-main">Auth state</strong> reflects
              the current gateway configuration. Protected endpoints require a
              valid session or API key.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
