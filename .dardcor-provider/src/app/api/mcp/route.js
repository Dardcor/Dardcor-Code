import { canAccessLocalOnlyRoute, hasValidCliToken } from "@/dashboardGuard";
import { mcpDependencies } from "@/lib/mcp/adapters";
import { MCP_SCOPES, createMcpCore, createDardcorToolRegistry } from "@/lib/mcp/core";
import { createMcpHttpHandler } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_SCOPES = Object.values(MCP_SCOPES);
const registry = createDardcorToolRegistry(mcpDependencies);
const core = createMcpCore({
  registry,
  timeoutMs: 10_000,
  audit(event) { console.info("[mcp:audit]", event); },
});

function requestedScopes(request) {
  const header = request.headers.get("x-dardcor-mcp-scopes");
  if (!header) return ALL_SCOPES;
  const requested = header.split(/[ ,]+/).filter(Boolean);
  return requested.filter((scope) => ALL_SCOPES.includes(scope));
}

const handle = createMcpHttpHandler({
  core,
  async authorize(request) {
    if (!(await canAccessLocalOnlyRoute(request))) return { authenticated: false, scopes: [] };
    return {
      authenticated: true,
      actor: await hasValidCliToken(request) ? "local-cli" : "local-dashboard",
      scopes: requestedScopes(request),
    };
  },
});

export async function POST(request) {
  return handle(request);
}

export function GET() {
  return Response.json({ error: "Use POST for sessionless Streamable HTTP/SSE" }, {
    status: 405,
    headers: { Allow: "POST" },
  });
}
