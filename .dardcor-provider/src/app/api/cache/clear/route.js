import { NextResponse } from "next/server";
import { hasValidCliToken, isAuthenticated } from "@/dashboardGuard";

export const dynamic = "force-dynamic";

/**
 * POST /api/cache/clear
 *
 * Clears all local cache layers (L1 exact-match, L2 semantic, L3 content-address dedup).
 * Returns { ok: true, cleared: ["L1", "L2", "L3"] } on success.
 *
 * Defense-in-depth: the middleware already denies unauthenticated /api/* access,
 * and this route re-checks the same boundary so a future allow-list change
 * cannot silently expose cache mutation.
 */
export async function POST(request) {
  if (!(await hasValidCliToken(request)) && !(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // ponytail: dynamic import keeps build green — same pattern as cache/stats route
    const [{ l1Clear }, { l2Clear }, { l3Clear }] = await Promise.all([
      import("open-sse/cache/l1.js"),
      import("open-sse/cache/l2.js"),
      import("open-sse/cache/l3.js"),
    ]);

    l1Clear();
    l2Clear();
    l3Clear();

    return NextResponse.json({ ok: true, cleared: ["L1", "L2", "L3"] });
  } catch (error) {
    console.error("[API] Failed to clear cache:", error);
    return NextResponse.json({ error: "Failed to clear cache" }, { status: 500 });
  }
}
