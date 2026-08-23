import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { agentRegistry, getAgentRegistryLifecycle } from "@/lib/agents/service";

export async function GET(request) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return Response.json({ error: "Local authentication required" }, { status: 403 });
  }
  const agents = await agentRegistry.list();
  return Response.json({ agents, lifecycle: getAgentRegistryLifecycle() });
}
