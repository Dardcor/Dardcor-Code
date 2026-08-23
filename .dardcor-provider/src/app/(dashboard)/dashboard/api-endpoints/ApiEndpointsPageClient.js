"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, CardSkeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const API_URL = "/api/discovery/endpoints";

/* ── Auth badge helpers ────────────────────────────────────────────── */

const AUTH_VARIANT = {
  "public-api-key": "success",
  dashboard: "primary",
  "local-only": "warning",
  experimental: "info",
};

const AUTH_ICON = {
  "public-api-key": "key",
  dashboard: "lock",
  "local-only": "vpn_lock",
  experimental: "science",
};

const METHOD_COLORS = {
  GET: "text-green-600 dark:text-green-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-amber-600 dark:text-amber-400",
  DELETE: "text-red-600 dark:text-red-400",
  PATCH: "text-purple-600 dark:text-purple-400",
};

/* ── Copy Button ───────────────────────────────────────────────────── */

function CopyButton({ value }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <button
      onClick={() => copy(value)}
      className="p-1 rounded hover:bg-surface-2 transition-colors text-text-muted cursor-pointer"
      title="Copy cURL"
    >
      <span className="material-symbols-outlined text-[16px]">
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}

/* ── Endpoint Card ─────────────────────────────────────────────────── */

function EndpointCard({ endpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className={cn("text-xs font-bold font-mono", METHOD_COLORS[endpoint.method] || "text-text-main")}>
              {endpoint.method}
            </code>
            <code className="text-xs font-mono text-text-main bg-surface-2 px-1.5 py-0.5 rounded border border-border-subtle">
              {endpoint.path}
            </code>
            <Badge variant={AUTH_VARIANT[endpoint.auth] || "default"} size="sm">
              <span className="material-symbols-outlined text-[10px] mr-0.5">{AUTH_ICON[endpoint.auth] || "lock"}</span>
              {endpoint.auth}
            </Badge>
            {endpoint.category && (
              <Badge variant="default" size="sm">{endpoint.category}</Badge>
            )}
          </div>
          <p className="text-xs text-text-muted mt-1">{endpoint.description}</p>
          <p className="text-[11px] text-text-muted mt-0.5">{endpoint.capability}</p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
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

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border-subtle space-y-3">
          {/* cURL example */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              cURL Example
            </h4>
            <div className="flex items-start gap-2">
              <pre className="flex-1 text-[11px] font-mono text-text-main bg-surface-2 rounded-md p-3 overflow-x-auto border border-border-subtle">
                {endpoint.curl}
              </pre>
              <CopyButton value={endpoint.curl} />
            </div>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider">ID</span>
              <p className="text-xs font-mono text-text-main mt-0.5">{endpoint.id}</p>
            </div>
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Auth</span>
              <p className="text-xs text-text-main mt-0.5">{endpoint.auth}</p>
            </div>
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Category</span>
              <p className="text-xs text-text-main mt-0.5">{endpoint.category}</p>
            </div>
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Status</span>
              <p className="text-xs text-text-main mt-0.5">{endpoint.status}</p>
            </div>
          </div>

          {endpoint.auth === "local-only" && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
              <span className="material-symbols-outlined text-[14px] shrink-0 mt-0.5">warning</span>
              <span>This endpoint is local-only and not accessible from external networks.</span>
            </div>
          )}
          {endpoint.auth === "experimental" && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-700 dark:text-blue-400">
              <span className="material-symbols-outlined text-[14px] shrink-0 mt-0.5">science</span>
              <span>This endpoint is experimental and may change or be removed.</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Summary Cards ─────────────────────────────────────────────────── */

function SummaryCards({ data, loading }) {
  const items = data?.items || [];
  const sources = data?.sources || [];
  const byAuth = {};
  for (const e of items) byAuth[e.auth] = (byAuth[e.auth] || 0) + 1;

  const cards = [
    { title: "Total Endpoints", value: loading ? "—" : items.length, icon: "api" },
    { title: "Public API Key", value: loading ? "—" : (byAuth["public-api-key"] ?? 0), icon: "key", accent: "text-green-600" },
    { title: "Dashboard Only", value: loading ? "—" : (byAuth.dashboard ?? 0), icon: "lock", accent: "text-brand-500" },
    { title: "Local Only", value: loading ? "—" : (byAuth["local-only"] ?? 0), icon: "vpn_lock", accent: "text-amber-600" },
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
          <p className={cn("text-2xl font-semibold", c.accent || "text-text-main")}>{c.value}</p>
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
        <h1 className="text-2xl font-semibold">API Endpoints</h1>
        <p className="text-sm text-text-muted">
          Complete route catalog with auth requirements and cURL examples.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={refresh} disabled={loading} icon="refresh">
        {loading ? "Loading…" : "Refresh"}
      </Button>
    </div>
  );
}

/* ── Main Client Component ─────────────────────────────────────────── */

export default function ApiEndpointsPageClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [authFilter, setAuthFilter] = useState("all");

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
      setError(err.message || "Failed to load API endpoints");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const sources = data?.sources || [];
  const authValues = useMemo(
    () => [...new Set(items.map((e) => e.auth))].sort(),
    [items]
  );

  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return items.filter((ep) => {
      if (authFilter !== "all" && ep.auth !== authFilter) return false;
      if (!needle) return true;
      return [ep.id, ep.path, ep.method, ep.capability, ep.description, ep.category].some((v) =>
        (v || "").toLowerCase().includes(needle)
      );
    });
  }, [items, search, authFilter]);

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
          {sources.map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
                s.status === "available"
                  ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
                  : "bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400"
              )}
            >
              <span className={cn("material-symbols-outlined text-[14px]", s.status === "available" ? "text-green-500" : "text-red-500")}>
                {s.status === "available" ? "check_circle" : "error"}
              </span>
              <span className="font-medium">{s.id}</span>
              {s.status === "available" ? (
                <span className="text-text-muted">{s.count} endpoint{s.count !== 1 ? "s" : ""}</span>
              ) : (
                <span>{s.error || "Unavailable"}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Search + auth filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search endpoints by path, method, or capability…"
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-border-subtle bg-surface text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle">
          <button
            onClick={() => setAuthFilter("all")}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
              authFilter === "all" ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
            )}
          >
            All ({items.length})
          </button>
          {authValues.map((auth) => (
            <button
              key={auth}
              onClick={() => setAuthFilter(auth)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                authFilter === auth ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              {auth} ({items.filter((e) => e.auth === auth).length})
            </button>
          ))}
        </div>
      </div>

      {/* Endpoint list */}
      {loading ? (
        <div className="space-y-3">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">api</span>
            <p className="text-sm text-text-muted">
              {items.length === 0 ? "No API endpoints cataloged." : "No endpoints match your search."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((ep) => (
            <EndpointCard key={ep.id} endpoint={ep} />
          ))}
        </div>
      )}

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">info</span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">cURL examples</strong> use placeholders
              like <code className="px-1 rounded bg-surface-2">$MIAWROUTER_BASE_URL</code> and{" "}
              <code className="px-1 rounded bg-surface-2">$MIAWROUTER_API_KEY</code>. Replace
              them with your actual gateway URL and key.
            </p>
            <p>
              <strong className="text-text-main">Local-only</strong> endpoints are accessible
              only from the machine running MiawRouter.{" "}
              <strong className="text-text-main">Experimental</strong> endpoints may change
              without notice.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
