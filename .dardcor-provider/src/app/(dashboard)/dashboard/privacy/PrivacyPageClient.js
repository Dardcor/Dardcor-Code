"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Toggle, Badge, ConfirmModal, CardSkeleton } from "@/shared/components";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { useNotificationStore } from "@/store/notificationStore";
import { PRIVACY_MODES } from "@/lib/privacy/privacyMode";

// Mode ids + permission matrix come from the runtime (src/lib/privacy/privacyMode.js);
// only labels/icons/descriptions and the presets below are UI-owned.
// A null preset leaves the user's current toggle untouched (user-controlled).
const MODE_META = {
  normal: {
    label: "Normal",
    icon: "tune",
    desc: "Balanced default. Every behavior follows your toggles below — exact-match cache on by default, semantic cache and content dedup off.",
  },
  "private-cache": {
    label: "Private cache",
    icon: "lock",
    desc: "Exact-match and content-dedup caching stay under your control. The semantic cache (L2) only ever runs against a local embedding model, and anything shipping the body to an external service (request logs, headroom proxy, pxpipe) is forced off.",
  },
  "private-no-cache": {
    label: "Private no cache",
    icon: "lock_open",
    desc: "No local response caching at all — L1/L2/L3 are forced off. Request bodies are never retained between requests.",
  },
  strict: {
    label: "Strict",
    icon: "shield",
    desc: "Nothing is cached or retained locally, and your blocked-providers list is enforced — blocked providers are never routed to.",
  },
  "local-only": {
    label: "Local only",
    icon: "home",
    desc: "Strictest posture: no caching, no retention, blocked providers enforced, and only self-hosted (local) connections can be routed to.",
  },
};

// Presets applied to the cache toggles when a mode is selected (null = keep current).
// Mirrors MODE_TABLE: private-cache keeps L1/L3 user-controllable and gates L2 behind
// a local embedding model; private-no-cache/strict/local-only force all caches off.
const MODE_PRESETS = {
  normal: { l1: null, l2: null, l3: null },
  "private-cache": { l1: null, l2: false, l3: null },
  "private-no-cache": { l1: false, l2: false, l3: false },
  strict: { l1: false, l2: false, l3: false },
  "local-only": { l1: false, l2: false, l3: false },
};

const MODE_OPTIONS = PRIVACY_MODES.map((id) => ({
  id,
  ...MODE_META[id],
  presets: MODE_PRESETS[id] || { l1: null, l2: null, l3: null },
}));

// Runtime enforcement (src/sse/handlers/chat.js): blocked list is enforced only in
// strict/local-only; local-only also restricts routing to self-hosted connections.
const MATRIX_ROWS = [
  { behavior: "Store identical responses locally (L1)", cells: { normal: "On by default", "private-cache": "User-controlled", "private-no-cache": "Off", strict: "Off", "local-only": "Off" } },
  { behavior: "Semantic similarity cache (L2)", cells: { normal: "Off by default", "private-cache": "Local model only", "private-no-cache": "Off", strict: "Off", "local-only": "Off" } },
  { behavior: "Request-body content dedup rewrite (L3)", cells: { normal: "Off by default", "private-cache": "User-controlled", "private-no-cache": "Off", strict: "Off", "local-only": "Off" } },
  { behavior: "Provider-side prompt caching (L0)", cells: { normal: "Provider-controlled", "private-cache": "Provider-controlled", "private-no-cache": "Provider-controlled", strict: "Provider-controlled", "local-only": "Provider-controlled" } },
  { behavior: "Routing to blocked providers", cells: { normal: "Not enforced", "private-cache": "Not enforced", "private-no-cache": "Not enforced", strict: "Enforced", "local-only": "Enforced" } },
  { behavior: "Connections used for routing", cells: { normal: "Any", "private-cache": "Any", "private-no-cache": "Any", strict: "Any", "local-only": "Self-hosted only" } },
];

const AUTH_LABELS = {
  oauth: "OAuth",
  apikey: "API Key",
  api_key: "API Key",
  cookie: "Cookie",
  free: "Free",
};

export default function PrivacyPageClient() {
  const notify = useNotificationStore();
  const [loading, setLoading] = useState(true);
  const [privacyMode, setPrivacyMode] = useState("normal");
  const [cacheL1, setCacheL1] = useState(true);
  const [cacheL2, setCacheL2] = useState(false);
  const [cacheL3, setCacheL3] = useState(false);
  const [connections, setConnections] = useState([]);
  const [blockedProviders, setBlockedProviders] = useState([]);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const patchSettings = useCallback(
    async (patch, opts = {}) => {
      setSaving(true);
      try {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("Settings update failed");
        if (opts.success) notify.success(opts.success);
      } catch (error) {
        console.log("Error updating setting:", error);
        notify.error(opts.error || "Failed to save setting");
      } finally {
        setSaving(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [settingsRes, providersRes] = await Promise.all([
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/providers", { cache: "no-store" }),
        ]);
        const settings = settingsRes.ok ? await settingsRes.json() : {};
        const providersData = providersRes.ok ? await providersRes.json() : {};
        setPrivacyMode(settings.privacyMode || "normal");
        setCacheL1(settings.cacheL1Enabled !== false);
        setCacheL2(settings.cacheL2Enabled === true);
        setCacheL3(settings.cacheL3Enabled === true);
        setBlockedProviders(Array.isArray(settings.privacyBlockedProviders) ? settings.privacyBlockedProviders : []);
        setConnections(providersData.connections || []);
      } catch (error) {
        console.log("Error loading privacy page:", error);
        notify.error("Failed to load privacy settings");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [notify]);

  const handleModeChange = (modeId) => {
    const mode = MODE_OPTIONS.find((m) => m.id === modeId);
    if (!mode) return;
    const presets = mode.presets;
    setPrivacyMode(modeId);
    if (presets.l1 !== null) setCacheL1(presets.l1);
    if (presets.l2 !== null) setCacheL2(presets.l2);
    if (presets.l3 !== null) setCacheL3(presets.l3);
    const patch = { privacyMode: modeId };
    if (presets.l1 !== null) patch.cacheL1Enabled = presets.l1;
    if (presets.l2 !== null) patch.cacheL2Enabled = presets.l2;
    if (presets.l3 !== null) patch.cacheL3Enabled = presets.l3;
    patchSettings(patch, { success: `Privacy mode set to ${mode.label}` });
  };

  const handleCacheToggle = (key, value, label) => {
    if (key === "cacheL1Enabled") setCacheL1(value);
    if (key === "cacheL2Enabled") setCacheL2(value);
    if (key === "cacheL3Enabled") setCacheL3(value);
    patchSettings({ [key]: value }, { success: `${label} ${value ? "enabled" : "disabled"}` });
  };

  const handleClearCache = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      const res = await fetch("/api/cache/clear", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Clear failed");
      notify.success("Local response caches cleared");
    } catch (error) {
      console.log("Error clearing cache:", error);
      notify.error(error.message || "Failed to clear cache");
    } finally {
      setClearing(false);
    }
  };

  // Block/unblock one provider: only the settings list is patched and the local
  // state updated. Connections stay configured and active — the runtime enforces
  // the list at routing time (strict/local-only), never by disabling connections.
  const toggleBlockProvider = async (providerId) => {
    const isBlocked = blockedProviders.includes(providerId);
    const nextBlocked = isBlocked
      ? blockedProviders.filter((id) => id !== providerId)
      : [...new Set([...blockedProviders, providerId])];

    setBlockedProviders(nextBlocked);
    await patchSettings(
      { privacyBlockedProviders: nextBlocked },
      { success: isBlocked ? `${providerId} unblocked` : `${providerId} blocked` }
    );
  };

  const blockedCount = blockedProviders.length;
  const blockedConnections = connections.filter((c) => blockedProviders.includes(c.provider));

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
          <span className="material-symbols-outlined text-primary">privacy_tip</span>
          Privacy
        </h1>
        <p className="text-sm text-text-muted">
          Control what MiawRouter retains locally and which providers it routes to. MiawRouter never
          sends your data anywhere except the providers you connect — nothing leaves your machine otherwise.
        </p>
      </div>

      {/* Privacy mode */}
      <Card
        title="Privacy mode"
        subtitle="Choose the posture you want; the mode applies the cache settings below."
        icon="tune"
      >
        <SegmentedControl
          ariaLabel="Privacy mode"
          options={MODE_OPTIONS.map((m) => ({ value: m.id, label: m.label, icon: m.icon }))}
          value={privacyMode}
          onChange={handleModeChange}
        />
        <p className="text-sm text-text-muted mt-3">
          {MODE_OPTIONS.find((m) => m.id === privacyMode)?.desc}
        </p>
        <p className="text-xs text-text-muted mt-1">
          Your preference is stored in settings (<code className="font-mono">privacyMode</code>).
          Modes act as permission gates over the toggles below: behaviors a mode forbids stay off
          at runtime regardless of the toggle setting.
        </p>
      </Card>

      {/* Effective behavior matrix */}
      <Card
        title="Effective behavior"
        subtitle="What each mode does across the router's privacy-relevant behaviors."
        icon="table_rows"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Privacy mode behavior matrix">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="text-left font-medium text-text-muted py-2 pr-4">
                  Behavior
                </th>
                {MODE_OPTIONS.map((m) => (
                  <th
                    key={m.id}
                    scope="col"
                    className={`text-left font-medium py-2 px-3 whitespace-nowrap rounded-t ${
                      privacyMode === m.id
                        ? "bg-primary/10 text-primary"
                        : "text-text-muted"
                    }`}
                  >
                    {m.label}
                    {privacyMode === m.id && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide">· current</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map((row) => (
                <tr key={row.behavior} className="border-b border-border-subtle last:border-b-0">
                  <td className="py-2.5 pr-4 text-text-main">{row.behavior}</td>
                  {MODE_OPTIONS.map((m) => (
                    <td
                      key={m.id}
                      className={`py-2.5 px-3 whitespace-nowrap ${
                        privacyMode === m.id ? "text-primary font-medium" : "text-text-muted"
                      }`}
                    >
                      {row.cells[m.id]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted mt-3">
          Provider-side prompt caching (L0) is controlled by the upstream provider and its pricing —
          MiawRouter cannot force it off. The blocked-providers list is enforced at routing time in
          strict and local-only modes; local-only additionally routes only to self-hosted connections.
        </p>
      </Card>

      {/* Cache & data retention */}
      <Card
        title="Cache & data retention"
        subtitle="Local response caches keep identical or similar responses so repeat requests never reach a provider."
        icon="database"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="delete_sweep"
            onClick={() => setShowClearConfirm(true)}
            disabled={clearing}
          >
            {clearing ? "Clearing…" : "Clear cache"}
          </Button>
        }
      >
        <div className="flex items-center justify-between gap-4 flex-wrap border-b border-border pb-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Exact-match cache (L1)</p>
            <p className="text-sm text-text-muted">
              Stores exact responses locally (in memory, TTL-bounded) for deterministic, non-streaming
              requests. Disabling means repeat identical requests are sent to the provider again.
            </p>
          </div>
          <Toggle
            checked={cacheL1}
            disabled={saving}
            onChange={() => handleCacheToggle("cacheL1Enabled", !cacheL1, "Exact-match cache")}
            ariaLabel="Exact-match cache"
          />
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap py-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Semantic cache (L2)</p>
            <p className="text-sm text-text-muted">
              Reuses responses for semantically similar requests via local embeddings. Off by default —
              it retains more data and needs a configured embedding model.
            </p>
          </div>
          <Toggle
            checked={cacheL2}
            disabled={saving}
            onChange={() => handleCacheToggle("cacheL2Enabled", !cacheL2, "Semantic cache")}
            ariaLabel="Semantic cache"
          />
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap py-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Content dedup (L3)</p>
            <p className="text-sm text-text-muted">
              Rewrites repeated large blocks in the last message with compact references. Off by default
              because it modifies the request body.
            </p>
          </div>
          <Toggle
            checked={cacheL3}
            disabled={saving}
            onChange={() => handleCacheToggle("cacheL3Enabled", !cacheL3, "Content dedup")}
            ariaLabel="Content dedup"
          />
        </div>
        <p className="text-xs text-text-muted pt-4">
          Caches are in-memory and bounded (entries expire automatically).{" "}
          <strong>Clear cache</strong> empties L1/L2/L3 immediately. Disabling every layer means the
          router retains nothing between requests. Modes that force caching off (private-no-cache,
          strict, local-only) override these toggles at runtime.
        </p>
      </Card>

      {/* Blocked providers */}
      <Card
        title="Blocked providers"
        subtitle="Providers listed here are never routed to in strict and local-only modes. Blocking only stops routing — your connections stay configured and active."
        icon="block"
      >
        {connections.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-4 border border-dashed border-border rounded-xl text-text-muted text-sm">
            <span className="material-symbols-outlined text-[18px]">link_off</span>
            <span>No provider connections configured yet.</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <Badge variant={blockedCount > 0 ? "error" : "default"} size="sm">
                {blockedCount} blocked
              </Badge>
              {blockedCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    [...new Set(connections.map((c) => c.provider))].forEach((p) => {
                      if (blockedProviders.includes(p)) toggleBlockProvider(p);
                    });
                  }}
                  className="text-xs text-primary underline hover:opacity-80"
                >
                  Unblock all
                </button>
              )}
            </div>
            {[...new Set(connections.map((c) => c.provider))].map((providerId) => {
              const conns = connections.filter((c) => c.provider === providerId);
              const isBlocked = blockedProviders.includes(providerId);
              return (
                <Card.Row key={providerId}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{conns[0]?.name || providerId}</p>
                        <code className="text-[10px] font-mono text-text-muted">{providerId}</code>
                        {conns.length > 1 && (
                          <span className="text-[10px] text-text-muted">{conns.length} connections</span>
                        )}
                        {isBlocked && (
                          <Badge variant="error" size="sm">
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">block</span>
                              Blocked
                            </span>
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">
                        {conns
                          .map((c) => AUTH_LABELS[c.authType] || c.authType)
                          .filter((v, i, arr) => arr.indexOf(v) === i)
                          .join(", ") || "No auth type"}
                      </p>
                    </div>
                    <Toggle
                      size="sm"
                      checked={!isBlocked}
                      disabled={saving}
                      onChange={() => toggleBlockProvider(providerId)}
                      ariaLabel={`${providerId} routing`}
                      title={isBlocked ? "Unblock provider" : "Block provider"}
                    />
                  </div>
                </Card.Row>
              );
            })}
            {blockedConnections.length > 0 && (
              <p className="text-xs text-text-muted pt-3">
                Blocking stops the router from sending requests to that provider in strict and
                local-only modes; connections remain configured and active. Your blocked list is
                stored in settings (<code className="font-mono">privacyBlockedProviders</code>).
              </p>
            )}
          </>
        )}
      </Card>

      {/* Training disclosure */}
      <Card title="Training & your data" icon="school">
        <div className="flex flex-col gap-3 text-sm text-text-muted">
          <p>
            MiawRouter cannot force an external provider to exclude your data from training. Once a
            request reaches a provider, its use of that data (including model training) is governed by
            that provider&apos;s terms — not by this router.
          </p>
          <p>What you can control:</p>
          <ul className="list-disc list-inside flex flex-col gap-1">
            <li>
              <strong className="text-text-main">Don&apos;t send data</strong> — block providers above
              (enforced in strict and local-only modes) or remove their connections. This is the only
              guarantee that a provider never sees the data.
            </li>
            <li>
              <strong className="text-text-main">Don&apos;t retain locally</strong> — disable all cache
              layers and clear the cache above; the router then keeps nothing between requests.
            </li>
            <li>
              <strong className="text-text-main">Keep it local</strong> — self-hosted providers
              (whisper.cpp, llama.cpp, vLLM, Kokoro) never leave your machine, and the local-only
              mode restricts routing to them. Nothing is sent to any provider you haven&apos;t connected.
            </li>
          </ul>
        </div>
      </Card>

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearCache}
        title="Clear local response caches"
        message="Empties the in-memory L1/L2/L3 caches now. The next identical request will be sent to the provider again. Continue?"
        confirmText="Clear cache"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
