"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, SegmentedControl } from "@/shared/components";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const money = (value) => `$${(Number(value) || 0).toFixed(4)}`;
const title = (value) => String(value || "unknown").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const tokenCount = (tokens = {}) => (tokens.prompt_tokens || tokens.input_tokens || 0) + (tokens.completion_tokens || tokens.output_tokens || 0);

function PageHeader({ heading, description, refresh, loading, period, setPeriod }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-2xl font-semibold">{heading}</h1><p className="text-sm text-text-muted">{description}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {period && <SegmentedControl ariaLabel={`${heading} period`} options={PERIODS} value={period} onChange={setPeriod} size="sm" />}
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>{loading ? "Loading…" : "Refresh"}</Button>
      </div>
    </div>
  );
}

function ErrorMessage({ error }) {
  return error ? <Card className="border-error/30 text-sm text-error" padding="sm">{error}</Card> : null;
}

function useJson(urls, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const responses = await Promise.all(urls.map((url) => fetch(url, { cache: "no-store" })));
      const payloads = await Promise.all(responses.map(async (response) => {
        const body = await response.json().catch(() => ({}));
        return response.ok ? body : { error: body.error || `Request failed (${response.status})` };
      }));
      setData(payloads);
      const failures = payloads.filter((body) => body?.error).map((body) => body.error);
      if (failures.length === payloads.length) setError(failures[0]);
    } catch (err) {
      setError(err.message || "Unable to load dashboard data");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, load };
}

export function HealthPageClient() {
  const { data, loading, error, load } = useJson(["/api/health", "/api/providers"]);
  const health = data?.[0];
  const connections = data?.[1]?.connections || [];
  const active = connections.filter((item) => item.isActive !== false);
  const tested = active.filter((item) => item.testStatus === "success").length;
  return <div className="flex flex-col gap-6">
    <PageHeader heading="Health" description="Live gateway and provider connection health." refresh={load} loading={loading} />
    <ErrorMessage error={error} />
    <div className="grid gap-4 sm:grid-cols-3">
      <Card title="Gateway" icon="health_and_safety"><strong className={health?.ok ? "text-success" : "text-error"}>{loading ? "Checking…" : health?.ok ? "Healthy" : "Unavailable"}</strong></Card>
      <Card title="Active connections" icon="hub"><span className="metric text-2xl">{number(active.length)}</span></Card>
      <Card title="Last successful tests" icon="check_circle"><span className="metric text-2xl">{number(tested)}</span><p className="text-xs text-text-muted">Based on stored connection test status</p></Card>
    </div>
    <Card title="Provider connections" subtitle="No probes are synthesized; statuses are the last stored test results.">
      {active.length === 0 ? <p className="text-sm text-text-muted">No active provider connections.</p> : active.map((item) => <Card.Row key={item.id} className="flex items-center justify-between gap-4"><span>{item.name || title(item.provider)}</span><span className="text-sm text-text-muted">{title(item.testStatus)}</span></Card.Row>)}
    </Card>
  </div>;
}

export function RuntimePageClient() {
  const urls = ["/api/health", "/api/version", "/api/headroom/status", "/api/pxpipe/status", "/api/tunnel/status"];
  const { data, loading, error, load } = useJson(urls);
  const [health, version, headroom, pxpipe, tunnel] = data || [];
  const services = [
    ["Gateway", health?.ok ? "Running" : "Unavailable", "/api/health"],
    ["Headroom", headroom?.running || headroom?.ok ? "Running" : "Stopped", headroom?.url],
    ["Pxpipe", pxpipe?.running ? "Running" : pxpipe?.enabled ? "Enabled, stopped" : "Disabled", pxpipe?.pid ? `PID ${pxpipe.pid}` : null],
    ["Tunnel", tunnel?.tunnel?.running || tunnel?.tunnel?.active ? "Running" : "Stopped", tunnel?.tunnel?.url],
  ];
  return <div className="flex flex-col gap-6">
    <PageHeader heading="Runtime" description="Status reported by the app's runtime service APIs." refresh={load} loading={loading} />
    <ErrorMessage error={error} />
    <Card title="Application version" icon="deployed_code"><span className="font-mono">{version?.currentVersion || "—"}</span>{version?.hasUpdate && <p className="text-sm text-warning">Version {version.latestVersion} is available.</p>}</Card>
    <div className="grid gap-4 md:grid-cols-2">{services.map(([name, status, detail]) => <Card key={name} title={name}><p className="font-medium">{loading ? "Checking…" : status}</p>{detail && <p className="mt-1 break-all text-xs text-text-muted">{detail}</p>}</Card>)}</div>
  </div>;
}

function StatsPage({ kind }) {
  const [period, setPeriod] = useState("7d");
  const { data, loading, error, load } = useJson([`/api/usage/stats?period=${period}`, "/api/providers", `/api/cache/stats?period=${period}`], [period]);
  const stats = data?.[0] || {};
  const connections = data?.[1]?.connections || [];
  const cache = data?.[2] || {};
  const localCacheHits = (cache.layers?.L1?.hits || 0) + (cache.layers?.L2?.hits || 0);
  const providerNames = Object.fromEntries(connections.map((item) => [item.provider, item.name || title(item.provider)]));
  const rows = Object.entries(stats.byProvider || {}).map(([provider, values]) => ({ provider, ...values })).sort((a, b) => kind === "costs" ? (b.cost || 0) - (a.cost || 0) : (b.requests || 0) - (a.requests || 0));
  const isCosts = kind === "costs";
  return <div className="flex flex-col gap-6">
    <PageHeader heading={isCosts ? "Costs" : "Provider Stats"} description={isCosts ? "Estimated model costs from recorded usage." : "Recorded requests and tokens grouped by provider."} refresh={load} loading={loading} period={period} setPeriod={setPeriod} />
    <ErrorMessage error={error} />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card title={isCosts ? "Estimated cost" : "Requests"}><span className="metric text-2xl">{isCosts ? money(stats.totalCost) : number(stats.totalRequests)}</span></Card>
      <Card title="Input tokens"><span className="metric text-2xl">{number(stats.totalPromptTokens)}</span></Card>
      <Card title="Output tokens"><span className="metric text-2xl">{number(stats.totalCompletionTokens)}</span></Card>
      <Card title={isCosts ? "Cached input tokens" : "Local cache hits"}><span className="metric text-2xl">{number(isCosts ? stats.totalCachedTokens : localCacheHits)}</span></Card>
    </div>
    <Card title={isCosts ? "Cost by provider" : "Usage by provider"} subtitle={isCosts ? "Estimates use configured model pricing and are not invoices." : undefined} padding="none" className="overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-bg-subtle text-text-muted"><tr><th className="px-4 py-3 text-left">Provider</th><th className="px-4 py-3 text-right">Requests</th><th className="px-4 py-3 text-right">Input</th><th className="px-4 py-3 text-right">Output</th><th className="px-4 py-3 text-right">Cost</th></tr></thead><tbody className="divide-y divide-border-subtle">{rows.map((row) => <tr key={row.provider}><td className="px-4 py-3 font-medium">{providerNames[row.provider] || title(row.provider)}</td><td className="px-4 py-3 text-right">{number(row.requests)}</td><td className="px-4 py-3 text-right">{number(row.promptTokens)}</td><td className="px-4 py-3 text-right">{number(row.completionTokens)}</td><td className="px-4 py-3 text-right">{money(row.cost)}</td></tr>)}</tbody></table></div>
      {!loading && rows.length === 0 && <p className="p-8 text-center text-sm text-text-muted">No usage recorded for this period.</p>}
    </Card>
  </div>;
}

export function ProviderStatsPageClient() { return <StatsPage kind="providers" />; }
export function CostsPageClient() { return <StatsPage kind="costs" />; }

export function ActivityPageClient() {
  const { data, loading, error, load } = useJson(["/api/usage/request-details?page=1&pageSize=50"]);
  const details = data?.[0]?.details || [];
  return <div className="flex flex-col gap-6">
    <PageHeader heading="Activity" description="The latest recorded request activity." refresh={load} loading={loading} />
    <ErrorMessage error={error} />
    <Card padding="none" className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-bg-subtle text-text-muted"><tr><th className="px-4 py-3 text-left">Time</th><th className="px-4 py-3 text-left">Provider</th><th className="px-4 py-3 text-left">Model</th><th className="px-4 py-3 text-right">Tokens</th><th className="px-4 py-3 text-right">Status</th></tr></thead><tbody className="divide-y divide-border-subtle">{details.map((item) => <tr key={item.id}><td className="whitespace-nowrap px-4 py-3 text-text-muted">{item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}</td><td className="px-4 py-3">{title(item.provider)}</td><td className="px-4 py-3 font-mono text-xs">{item.model || "—"}</td><td className="px-4 py-3 text-right">{number(tokenCount(item.tokens))}</td><td className="px-4 py-3 text-right">{title(item.status)}</td></tr>)}</tbody></table></div>{!loading && details.length === 0 && <p className="p-8 text-center text-sm text-text-muted">No request activity recorded yet.</p>}</Card>
  </div>;
}
