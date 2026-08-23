import { listApiEndpoints } from "@/lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listApiEndpoints(), { headers: { "Cache-Control": "no-store" } });
}
