"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, CardSkeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const API_URL = "/api/skill-discovery";
const MIAWROUTER = "miawrouter";

function SourceStatus({ source }) {
  const up = source.available === true;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
        up
          ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
          : "bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400"
      )}
    >
      <span className={cn("material-symbols-outlined text-[14px]", up ? "text-green-500" : "text-red-500")}>
        {up ? "check_circle" : "error"}
      </span>
      <span className="font-medium">{source.id}</span>
      {up ? (
        source.note ? (
          <span className="text-text-muted">{source.note}</span>
        ) : (
          <span className="text-text-muted">{source.count} skill{source.count !== 1 ? "s" : ""}</span>
        )
      ) : (
        <span>{source.error || "Unavailable"}</span>
      )}
    </div>
  );
}

function CopyButton({ value, label = "Copy" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border-subtle text-[11px] font-medium text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
      title={value}
    >
      <span className="material-symbols-outlined text-[12px]">{copied ? "check" : "content_copy"}</span>
      {copied ? "Copied" : label}
    </button>
  );
}

function InstallModal({ skill, targets, onClose, onDone }) {
  const [mode, setMode] = useState(MIAWROUTER);
  const [cliId, setCliId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const miawTarget = targets.find((t) => t.id === MIAWROUTER);
  const detectedClis = targets.filter((t) => t.id !== MIAWROUTER);
  const availableClis = detectedClis.filter((t) => t.available);

  useEffect(() => {
    if (availableClis.length > 0 && !cliId) setCliId(availableClis[0].id);
  }, [availableClis, cliId]);

  const install = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/${encodeURIComponent(skill.slug)}/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: mode, cliId: mode === "cli" ? cliId : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Install failed (${res.status})`);
      setResult(body);
      if (typeof onDone === "function") onDone();
    } catch (err) {
      setError(err.message || "Install failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-border-subtle bg-bg shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-main truncate">Install {skill.name}</h2>
            <p className="text-xs text-text-muted">{skill.source === MIAWROUTER ? "Built-in catalog skill" : "skills.sh skill"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2 text-text-muted cursor-pointer"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {!result && (
            <>
              <div className="space-y-2">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Install target</span>
                <label className={cn("flex items-start gap-2 rounded-lg border p-3 cursor-pointer", mode === MIAWROUTER ? "border-primary/40 bg-primary/5" : "border-border-subtle")}>
                  <input type="radio" name="target" className="mt-0.5" checked={mode === MIAWROUTER} onChange={() => setMode(MIAWROUTER)} />
                  <span className="text-xs">
                    <span className="font-medium text-text-main">{miawTarget?.label || "MiawRouter global registry"}</span>
                    <span className="block text-text-muted">Records the skill and writes its manifest into the MiawRouter registry.</span>
                  </span>
                </label>
                {availableClis.length > 0 && (
                  <label className={cn("flex items-start gap-2 rounded-lg border p-3 cursor-pointer", mode === "cli" ? "border-primary/40 bg-primary/5" : "border-border-subtle")}>
                    <input type="radio" name="target" className="mt-0.5" checked={mode === "cli"} onChange={() => setMode("cli")} />
                    <span className="text-xs">
                      <span className="font-medium text-text-main">Detected CLI (global)</span>
                      <span className="block text-text-muted">Records the intent and returns the canonical install command.</span>
                    </span>
                  </label>
                )}
                {availableClis.length > 0 && (
                  <label className={cn("flex items-start gap-2 rounded-lg border p-3 cursor-pointer", mode === "both" ? "border-primary/40 bg-primary/5" : "border-border-subtle")}>
                    <input type="radio" name="target" className="mt-0.5" checked={mode === "both"} onChange={() => setMode("both")} />
                    <span className="text-xs">
                      <span className="font-medium text-text-main">Both</span>
                      <span className="block text-text-muted">MiawRouter registry plus all detected CLI targets.</span>
                    </span>
                  </label>
                )}
              </div>

              {mode === "cli" && availableClis.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">CLI</span>
                  <select
                    value={cliId}
                    onChange={(e) => setCliId(e.target.value)}
                    className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {availableClis.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {availableClis.length === 0 && (
                <p className="text-xs text-text-muted">
                  No supported CLI targets were detected on this host. You can still install into the
                  MiawRouter registry, or copy the command from the Manual CLI section.
                </p>
              )}

              {error && <p className="text-xs text-red-500">{error}</p>}
            </>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                <span className="font-medium">Installed</span>
              </div>
              {result.targets?.map((t) => (
                <div key={t.id} className="rounded-lg border border-border-subtle p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text-main">{t.label}</span>
                    {t.command ? <CopyButton value={t.command} /> : <Badge variant="success" size="sm">recorded</Badge>}
                  </div>
                  {t.command && (
                    <code className="block text-[11px] font-mono text-text-muted break-all">{t.command}</code>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-subtle">
          {result ? (
            <Button variant="primary" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={install} disabled={busy}>
                {busy ? "Installing…" : "Install"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillCard({ skill, targets, onInstall }) {
  const installed = skill.installed === true;
  const isRemote = skill.source !== MIAWROUTER;
  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
            <Badge variant={isRemote ? "info" : "default"} size="sm">{skill.source}</Badge>
            {skill.builtin && <Badge variant="default" size="sm">built-in</Badge>}
            {installed && <Badge variant="success" size="sm" dot>installed</Badge>}
          </div>
          <p className="text-xs text-text-muted mt-1">{skill.description}</p>
          <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-text-muted">
            {skill.endpoint && (
              <code className="px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle font-mono">{skill.endpoint}</code>
            )}
            {isRemote && skill.installs > 0 && <span>↘ {skill.installs.toLocaleString()} installs</span>}
            {isRemote && skill.sourceRef && <span className="truncate max-w-[220px]">{skill.sourceRef}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {installed ? (
            <Badge variant="success" size="sm">✓ Installed</Badge>
          ) : (
            <Button variant="primary" size="sm" onClick={() => onInstall(skill)} icon="download">
              Install
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function SkillDiscoveryPageClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [installedFilter, setInstalledFilter] = useState("all");
  const [installSkill, setInstallSkill] = useState(null);

  const buildUrl = useCallback(({ query, source, installed }) => {
    const qs = new URLSearchParams();
    const q = query?.trim();
    if (q) qs.set("query", q.slice(0, 100));
    if (source && source !== "all") qs.set("source", source);
    if (installed === "installed") qs.set("installed", "true");
    if (installed === "not-installed") qs.set("installed", "false");
    const s = qs.toString();
    return s ? `${API_URL}?${s}` : API_URL;
  }, []);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(buildUrl(params), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err.message || "Failed to load skill discovery");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  // Debounced server-side search/filter — skills.sh is search-only, so a query
  // of 2+ characters triggers the remote search via the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      load({ query: search, source: sourceFilter, installed: installedFilter });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, sourceFilter, installedFilter, load]);

  const items = data?.items || [];
  const sources = data?.sources || [];
  const targets = data?.targets || [];
  const counts = data?.counts || {};
  const detected = data?.detected || [];

  const installedCount = useMemo(() => items.filter((s) => s.installed).length, [items]);

  const detectedClis = targets.filter((t) => t.id !== MIAWROUTER && t.available);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            Skill Discovery
          </h1>
          <p className="text-sm text-text-muted">
            Search the built-in catalog and the skills.sh directory, then install with one click.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading} icon="refresh">
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error && <Card className="border-red-500/30 text-sm text-red-500" padding="sm">{error}</Card>}

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { title: "Total Skills", value: counts.total ?? items.length, icon: "extension" },
          { title: "Built-in", value: counts.local ?? 0, icon: "hub" },
          { title: "From skills.sh", value: counts.remote ?? 0, icon: "cloud" },
          { title: "Installed", value: counts.installed ?? installedCount, icon: "check_circle" },
        ].map((c) => (
          <Card key={c.title} padding="sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-1.5 rounded-md bg-bg text-text-muted">
                <span className="material-symbols-outlined text-[18px]">{c.icon}</span>
              </div>
              <span className="text-xs text-text-muted">{c.title}</span>
            </div>
            <p className="text-2xl font-semibold text-text-main">{loading ? "—" : c.value}</p>
          </Card>
        ))}
      </div>

      {/* Detected on this host */}
      {detected.length > 0 && (
        <Card padding="sm">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">manage_search</span>
            <div className="text-xs text-text-muted space-y-2 flex-1">
              <p className="font-medium text-text-main">
                {detected.length} skill{detected.length !== 1 ? "s" : ""} detected on this host
              </p>
              <div className="flex flex-wrap gap-1.5">
                {detected.map((d) => (
                  <span
                    key={`${d.source}-${d.slug}`}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
                    style={{ borderColor: "var(--color-rule)" }}
                  >
                    <span className="material-symbols-outlined text-[12px] text-green-500">check_circle</span>
                    <span className="text-text-main">{d.slug}</span>
                    <span className="text-text-muted">· {d.source}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Source statuses */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((s) => <SourceStatus key={s.id} source={s} />)}
        </div>
      )}

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
            placeholder="Search skills by name, ID, or description…"
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-border-subtle bg-surface text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle">
          {[{ v: "all", l: "All" }, { v: MIAWROUTER, l: "Built-in" }, { v: "skills.sh", l: "skills.sh" }].map((f) => (
            <button
              key={f.v}
              onClick={() => setSourceFilter(f.v)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                sourceFilter === f.v ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              {f.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle">
          {[{ v: "all", l: "Any" }, { v: "installed", l: "Installed" }, { v: "not-installed", l: "Not installed" }].map((f) => (
            <button
              key={f.v}
              onClick={() => setInstalledFilter(f.v)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                installedFilter === f.v ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              {f.l}
            </button>
          ))}
        </div>
      </div>

      {/* Skill list */}
      {loading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
      ) : items.length === 0 ? (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">extension</span>
            <p className="text-sm text-text-muted">
              {search.trim().length >= 2 ? "No skills match your search." : "No skills available."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((skill) => (
            <SkillCard key={skill.id} skill={skill} targets={targets} onInstall={setInstallSkill} />
          ))}
        </div>
      )}

      {/* Manual CLI */}
      <Card padding="sm">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">terminal</span>
          <div className="text-xs text-text-muted space-y-2 flex-1">
            <p className="font-medium text-text-main">Manual CLI install</p>
            {detectedClis.length > 0 ? (
              <>
                <p>Detected targets on this host:</p>
                {detectedClis.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-2 py-1.5">
                    <span className="font-medium text-text-main">{t.label}</span>
                    <code className="text-[11px] font-mono">npx skills add &lt;owner/repo&gt; --skill &lt;name&gt;</code>
                  </div>
                ))}
              </>
            ) : (
              <p>No supported CLI targets detected. Install any skill by running <code className="font-mono">npx skills add &lt;owner/repo&gt; --skill &lt;name&gt;</code>.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">info</span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">Install</strong> records the skill in the MiawRouter global
              registry and writes its manifest. CLI installs surface the canonical{" "}
              <code className="font-mono">npx skills add</code> command.
            </p>
            <p>
              The server never executes shell commands or downloads third-party files. skills.sh is an
              allowlisted metadata source; if it is unreachable it is shown as unavailable — never replaced
              with fabricated entries.
            </p>
          </div>
        </div>
      </Card>

      {installSkill && (
        <InstallModal
          skill={installSkill}
          targets={targets}
          onClose={() => setInstallSkill(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
