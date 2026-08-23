import { getDiscoverySnapshot } from "@/lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("query") || "").slice(0, 100);
  const types = params.getAll("type").slice(0, 20);
  const statuses = params.getAll("status").slice(0, 20);
  return Response.json(await getDiscoverySnapshot({ query, types, statuses }), {
    headers: { "Cache-Control": "no-store" },
  });
}
