import { NextResponse } from "next/server";
import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { a2aDependencies } from "@/lib/a2a/adapters";
import { createAgentCard } from "@/lib/a2a/card";
import { createA2ASkillRegistry } from "@/lib/a2a/core";
import { getRecentA2ATasks, recordA2ATask } from "@/lib/a2a/task-history";
import { getSettings } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export { recordA2ATask as recordTask };

function getAgentCard(baseUrl) {
  const skills = createA2ASkillRegistry(a2aDependencies).map(({ id, name, description }) => ({ id, name, description }));
  return createAgentCard(skills, baseUrl);
}

/* ── Endpoint & Auth state ─────────────────────────────────────── */

async function getEndpointState(baseUrl) {
  const settings = await getSettings().catch(() => ({}));
  const machineId = await getConsistentMachineId().catch(() => "unknown");

  const requireLogin = settings?.requireLogin ?? false;
  const hasApiKeys = !!(settings?.apiKeys && settings.apiKeys.length > 0);

  return {
    baseUrl,
    endpoint: `${baseUrl}/v1`,
    a2aEndpoint: `${baseUrl}/api/a2a`,
    auth: {
      requireLogin,
      hasApiKeys,
      machineId,
    },
  };
}

/* ── GET handler ────────────────────────────────────────────────── */

export async function GET(request) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return NextResponse.json(
      { error: "Local only: CLI token required" },
      { status: 403 }
    );
  }

  try {
    const proto = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:21128";
    const baseUrl = `${proto}://${host}`;

    const [agentCard, endpointState] = await Promise.all([
      getAgentCard(baseUrl),
      getEndpointState(baseUrl),
    ]);

    const tasks = getRecentA2ATasks();

    return NextResponse.json({
      agentCard,
      endpoint: endpointState,
      tasks,
    });
  } catch (error) {
    console.log("[a2a/status] error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
