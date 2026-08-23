import { NextResponse } from "next/server";
import { getOpenCodeModelList } from "@/lib/catalog/opencodeCatalog";

export const dynamic = "force-dynamic";

// GET /api/catalog/opencode — protected by dashboardGuard (deny-by-default
// for /api/* paths). Returns the cached OpenCode Zen catalog with free
// classification, retention metadata, added/removed diff and freshness flags.
export async function GET() {
  try {
    const { models, freeModels, diff, fetchedAt, stale, error } = await getOpenCodeModelList();
    return NextResponse.json({ models, freeModels, diff, fetchedAt, stale, error });
  } catch (err) {
    return NextResponse.json({
      models: [],
      freeModels: [],
      diff: { added: [], removed: [] },
      fetchedAt: null,
      stale: true,
      error: err?.message || String(err),
    });
  }
}
