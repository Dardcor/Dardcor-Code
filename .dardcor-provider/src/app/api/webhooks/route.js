import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { createWebhook, listWebhooks } from "@/lib/localDb";
import { WEBHOOK_EVENTS, validateWebhookEvents, validateWebhookUrl } from "@/lib/webhooks/core";
import { localDevPrivateTargetsEnabled } from "@/lib/webhooks/service";
import { serializeWebhook } from "@/lib/webhooks/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const unauthorized = () => Response.json({ error: "Local authentication required" }, { status: 403 });

export async function GET(request) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  return Response.json({ webhooks: (await listWebhooks()).map((webhook) => serializeWebhook(webhook)), supportedEvents: WEBHOOK_EVENTS });
}

export async function POST(request) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) return Response.json({ error: "Name is required and must be at most 100 characters" }, { status: 400 });
    const url = await validateWebhookUrl(body.url, { allowPrivateTargets: await localDevPrivateTargetsEnabled() });
    const events = validateWebhookEvents(body.events);
    if (body.secret != null && (typeof body.secret !== "string" || body.secret.length < 16 || body.secret.length > 256)) return Response.json({ error: "Secret must be 16-256 characters" }, { status: 400 });
    const webhook = await createWebhook({ name, url, events, secret: body.secret, isActive: body.isActive !== false });
    return Response.json({ webhook: serializeWebhook(webhook, { includeSecret: true }) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message || "Invalid webhook" }, { status: 400 });
  }
}
