import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { serializeBatch } from "@/lib/batches/response.js";
import { batchService } from "@/lib/batches/service";

export async function POST(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return Response.json({ error: "Local authentication required" }, { status: 403 });
  try {
    const batch = await batchService.retry((await params).id);
    return batch ? Response.json({ batch: serializeBatch(batch) }, { status: 202 }) : Response.json({ error: "Batch not found" }, { status: 404 });
  } catch (error) {
    const status = error?.code === "QUEUE_FULL" ? 429 : error?.code === "UNSUPPORTED_PROVIDER" ? 422 : error?.code === "INVALID_REQUEST" ? 400 : 409;
    return Response.json({ error: error?.message || "Retry failed", code: error?.code }, { status });
  }
}
