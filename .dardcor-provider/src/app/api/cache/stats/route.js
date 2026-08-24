import { NextResponse } from "next/server";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

/**
 * GET /api/cache/stats?period=7d
 *
 * Contract with backend getCacheStats(period):
 * {
 *   period: string,
 *   layers: {
 *     L0: { probes, hits, readTokens },   // provider L0: probes observed, hits = cache_read > 0, readTokens = cache_read input tokens
 *     L1: { attempts, hits },             // local exact-match response cache
 *     L2: { attempts, hits },             // local semantic response cache
 *     L3: { refs, bytesSaved }            // content-address dedup (activity, not a provider cache hit)
 *   },
 *   context: {
 *     requests,          // requests evaluated by the cache pipeline
 *     bypassed,          // skipped cache (streaming, tools, X-Dardcor-Token-Saver: off, ...)
 *     dispatched,        // actually sent upstream
 *     bypassReasons: {}  // optional { [reason]: count }
 *   },
 *   timeline: [ { label, hits, misses, providerHits } ]  // local L1+L2 hits/misses and L0 provider hits per bucket
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
    // getCacheStats in src/lib/db/index.js — the route itself doesn't change.
    const { getCacheStats } = await import("@/lib/db/index.js");
    if (typeof getCacheStats !== "function") {
      return NextResponse.json({ error: "Cache metrics not available yet" }, { status: 501 });
    }

    const stats = await getCacheStats({ period });
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[API] Failed to get cache stats:", error);
    return NextResponse.json({ error: "Failed to fetch cache stats" }, { status: 500 });
  }
}
