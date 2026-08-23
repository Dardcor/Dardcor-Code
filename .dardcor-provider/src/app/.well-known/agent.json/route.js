import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { a2aDependencies } from "@/lib/a2a/adapters";
import { createAgentCard } from "@/lib/a2a/card";
import { createA2ASkillRegistry } from "@/lib/a2a/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!(await canAccessLocalOnlyRoute(request))) return Response.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  return Response.json(createAgentCard(createA2ASkillRegistry(a2aDependencies).map(({ id, name, description }) => ({ id, name, description })), url.origin), { headers: { "Cache-Control": "no-store" } });
}
