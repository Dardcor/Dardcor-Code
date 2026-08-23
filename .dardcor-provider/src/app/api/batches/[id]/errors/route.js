import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { batchService } from "@/lib/batches/service";
export async function GET(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return Response.json({ error: "Local authentication required" }, { status: 403 });
  const id = (await params).id;
  if (!(await batchService.get(id))) return Response.json({ error: "Batch not found" }, { status: 404 });
  const artifact = await batchService.getErrors(id);
  if (artifact === null) return Response.json({ error: "Batch error log not found" }, { status: 404 });
  return new Response(artifact, { headers: { "Content-Type": "application/jsonl; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="batch-${id}-errors.jsonl"` } });
}
