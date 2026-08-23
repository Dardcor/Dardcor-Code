"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import {
  FREE_TIER_PROVIDERS,
  FREE_TIER_MODEL_RECORDS,
  FREE_TIER_MODELS_BY_PROVIDER,
  FREE_TIER_CATALOG_SOURCE,
} from "open-sse/config/freeTierCatalog.js";
import { Card, Badge } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { useHeaderSearchStore } from "@/store/headerSearchStore";

// ToS severity sort order — "ok" first, "avoid" last
const TOS_ORDER = { ok: 0, caution: 1, ambiguous: 2, unknown: 3, avoid: 4 };

// Free type labels for display
const FREE_TYPE_LABELS = {
  "recurring-daily": "Daily",
  "recurring-monthly": "Monthly",
  "recurring-uncapped": "Uncapped",
  "recurring-credit": "Recurring Credit",
  "one-time-initial": "Signup Credit",
  "keyless": "Keyless",
};

const FREE_TYPE_COLORS = {
  "recurring-daily": "success",
  "recurring-monthly": "info",
  "recurring-uncapped": "success",
  "recurring-credit": "info",
  "one-time-initial": "warning",
  "keyless": "primary",
};

function formatTokens(n) {
  if (!n || n === 0) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function TosBadge({ tos }) {
  if (!tos || tos === "ok") return null;
  const map = {
    caution: { label: "ToS Caution", variant: "warning" },
    ambiguous: { label: "ToS Ambiguous", variant: "warning" },
    avoid: { label: "ToS Risk", variant: "error" },
    unknown: { label: "ToS Unknown", variant: "default" },
  };
  const info = map[tos] || map.unknown;
  return (
    <Badge variant={info.variant} size="sm">
      {info.label}
    </Badge>
  );
}

TosBadge.propTypes = { tos: PropTypes.string };

function FreeTypeBadge({ freeType }) {
  if (!freeType) return null;
  return (
    <Badge variant={FREE_TYPE_COLORS[freeType] || "default"} size="sm">
      {FREE_TYPE_LABELS[freeType] || freeType}
    </Badge>
  );
}

FreeTypeBadge.propTypes = { freeType: PropTypes.string };

function ModelChip({ model }) {
  const tokens = formatTokens(model.monthlyTokens) || formatTokens(model.creditTokens);
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-bg px-2 py-1 text-xs">
      <span className="truncate font-medium max-w-[180px]" title={model.displayName || model.modelId}>
        {model.displayName || model.modelId}
      </span>
      {tokens && (
        <span className="text-text-muted whitespace-nowrap">
          {tokens}{model.monthlyTokens ? "/day" : " credit"}
        </span>
      )}
      <FreeTypeBadge freeType={model.freeType} />
      <TosBadge tos={model.tos} />
    </div>
  );
}

ModelChip.propTypes = {
  model: PropTypes.shape({
    modelId: PropTypes.string.isRequired,
    displayName: PropTypes.string,
    monthlyTokens: PropTypes.number,
    creditTokens: PropTypes.number,
    freeType: PropTypes.string,
    tos: PropTypes.string,
  }).isRequired,
};

function ProviderSection({ provider, models, expanded, onToggle }) {
  const worstTos = models.reduce((worst, m) => {
    return (TOS_ORDER[m.tos] || 0) > (TOS_ORDER[worst] || 0) ? m.tos : worst;
  }, null);

  return (
    <Card padding="sm" className="overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 text-left cursor-pointer"
      >
        <div
          className="size-10 shrink-0 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: provider.color?.length > 7
              ? provider.color
              : (provider.color || "#888") + "15",
          }}
        >
          <ProviderIcon
            providerId={provider.id}
            alt={provider.name}
            size={36}
            className="object-contain rounded-lg max-w-[36px] max-h-[36px]"
            fallbackIcon={provider.icon}
            fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
            fallbackColor={provider.color}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{provider.name}</h3>
            {provider.noAuth && (
              <Badge variant="success" size="sm">No Key</Badge>
            )}
            <Badge variant="default" size="sm">
              {models.length} model{models.length !== 1 ? "s" : ""}
            </Badge>
            {worstTos && worstTos !== "ok" && <TosBadge tos={worstTos} />}
          </div>
          {provider.freeNote && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
              {provider.freeNote}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {provider.website && (
            <a
              href={provider.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-md hover:bg-bg text-text-muted hover:text-text-main transition-colors"
              title={`Visit ${provider.name} website`}
            >
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            </a>
          )}
          <span
            className="material-symbols-outlined text-[18px] text-text-muted transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            expand_more
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border-subtle space-y-2">
          {/* Auth hint */}
          {provider.authHint && (
            <div className="flex items-start gap-2 text-xs text-text-muted bg-bg rounded-md p-2">
              <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">key</span>
              <span>{provider.authHint}</span>
            </div>
          )}

          {/* Notice */}
          {provider.notice?.text && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/5 rounded-md p-2">
              <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">info</span>
              <span>{provider.notice.text}</span>
            </div>
          )}

          {/* Models grid */}
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <ModelChip key={m.modelId} model={m} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

ProviderSection.propTypes = {
  provider: PropTypes.object.isRequired,
  models: PropTypes.array.isRequired,
  expanded: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
};

export default function FreeTiersPage() {
  const [expandedId, setExpandedId] = useState(null);
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch("Search free providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  // Build sorted provider list with models
  const { availableProviders, unavailableCount } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const available = [];
    let unavailCount = 0;

    for (const provider of FREE_TIER_PROVIDERS) {
      // Skip non-LLM service kinds (search, fetch, etc.) unless they have models
      const kinds = provider.serviceKinds || ["llm"];
      const hasLlmModels = (FREE_TIER_MODELS_BY_PROVIDER[provider.id] || []).length > 0;
      if (!kinds.includes("llm") && !hasLlmModels) continue;

      if (!provider.available) {
        unavailCount++;
        continue;
      }

      // Search filter
      if (q && !provider.name.toLowerCase().includes(q)) {
        const models = FREE_TIER_MODELS_BY_PROVIDER[provider.id] || [];
        const modelMatch = models.some(
          (m) => (m.displayName || m.modelId).toLowerCase().includes(q)
        );
        if (!modelMatch) continue;
      }

      const models = (FREE_TIER_MODELS_BY_PROVIDER[provider.id] || [])
        .filter((m) => !m.disabled)
        .sort((a, b) => {
          // Sort by TosOrder ascending, then alphabetically
          const ta = TOS_ORDER[a.tos] ?? 3;
          const tb = TOS_ORDER[b.tos] ?? 3;
          if (ta !== tb) return ta - tb;
          return (a.displayName || a.modelId).localeCompare(b.displayName || b.modelId);
        });

      if (models.length === 0) continue;

      available.push({ provider, models });
    }

    // Sort: noAuth first, then by model count desc, then alphabetical
    available.sort((a, b) => {
      const na = a.provider.noAuth ? 1 : 0;
      const nb = b.provider.noAuth ? 1 : 0;
      if (na !== nb) return nb - na;
      if (a.models.length !== b.models.length) return b.models.length - a.models.length;
      return a.provider.name.localeCompare(b.provider.name);
    });

    return { availableProviders: available, unavailableCount: unavailCount };
  }, [searchQuery]);

  const totalModels = availableProviders.reduce((sum, p) => sum + p.models.length, 0);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold">Free Tier Providers</h1>
          <Badge variant="success" size="md">
            {availableProviders.length} provider{availableProviders.length !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="info" size="md">
            {totalModels} model{totalModels !== 1 ? "s" : ""}
          </Badge>
          {unavailableCount > 0 && (
            <Badge variant="default" size="md">
              {unavailableCount} catalog-only
            </Badge>
          )}
        </div>
        <p className="text-sm text-text-muted">
          Available free-tier providers and models.
          Catalog sourced from{" "}
          <span className="font-medium text-text-main">{FREE_TIER_CATALOG_SOURCE.repository}</span>
          {" · "}curated {FREE_TIER_CATALOG_SOURCE.modelCatalogCuratedAt}
        </p>
      </div>

      {/* Rankings link */}
      <Link
        href="/dashboard/free-provider-rankings"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <span className="material-symbols-outlined text-[16px]">emoji_events</span>
        View Provider Rankings
      </Link>

      {/* Provider list */}
      {availableProviders.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <span className="material-symbols-outlined text-[40px] text-text-muted mb-2 block">
            inventory_2
          </span>
          <p className="text-text-muted text-sm">
            {searchQuery.trim()
              ? "No free providers match your search"
              : "No available free tier providers found"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {availableProviders.map(({ provider, models }) => (
            <ProviderSection
              key={provider.id}
              provider={provider}
              models={models}
              expanded={expandedId === provider.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === provider.id ? null : provider.id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
