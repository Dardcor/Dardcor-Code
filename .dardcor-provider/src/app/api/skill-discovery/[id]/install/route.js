import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { installSkill } from "@/lib/skillDiscovery/service";

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

function errorStatus(code) {
  switch (code) {
    case "SKILL_NOT_FOUND": return 404;
    case "UNKNOWN_TARGET":
    case "UNKNOWN_CLI":
    case "CLI_NOT_DETECTED":
    case "NO_CLI_DETECTED": return 400;
    default: return 409;
  }
}

/**
 * POST /api/skill-discovery/[id]/install
 * Body: { target: "miawrouter" | "cli" | "both", cliId?: "claude" }
 *
 * Installs into the MiawRouter global registry and/or records detected CLI
 * targets with their canonical manual command. Never executes shells or
 * downloads third-party files.
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
    const cliId = typeof body?.cliId === "string" ? body.cliId : undefined;
    const result = await installSkill(decodeURIComponent(id), target, { cliId });
    if (!result.ok) {
      return Response.json({ error: result.error, code: result.code }, { status: errorStatus(result.code) });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API] skill install failed:", error);
    return Response.json({ error: "Install failed" }, { status: 500 });
  }
}
