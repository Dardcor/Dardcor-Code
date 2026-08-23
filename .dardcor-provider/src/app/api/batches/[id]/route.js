import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { serializeBatch } from "@/lib/batches/response.js";
import { batchService } from "@/lib/batches/service";

const unauthorized = () => Response.json({ error: "Local authentication required" }, { status: 403 });
export async function GET(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  const batch = await batchService.get((await params).id);
  return batch ? Response.json({ batch: serializeBatch(batch) }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Batch not found" }, { status: 404 });
}
export async function DELETE(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  try {
    const batch = await batchService.delete((await params).id);
    return batch ? Response.json({ batch: serializeBatch(batch) }) : Response.json({ error: "Batch not found" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error?.message || "Delete failed", code: error?.code }, { status: error?.code === "INVALID_STATE" ? 409 : 400 });
  }
}
