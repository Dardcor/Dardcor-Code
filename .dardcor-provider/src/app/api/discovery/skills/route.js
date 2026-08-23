import { listAgentSkills } from "@/lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listAgentSkills(), { headers: { "Cache-Control": "no-store" } });
}
