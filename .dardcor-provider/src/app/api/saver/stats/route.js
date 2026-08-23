import { NextResponse } from "next/server";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

/**
 * GET /api/saver/stats?period=7d
 *
 * Contract with backend getSaverStats(period):
 * {
 *   period: string,
 *   stages: {
 *     caveman:  { requests, tokensBefore, tokensAfter },
 *     ponytail: { requests, tokensBefore, tokensAfter },
 *     rtk:      { hits, bytesBefore, bytesAfter },   // bytes → token conversion is an estimate
 *     headroom: { requests, tokensBefore, tokensAfter },  // proxy-reported token counts
 *     pxpipe:   { requests, tokensBefore, tokensAfter }   // estimate
 *   },
 *   provider: { dispatched },   // provider-dispatched request baseline — savings count only these
 *   totals:   { savedTokens, estimatedTokens },  // weighted sums (estimated portion marked separately)
 *   timeline: [ { label, savedTokens, estimated } ]  // estimated = est-only portion of savedTokens
 * }
 * Missing/non-numeric fields are tolerated by the panel and rendered as "—".
 */

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    // ponytail: dynamic import keeps the build green until the backend lands
    // getSaverStats in src/lib/db/index.js — the route itself doesn't change.
    const { getSaverStats } = await import("@/lib/db/index.js");
    if (typeof getSaverStats !== "function") {
      return NextResponse.json({ error: "Token-saver metrics not available yet" }, { status: 501 });
    }

    const stats = await getSaverStats({ period });
    const stages = Object.fromEntries(Object.entries(stats.byStage || {}).map(([name, item]) => [name, {
      requests: item.applied || 0,
      savings: item.savings || 0,
      valueBasis: item.basis || null,
      bytesBefore: item.basis === "bytes" ? item.savings : null,
      bytesAfter: item.basis === "bytes" ? 0 : null,
    }]));
    return NextResponse.json({
      ...stats,
      stages,
      provider: { dispatched: stats.dispatched || 0 },
      totals: {
        ...stats.totals,
        savedTokens: (stats.totals?.reported || 0) + (stats.totals?.estimate || 0) + (stats.totals?.bytes || 0) / 4,
        estimatedTokens: (stats.totals?.estimate || 0) + (stats.totals?.bytes || 0) / 4,
        reportedTokens: stats.totals?.reported || 0,
      },
      timeline: [],
    });
  } catch (error) {
    console.error("[API] Failed to get token-saver stats:", error);
    return NextResponse.json({ error: "Failed to fetch token-saver stats" }, { status: 500 });
  }
}
