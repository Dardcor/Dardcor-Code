import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { listSkills } from "@/lib/skillDiscovery/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/skill-discovery/sync
 *
 * Refreshes the allowlisted skills.sh remote catalog and reports source
 * status. Local catalog is static and always available.
 */
export async function POST(request) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return Response.json({ error: "Local authentication required" }, { status: 403 });
  }
  try {
    const data = await listSkills({ useRemote: true });
    const source = data.sources.find((s) => s.id === "skills.sh");
    return Response.json({ synced: source?.available === true, sources: data.sources }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API] skill sync failed:", error);
    return Response.json({ error: "Sync failed" }, { status: 500 });
  }
}
