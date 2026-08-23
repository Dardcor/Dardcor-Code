import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { emitWebhookEvent, getWebhookQueueStats } from "@/lib/webhooks/service";

export const runtime = "nodejs";

export async function POST(request) {
  if (!(await canAccessLocalOnlyRoute(request))) return Response.json({ error: "Local authentication required" }, { status: 403 });
  try {
    const body = await request.json();
    const key = request.headers.get("idempotency-key") || body.idempotencyKey;
    const deliveries = await emitWebhookEvent(body.event, body.data, key);
    const full = deliveries.some((item) => item.status === "queue_full");
    return Response.json({ accepted: !full, deliveries, queue: getWebhookQueueStats() }, { status: full ? 503 : 202 });
  } catch (error) {
    return Response.json({ error: error.message || "Invalid event" }, { status: 400 });
  }
}
