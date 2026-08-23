import { canAccessLocalOnlyRoute, hasValidCliToken } from "@/dashboardGuard";
import { a2aDependencies } from "@/lib/a2a/adapters";
import { A2A_SCOPE, createA2ACore, createA2ASkillRegistry, createTaskManager } from "@/lib/a2a/core";
import { createA2AHttpHandler } from "@/lib/a2a/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const audit = (event) => console.info("[a2a:audit]", event);
const core = createA2ACore({
  registry: createA2ASkillRegistry(a2aDependencies),
  taskManager: createTaskManager({ maxTasks: 100, timeoutMs: 10_000, retentionMs: 5 * 60_000, audit }),
  audit,
});

const handle = createA2AHttpHandler({
  core,
  async authorize(request) {
    if (!(await canAccessLocalOnlyRoute(request))) return { authenticated: false, scopes: [] };
    return { authenticated: true, actor: await hasValidCliToken(request) ? "local-cli" : "local-dashboard", scopes: [A2A_SCOPE] };
  },
});

export async function POST(request) { return handle(request); }
export function GET() { return Response.json({ error: "Use authenticated JSON-RPC POST" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
