import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { uninstallSkill } from "@/lib/skillDiscovery/service";

export const dynamic = "force-dynamic";

const MAX_BODY = 4096;

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * POST /api/skill-discovery/[id]/uninstall
 * Body: { target: "miawrouter" | "cli" | "both" }
 *
 * Removes only installer-owned files/records for the target.
 */
export async function POST(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return Response.json({ error: "Local authentication required" }, { status: 403 });
  }
  try {
    const body = await readJsonBody(request);
    if (body === null) return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    const { id } = await params;
    const target = typeof body?.target === "string" ? body.target : "miawrouter";
    const result = await uninstallSkill(decodeURIComponent(id), target);
    if (!result.ok) {
      const status = result.code === "NOT_INSTALLED" ? 404 : result.code === "UNKNOWN_TARGET" ? 400 : 409;
      return Response.json({ error: result.error, code: result.code }, { status });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API] skill uninstall failed:", error);
    return Response.json({ error: "Uninstall failed" }, { status: 500 });
  }
}
