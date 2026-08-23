import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { deleteWebhook, getWebhook, listWebhookDeliveries, updateWebhook } from "@/lib/localDb";
import { validateWebhookEvents, validateWebhookUrl } from "@/lib/webhooks/core";
import { localDevPrivateTargetsEnabled } from "@/lib/webhooks/service";
import { serializeWebhook } from "@/lib/webhooks/response";

const unauthorized = () => Response.json({ error: "Local authentication required" }, { status: 403 });

export async function GET(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  const { id } = await params;
  const webhook = await getWebhook(id);
  if (!webhook) return Response.json({ error: "Webhook not found" }, { status: 404 });
  return Response.json({ webhook: serializeWebhook(webhook), deliveries: await listWebhookDeliveries(id) });
}

export async function PUT(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  const { id } = await params;
  if (!(await getWebhook(id))) return Response.json({ error: "Webhook not found" }, { status: 404 });
  try {
    const body = await request.json();
    const changes = {};
    if (body.name !== undefined) {
      changes.name = typeof body.name === "string" ? body.name.trim() : "";
      if (!changes.name || changes.name.length > 100) throw new Error("Name must be 1-100 characters");
    }
    if (body.url !== undefined) changes.url = await validateWebhookUrl(body.url, { allowPrivateTargets: await localDevPrivateTargetsEnabled() });
    if (body.events !== undefined) changes.events = validateWebhookEvents(body.events);
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") throw new Error("isActive must be boolean");
      changes.isActive = body.isActive;
    }
    if (body.secret !== undefined) {
      if (typeof body.secret !== "string" || body.secret.length < 16 || body.secret.length > 256) throw new Error("Secret must be 16-256 characters");
      changes.secret = body.secret;
    }
    return Response.json({ webhook: serializeWebhook(await updateWebhook(id, changes)) });
  } catch (error) {
    return Response.json({ error: error.message || "Invalid webhook" }, { status: 400 });
  }
}

export const PATCH = PUT;

export async function DELETE(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  const { id } = await params;
  if (!(await deleteWebhook(id))) return Response.json({ error: "Webhook not found" }, { status: 404 });
  return Response.json({ success: true });
}
