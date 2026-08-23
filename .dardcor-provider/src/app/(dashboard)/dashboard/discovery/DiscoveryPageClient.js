"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, Badge, Button, CardSkeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const API_URL = "/api/discovery";

/* ── Type icons and colors ─────────────────────────────────────────── */

const TYPE_META = {
  provider: { icon: "dns", variant: "primary", label: "Provider" },
  model: { icon: "model_training", variant: "info", label: "Model" },
  agent: { icon: "smart_toy", variant: "success", label: "Agent" },
  skill: { icon: "extension", variant: "warning", label: "Skill" },
  endpoint: { icon: "api", variant: "default", label: "Endpoint" },
};

const VARIANT_BG_CLASSES = {
  primary: "bg-brand-500/10",
  info: "bg-blue-500/10",
  success: "bg-green-500/10",
  warning: "bg-amber-500/10",
  default: "bg-gray-500/10",
};

/* ── Link resolver ─────────────────────────────────────────────────── */

function resolveLink(item) {
  if (item.type === "provider" && item.id) return `/dashboard/providers/${item.id}`;
  if (item.type === "skill") return "/dashboard/agent-skills";
  if (item.type === "endpoint") return "/dashboard/api-endpoints";
  if (item.type === "agent") return "/dashboard/cloud-agents";
  return null;
}

/* ── Source Statuses ───────────────────────────────────────────────── */

function SourceStatuses({ sources }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s) => (
        <div
          key={s.id}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs",
            s.status === "available"
              ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
              : "bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400"
          )}
        >
          <span className={cn("material-symbols-outlined text-[12px]", s.status === "available" ? "text-green-500" : "text-red-500")}>
            {s.status === "available" ? "check_circle" : "error"}
          </span>
          <span className="font-medium">{s.id}</span>
          {s.status === "available" ? (
            <span className="text-text-muted">{s.count}</span>
          ) : (
            <span>{s.error || "Unavailable"}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Result Card ───────────────────────────────────────────────────── */

function ResultCard({ item }) {
  const meta = TYPE_META[item.type] || TYPE_META.endpoint;
  const link = resolveLink(item);

  const inner = (
    <Card padding="sm" hover={!!link} className={cn(!link && "cursor-default")}>
      <div className="flex items-start gap-3">
        <div className={cn(
          "size-9 rounded-lg flex items-center justify-center shrink-0",
          VARIANT_BG_CLASSES[meta.variant] || VARIANT_BG_CLASSES.default
        )}>
          <span className="material-symbols-outlined text-[18px] text-text-muted">{meta.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-text-main truncate">{item.name || item.id}</h3>
            <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
            {item.status && item.status !== "available" && (
              <Badge variant="warning" size="sm" dot>{item.status}</Badge>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{item.description}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {item.id && item.id !== item.name && (
              <code className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle">
                {item.id}
              </code>
            )}
            {item.source && (
              <span className="text-[10px] text-text-subtle">{item.source}</span>
            )}
            {item.path && (
              <code className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle">
                {item.path}
              </code>
            )}
            {item.provider && (
              <span className="text-[10px] text-text-subtle">via {item.provider}</span>
            )}
          </div>
        </div>
        {link && (
          <span className="material-symbols-outlined text-[16px] text-text-muted shrink-0 mt-1">arrow_forward</span>
        )}
      </div>
    </Card>
  );

  return link ? <Link href={link} className="block">{inner}</Link> : inner;
}

/* ── Count Pills ───────────────────────────────────────────────────── */

function CountPills({ counts, activeType, onTypeChange }) {
  if (!counts) return null;
  const types = ["provider", "model", "agent", "skill", "endpoint"];
  return (
    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle flex-wrap">
      <button
        onClick={() => onTypeChange(null)}
        className={cn(
          "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
          !activeType ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
        )}
      >
        All ({counts.total ?? 0})
      </button>
      {types.map((t) => {
        const count = counts[t] ?? counts.byType?.[t] ?? 0;
        const meta = TYPE_META[t];
        return (
          <button
            key={t}
            onClick={() => onTypeChange(activeType === t ? null : t)}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
              activeType === t ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
            )}
          >
            <span className="material-symbols-outlined text-[12px] align-text-bottom mr-0.5">{meta.icon}</span>
            {meta.label} ({count})
          </button>
        );
      })}
    </div>
  );
}

/* ── Page Header ───────────────────────────────────────────────────── */

function PageHeader({ loading, refresh }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          Discovery
          <Badge variant="primary" size="sm">Search All</Badge>
        </h1>
        <p className="text-sm text-text-muted">
          Search across providers, models, agents, skills, and endpoints.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={refresh} disabled={loading} icon="refresh">
        {loading ? "Loading…" : "Refresh"}
      </Button>
    </div>
  );
}

/* ── Main Client Component ─────────────────────────────────────────── */

export default function DiscoveryPageClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(null);
  const debounceRef = useRef(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search input
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const load = useCallback(async (searchQuery, type) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("query", searchQuery.slice(0, 100));
      if (type) params.set("type", type);
      const url = `${API_URL}?${params.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err.message || "Failed to load discovery data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(debouncedQuery, typeFilter); }, [load, debouncedQuery, typeFilter]);

  const items = data?.items || [];
  const counts = data?.counts || {};
  const sources = data?.sources || [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <PageHeader loading={loading} refresh={() => load(debouncedQuery, typeFilter)} />

      {error && (
        <Card className="border-red-500/30 text-sm text-red-500" padding="sm">{error}</Card>
      )}

      {/* Summary row */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card padding="sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 rounded-md bg-bg text-text-muted">
              <span className="material-symbols-outlined text-[18px]">explore</span>
            </div>
            <span className="text-xs text-text-muted">Total Results</span>
          </div>
          <p className="text-2xl font-semibold text-text-main">{loading ? "—" : counts.total ?? 0}</p>
        </Card>
        <Card padding="sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 rounded-md bg-bg text-text-muted">
              <span className="material-symbols-outlined text-[18px]">hub</span>
            </div>
            <span className="text-xs text-text-muted">Sources</span>
          </div>
          <p className="text-2xl font-semibold text-text-main">
            {loading ? "—" : sources.filter((s) => s.status === "available").length}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">of {sources.length} sources</p>
        </Card>
        <Card padding="sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 rounded-md bg-bg text-text-muted">
              <span className="material-symbols-outlined text-[18px]">category</span>
            </div>
            <span className="text-xs text-text-muted">Types</span>
          </div>
          <p className="text-2xl font-semibold text-text-main">
            {loading ? "—" : Object.keys(counts.byType || {}).filter((k) => (counts.byType[k] ?? 0) > 0).length}
          </p>
        </Card>
      </div>

      {/* Source statuses */}
      <SourceStatuses sources={sources} />

      {/* Search + type filter */}
      <div className="space-y-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">search</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all capabilities…"
            maxLength={100}
            className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-border-subtle bg-surface text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>
        <CountPills counts={counts} activeType={typeFilter} onTypeChange={setTypeFilter} />
      </div>

      {/* Results */}
      {loading ? (
        <div className="space-y-3">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : items.length === 0 ? (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">search_off</span>
            <p className="text-sm text-text-muted">
              {debouncedQuery ? `No results for "${debouncedQuery}".` : "No discovery data available."}
            </p>
            {debouncedQuery && (
              <p className="text-xs text-text-subtle mt-1">Try a broader search or clear the filter.</p>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <ResultCard key={`${item.type}-${item.id}-${i}`} item={item} />
          ))}
        </div>
      )}

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">info</span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">Discovery</strong> aggregates data from
              provider registries, model catalogs, agent registries, A2A/MCP skill sources,
              and the API endpoint catalog into a single searchable view.
            </p>
            <p>
              Search is bounded to 100 characters. Filters combine with search — narrow by
              type, then search within results. Cards link to detail pages where available.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
