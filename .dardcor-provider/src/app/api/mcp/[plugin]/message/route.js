import { NextResponse } from "next/server";
import { sendToChild, findPlugin } from "@/lib/mcp/stdioSseBridge";
import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { recordInvocation } from "@/app/api/mcp/status/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
  }
  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
  }
  let isToolCall = false;
  try {
    const body = await request.json();
    isToolCall = body?.method === "tools/call";
    sendToChild(plugin, body);
    if (isToolCall) recordInvocation(plugin, true);
    return new Response(null, { status: 202 });
  } catch (e) {
    if (isToolCall) recordInvocation(plugin, false);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
