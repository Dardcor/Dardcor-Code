import {
  createWebhookDelivery, getSettings, listActiveWebhooksForEvent, updateWebhookDelivery,
} from "@/lib/localDb";
import { createWebhookDeliveryQueue, validateWebhookEvents } from "./core.js";

const store = { createWebhookDelivery, updateWebhookDelivery };
let queue;

export async function localDevPrivateTargetsEnabled() {
  if (process.env.NODE_ENV !== "development") return false;
  const settings = await getSettings().catch(() => ({}));
  return settings?.webhooksAllowPrivateTargets === true;
}

async function getQueue() {
  if (!queue) queue = createWebhookDeliveryQueue({ store, allowPrivateTargets: localDevPrivateTargetsEnabled });
  return queue;
}

export async function emitWebhookEvent(event, payload, idempotencyKey) {
  validateWebhookEvents([event]);
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length > 200) throw new Error("A valid idempotency key is required");
  const webhooks = await listActiveWebhooksForEvent(event);
  const deliveryQueue = await getQueue();
  const deliveries = [];
  for (const webhook of webhooks) deliveries.push(await deliveryQueue.enqueue({ webhook, event, payload, idempotencyKey }));
  return deliveries;
}

export function getWebhookQueueStats() {
  return queue?.stats() || { queued: 0, active: 0, capacity: 100 };
}
