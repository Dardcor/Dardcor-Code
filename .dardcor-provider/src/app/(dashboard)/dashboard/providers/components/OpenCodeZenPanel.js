"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { Card, Toggle } from "@/shared/components";
import { getRelativeTime } from "@/shared/utils";

const PREVIEW_IDS = 3;

function DiffList({ items, kind }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const buttonId = `${listId}-button`;
  const ids = items.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
  if (ids.length === 0) return null;
  const shown = expanded ? ids : ids.slice(0, PREVIEW_IDS);
  const hidden = ids.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {kind} ({ids.length})
      </span>
      <div id={listId} className="flex flex-wrap gap-1">
        {shown.map((id) => (
          <span
            key={id}
            className="font-mono text-[11px] tabular-nums rounded px-1.5 py-0.5 truncate max-w-[180px] bg-panel border text-muted"
            style={{ borderColor: "var(--color-rule)" }}
            title={id}
          >
            {id}
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            id={buttonId}
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-medium rounded px-1.5 py-0.5 text-muted hover:text-ink"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={expanded ? `Collapse ${kind} models` : `Show ${hidden} more ${kind} models`}
          >
            {expanded ? "collapse" : `+${hidden} more`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function OpenCodeZenPanel() {
  const [catalog, setCatalog] = useState(null);
  const [catalogLoadError, setCatalogLoadError] = useState(null);
  const [settingsLoadError, setSettingsLoadError] = useState(null);
  const [zenFreeOnly, setZenFreeOnly] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadCatalog = useCallback(async () => {
    setCatalogLoadError(null);
    try {
      const res = await fetch("/api/catalog/opencode");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") throw new Error("invalid response");
      setCatalog(data);
    } catch (err) {
      setCatalogLoadError(err.message || "load failed");
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsLoadError(null);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      if (!data || typeof data.zenFreeOnly !== "boolean") throw new Error("invalid response");
      setZenFreeOnly(data.zenFreeOnly);
    } catch (err) {
      setSettingsLoadError(err.message || "load failed");
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadSettings();
  }, [loadCatalog, loadSettings]);

  const handleToggle = async (next) => {
    const previous = zenFreeOnly;
    setZenFreeOnly(next);
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zenFreeOnly: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setZenFreeOnly(previous);
      setSaveError(`Could not save zenFreeOnly: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const models = catalog?.models || [];
  const freeCount = catalog?.freeModels?.length ?? 0;
  const total = models.length;
  const diff = catalog?.diff || { added: [], removed: [] };
  const unknownRetention = models.filter((m) => m.retention_warning === true).length;
  const fetchedAt = catalog?.fetchedAt;
  const stale = !!catalog?.stale;
  const catalogError = catalog?.error || null;

  return (
    <Card
      title="OpenCode Zen Catalog"
      subtitle="Free model availability from opencode.ai/zen"
      padding="sm"
    >
      <div className="flex flex-col gap-3">
        {catalogLoadError && (
          <div
            role="alert"
            className="rounded-[8px] px-3 py-2 text-sm bg-panel border text-fail"
            style={{ borderColor: "var(--color-rule)" }}
          >
            Could not load the Zen catalog: {catalogLoadError}
          </div>
        )}
        {settingsLoadError && (
          <div
            role="alert"
            className="rounded-[8px] px-3 py-2 text-sm bg-panel border text-fail"
            style={{ borderColor: "var(--color-rule)" }}
          >
            Could not load settings — the free-only toggle is unavailable: {settingsLoadError}
          </div>
        )}

        {catalog && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono tabular-nums text-2xl font-semibold text-ink">{freeCount}</span>
                <span className="text-sm text-muted">free of {total} models</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted">
                  Last refresh: {fetchedAt ? `${new Date(fetchedAt).toLocaleString()} (${getRelativeTime(new Date(fetchedAt).toISOString())})` : "never"}
                </span>
                {stale && !catalogError && (
                  <span role="status" className="inline-flex items-center gap-1 font-medium text-warn">
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">schedule</span>
                    Catalog may be outdated
                  </span>
                )}
              </div>
            </div>

            {catalogError && (
              <div
                role="alert"
                className="rounded-[8px] px-3 py-2 text-sm bg-panel border text-fail"
                style={{ borderColor: "var(--color-rule)" }}
              >
                Catalog unavailable: {catalogError}
              </div>
            )}

            {unknownRetention > 0 && (
              <div
                role="status"
                className="rounded-[8px] px-3 py-2 text-xs bg-panel border text-warn"
                style={{ borderColor: "var(--color-rule)" }}
              >
                Warning: {unknownRetention} model{unknownRetention === 1 ? "" : "s"} have unknown data
                retention — treat as unsafe. Zen may retain and train on submitted data for some free
                models; retention is only considered safe when explicitly documented as none.
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DiffList items={diff.added} kind="Added" />
              <DiffList items={diff.removed} kind="Removed" />
            </div>

            <div className="flex flex-col gap-1 rounded-[8px] px-3 py-2.5 bg-chassis border" style={{ borderColor: "var(--color-rule)" }}>
              <Toggle
                checked={zenFreeOnly === true}
                onChange={handleToggle}
                disabled={saving || zenFreeOnly === null}
                label="Zen free-only routing"
                description="Only route OpenCode models classified as free"
              />
              {saveError && (
                <p className="text-xs text-fail" role="alert">
                  {saveError}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
