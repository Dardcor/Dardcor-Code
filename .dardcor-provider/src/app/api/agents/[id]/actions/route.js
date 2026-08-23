import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { agentRegistry } from "@/lib/agents/service";

const ACTIONS = new Set(["launch", "adopt"]);

export async function POST(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return Response.json({ error: "Local authentication required" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!ACTIONS.has(body?.action) || Object.keys(body).some((key) => key !== "action")) {
    return Response.json({ error: "Action must be launch or adopt" }, { status: 400 });
  }
  const { id } = await params;
  const result = await agentRegistry.performAction(id, body.action);
  if (result.code === "agent_not_found") return Response.json(result, { status: 404 });
  if (!result.ok) return Response.json(result, { status: 409 });
  return Response.json(result);
}
