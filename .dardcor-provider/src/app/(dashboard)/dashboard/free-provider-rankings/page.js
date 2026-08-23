"use client";

import { useMemo } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import {
  FREE_TIER_PROVIDERS,
  FREE_TIER_MODEL_RECORDS,
  FREE_TIER_MODELS_BY_PROVIDER,
} from "open-sse/config/freeTierCatalog.js";
import { Card, Badge } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";

function formatTokens(n) {
  if (!n || n === 0) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const TOS_LABELS = {
  ok: { label: "Clean", color: "text-green-600 dark:text-green-400" },
  caution: { label: "Caution", color: "text-yellow-600 dark:text-yellow-400" },
  ambiguous: { label: "Ambiguous", color: "text-orange-500" },
  avoid: { label: "Avoid", color: "text-red-500" },
  unknown: { label: "Unknown", color: "text-text-muted" },
};

function RankBadge({ rank }) {
  const styles =
    rank === 1
      ? "bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 border-yellow-400/30"
      : rank === 2
        ? "bg-gray-300/20 text-gray-600 dark:text-gray-300 border-gray-300/30"
        : rank === 3
          ? "bg-orange-400/20 text-orange-600 dark:text-orange-400 border-orange-400/30"
          : "bg-bg text-text-muted border-border-subtle";
  return (
    <span
      className={`inline-flex items-center justify-center size-7 rounded-full text-xs font-bold border ${styles}`}
    >
      {rank}
    </span>
  );
}

RankBadge.propTypes = { rank: PropTypes.number.isRequired };

function RankingRow({ rank, provider, modelCount, totalDaily, totalCredit, worstTos, noAuth }) {
  const tosInfo = TOS_LABELS[worstTos] || TOS_LABELS.unknown;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5 hover:border-primary/20 transition-colors">
      <RankBadge rank={rank} />
      <div
        className="size-9 shrink-0 rounded-lg flex items-center justify-center"
        style={{
          backgroundColor: provider.color?.length > 7
            ? provider.color
            : (provider.color || "#888") + "15",
        }}
      >
        <ProviderIcon
          providerId={provider.id}
          alt={provider.name}
          size={32}
          className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
          fallbackIcon={provider.icon}
          fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
          fallbackColor={provider.color}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm truncate">{provider.name}</span>
          {noAuth && (
            <Badge variant="success" size="sm">No Key</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5 flex-wrap">
          <span>{modelCount} model{modelCount !== 1 ? "s" : ""}</span>
          {totalDaily > 0 && (
            <>
              <span className="text-border">·</span>
              <span>{formatTokens(totalDaily)} tokens/day</span>
            </>
          )}
          {totalCredit > 0 && (
            <>
              <span className="text-border">·</span>
              <span>{formatTokens(totalCredit)} signup credit</span>
            </>
          )}
          {provider.freeNote && (
            <>
              <span className="text-border">·</span>
              <span className="truncate max-w-[300px]">{provider.freeNote}</span>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <span className={`text-xs font-medium ${tosInfo.color}`}>
          {tosInfo.label}
        </span>
        {provider.website && (
          <a
            href={provider.website}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-bg text-text-muted hover:text-text-main transition-colors"
            title={`Visit ${provider.name}`}
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          </a>
        )}
      </div>
    </div>
  );
}

RankingRow.propTypes = {
  rank: PropTypes.number.isRequired,
  provider: PropTypes.object.isRequired,
  modelCount: PropTypes.number.isRequired,
  totalDaily: PropTypes.number.isRequired,
  totalCredit: PropTypes.number.isRequired,
  worstTos: PropTypes.string,
  noAuth: PropTypes.bool,
};

export default function FreeProviderRankingsPage() {
  const rankings = useMemo(() => {
    const rows = [];

    for (const provider of FREE_TIER_PROVIDERS) {
      if (!provider.available) continue;

      const kinds = provider.serviceKinds || ["llm"];
      const models = (FREE_TIER_MODELS_BY_PROVIDER[provider.id] || []).filter(
        (m) => !m.disabled
      );
      if (models.length === 0) continue;

      const hasLlmModels = models.some(
        (m) => !["webSearch", "webFetch", "embedding"].some((k) =>
          (provider.serviceKinds || ["llm"]).includes(k) && !provider.serviceKinds?.includes("llm")
        )
      );
      // Skip non-LLM-only providers that don't have llm kind and no models
      if (!kinds.includes("llm") && models.length === 0) continue;

      const totalDaily = models.reduce((sum, m) => sum + (m.monthlyTokens || 0), 0);
      const totalCredit = models.reduce((sum, m) => sum + (m.creditTokens || 0), 0);

      // Determine worst ToS across models
      const tosOrder = { ok: 0, caution: 1, ambiguous: 2, unknown: 3, avoid: 4 };
      const worstTos = models.reduce((worst, m) => {
        return (tosOrder[m.tos] || 0) > (tosOrder[worst] || 0) ? m.tos : worst;
      }, null);

      rows.push({
        provider,
        modelCount: models.length,
        totalDaily,
        totalCredit,
        worstTos,
        noAuth: !!provider.noAuth,
      });
    }

    // Sort: modelCount desc, then totalDaily desc, then totalCredit desc, then name
    rows.sort((a, b) => {
      if (a.modelCount !== b.modelCount) return b.modelCount - a.modelCount;
      if (a.totalDaily !== b.totalDaily) return b.totalDaily - a.totalDaily;
      if (a.totalCredit !== b.totalCredit) return b.totalCredit - a.totalCredit;
      return a.provider.name.localeCompare(b.provider.name);
    });

    return rows;
  }, []);

  // Summary stats
  const totalProviders = rankings.length;
  const totalModels = rankings.reduce((s, r) => s + r.modelCount, 0);
  const keylessCount = rankings.filter((r) => r.noAuth).length;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold">Free Provider Rankings</h1>
          <Badge variant="success" size="md">{totalProviders} providers</Badge>
          <Badge variant="info" size="md">{totalModels} models</Badge>
          {keylessCount > 0 && (
            <Badge variant="primary" size="md">{keylessCount} keyless</Badge>
          )}
        </div>
        <p className="text-sm text-text-muted">
          Ranked by model count, then by daily token budget. Only available providers shown.
        </p>
      </div>

      {/* Back link */}
      <Link
        href="/dashboard/free-tiers"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Back to Free Tiers
      </Link>

      {/* Rankings table */}
      {rankings.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <span className="material-symbols-outlined text-[40px] text-text-muted mb-2 block">
            emoji_events
          </span>
          <p className="text-text-muted text-sm">No available free tier providers found</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rankings.map((row, i) => (
            <RankingRow
              key={row.provider.id}
              rank={i + 1}
              provider={row.provider}
              modelCount={row.modelCount}
              totalDaily={row.totalDaily}
              totalCredit={row.totalCredit}
              worstTos={row.worstTos}
              noAuth={row.noAuth}
            />
          ))}
        </div>
      )}

      {/* Legend */}
      <Card padding="sm" className="text-xs text-text-muted">
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-1.5">
            <Badge variant="success" size="sm">No Key</Badge>
            <span>No API key needed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-green-600 dark:text-green-400 font-medium">Clean</span>
            <span>ToS allows proxy use</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-yellow-600 dark:text-yellow-400 font-medium">Caution</span>
            <span>Review ToS before use</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-red-500 font-medium">Avoid</span>
            <span>ToS prohibits proxy/resale</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
