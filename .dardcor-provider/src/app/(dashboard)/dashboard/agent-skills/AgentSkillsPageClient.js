"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, CardSkeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const API_URL = "/api/discovery/skills";

/* ── Source badge ──────────────────────────────────────────────────── */

function SourceStatus({ source }) {
  const isUp = source.status === "available";
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
        isUp
          ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
          : "bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400"
      )}
    >
      <span className={cn("material-symbols-outlined text-[14px]", isUp ? "text-green-500" : "text-red-500")}>
        {isUp ? "check_circle" : "error"}
      </span>
      <span className="font-medium">{source.id}</span>
      {isUp ? (
        <span className="text-text-muted">{source.count} skill{source.count !== 1 ? "s" : ""}</span>
      ) : (
        <span>{source.error || "Unavailable"}</span>
      )}
    </div>
  );
}

/* ── Skill Card ────────────────────────────────────────────────────── */

function SkillCard({ skill }) {
  const [expanded, setExpanded] = useState(false);
  const hasSchema = skill.inputSchema && Object.keys(skill.inputSchema).length > 0;

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
            {skill.source && (
              <Badge variant="default" size="sm">
                {skill.source}
              </Badge>
            )}
            {skill.scope && (
              <Badge variant="info" size="sm">
                {skill.scope}
              </Badge>
            )}
            <Badge
              variant={skill.status === "available" ? "success" : "warning"}
              size="sm"
              dot
            >
              {skill.status}
            </Badge>
          </div>
          <p className="text-xs text-text-muted mt-1">{skill.description}</p>
          {skill.endpoint && (
            <code className="inline-block mt-1.5 text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle">
              {skill.endpoint}
            </code>
          )}
        </div>
        {hasSchema && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-surface-2 transition-colors text-text-muted cursor-pointer shrink-0"
            aria-label={expanded ? "Collapse schema" : "Expand schema"}
          >
            <span
              className="material-symbols-outlined text-[18px] transition-transform"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
            >
              expand_more
            </span>
          </button>
        )}
      </div>

      {expanded && hasSchema && (
        <div className="mt-3 pt-3 border-t border-border-subtle">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            Input Schema
          </h4>
          <pre className="text-[11px] font-mono text-text-main bg-surface-2 rounded-md p-3 overflow-x-auto max-h-60 border border-border-subtle">
            {JSON.stringify(skill.inputSchema, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  );
}

/* ── Summary Cards ─────────────────────────────────────────────────── */

function SummaryCards({ data, loading }) {
  const items = data?.items || [];
  const sources = data?.sources || [];
  const available = sources.filter((s) => s.status === "available");
  const bySource = {};
  for (const s of sources) if (s.status === "available") bySource[s.id] = s.count;

  const cards = [
    { title: "Total Skills", value: loading ? "—" : items.length, icon: "extension" },
    { title: "Sources Active", value: loading ? "—" : available.length, icon: "hub", sub: loading ? "" : `of ${sources.length} total` },
    { title: "A2A Skills", value: loading ? "—" : (bySource.a2a ?? 0), icon: "swap_horiz" },
    { title: "MCP Tools", value: loading ? "—" : (bySource.mcp ?? 0), icon: "cable" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.title} padding="sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 rounded-md bg-bg text-text-muted">
              <span className="material-symbols-outlined text-[18px]">{c.icon}</span>
            </div>
            <span className="text-xs text-text-muted">{c.title}</span>
          </div>
          <p className="text-2xl font-semibold text-text-main">{c.value}</p>
          {c.sub && <p className="text-[11px] text-text-muted mt-0.5">{c.sub}</p>}
        </Card>
      ))}
    </div>
  );
}

/* ── Page Header ───────────────────────────────────────────────────── */

function PageHeader({ loading, refresh }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          Agent Skills
          <Badge variant="primary" size="sm">Read-only</Badge>
        </h1>
        <p className="text-sm text-text-muted">
          Skills from A2A agents, MCP tools, and the built-in catalog.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={refresh} disabled={loading} icon="refresh">
        {loading ? "Loading…" : "Refresh"}
      </Button>
    </div>
  );
}

/* ── Main Client Component ─────────────────────────────────────────── */

export default function AgentSkillsPageClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err.message || "Failed to load agent skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const sources = data?.sources || [];
  const sourceIds = useMemo(
    () => [...new Set(items.map((s) => s.source))].sort(),
    [items]
  );

  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return items.filter((skill) => {
      if (sourceFilter !== "all" && skill.source !== sourceFilter) return false;
      if (!needle) return true;
      return [skill.id, skill.name, skill.description].some((v) =>
        (v || "").toLowerCase().includes(needle)
      );
    });
  }, [items, search, sourceFilter]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <PageHeader loading={loading} refresh={load} />

      {error && (
        <Card className="border-red-500/30 text-sm text-red-500" padding="sm">{error}</Card>
      )}

      <SummaryCards data={data} loading={loading} />

      {/* Source statuses */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((s) => <SourceStatus key={s.id} source={s} />)}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills by name, ID, or description…"
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-border-subtle bg-surface text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle">
          <button
            onClick={() => setSourceFilter("all")}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
              sourceFilter === "all" ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
            )}
          >
            All ({items.length})
          </button>
          {sourceIds.map((id) => (
            <button
              key={id}
              onClick={() => setSourceFilter(id)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                sourceFilter === id ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              {id} ({items.filter((s) => s.source === id).length})
            </button>
          ))}
        </div>
      </div>

      {/* Skill list */}
      {loading ? (
        <div className="space-y-3">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">extension</span>
            <p className="text-sm text-text-muted">
              {items.length === 0 ? "No agent skills registered." : "No skills match your search."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((skill) => (
            <SkillCard key={`${skill.source}-${skill.id}`} skill={skill} />
          ))}
        </div>
      )}

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">info</span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">Agent Skills</strong> are read-only
              advertisements from A2A agents, MCP tool registries, and the built-in
              skill catalog. They describe capabilities — not active services.
            </p>
            <p>
              <strong className="text-text-main">Unreachable sources</strong> appear as
              unavailable warnings. No execution, mutation, or secret data is exposed
              through this page.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
