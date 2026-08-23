import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { serializeBatch } from "@/lib/batches/response.js";
import { batchService } from "@/lib/batches/service";

export async function POST(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return Response.json({ error: "Local authentication required" }, { status: 403 });
  try {
    const batch = await batchService.cancel((await params).id);
    return batch ? Response.json({ batch: serializeBatch(batch) }) : Response.json({ error: "Batch not found" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error?.message || "Cancel failed", code: error?.code }, { status: error?.code === "INVALID_STATE" ? 409 : 400 });
  }
}
