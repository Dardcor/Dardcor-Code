import { DELETE, GET } from "../../batches/[id]/route.js";
import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { serializeBatch } from "@/lib/batches/response.js";
import { batchService } from "@/lib/batches/service";

export { DELETE, GET };

export async function PATCH(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return Response.json({ error: "Local authentication required" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body.action !== "cancel") return Response.json({ error: "Unknown action" }, { status: 400 });
  const batch = await batchService.cancel((await params).id);
  return batch ? Response.json({ batch: serializeBatch(batch) }) : Response.json({ error: "Batch not found" }, { status: 404 });
}
