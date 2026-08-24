import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";

export const WEBHOOK_EVENTS = Object.freeze([
  "request.completed", "request.failed", "provider.unavailable", "quota.exhausted",
]);
const EVENT_SET = new Set(WEBHOOK_EVENTS);
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.azure.internal"]);

function blockedIpv4(ip) {
  const p = ip.split(".").map(Number);
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] === 169 && p[1] === 254 ||
    p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168 ||
    p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] >= 224;
}

function ipv4EmbeddedInIpv6(address) {
  let ip = address.toLowerCase().split("%")[0];
  const dotted = ip.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted && net.isIPv4(dotted)) {
    const octets = dotted.split(".").map(Number);
    ip = `${ip.slice(0, -dotted.length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [left, right = ""] = ip.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const parts = ip.includes("::")
    ? [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill("0"), ...rightParts]
    : leftParts;
  if (parts.length !== 8) return null;
  const words = parts.map((part) => Number.parseInt(part, 16));
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  const nat64 = words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0);
  if (!mapped && !compatible && !nat64) return null;
  return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
}

export function isBlockedAddress(address) {
  address = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  if (net.isIPv4(address)) return blockedIpv4(address);
  if (!net.isIPv6(address)) return true;
  const ip = address.toLowerCase().split("%")[0];
  if (ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) return true;
  const embedded = ipv4EmbeddedInIpv6(ip);
  return embedded ? blockedIpv4(embedded) : false;
}

export async function validateWebhookUrl(value, { allowPrivateTargets = false, lookup = dns.lookup } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Webhook URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Webhook URL must use http or https");
  if (url.username || url.password) throw new Error("Webhook URL must not contain credentials");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!allowPrivateTargets && (host === "localhost" || host.endsWith(".localhost") || METADATA_HOSTS.has(host))) throw new Error("Webhook URL targets a blocked host");
  let addresses;
  try { addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error("Webhook host could not be resolved"); }
  if (!allowPrivateTargets && (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address)))) throw new Error("Webhook URL resolves to a private or reserved address");
  return url.toString();
}

export function validateWebhookEvents(events) {
  if (!Array.isArray(events) || !events.length || events.some((event) => !EVENT_SET.has(event))) throw new Error("Webhook events must use the supported allowlist");
  return [...new Set(events)];
}

export function signWebhookPayload(secret, timestamp, body) {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyWebhookSignature(secret, timestamp, body, signature) {
  const expected = Buffer.from(signWebhookPayload(secret, timestamp, body));
  const actual = Buffer.from(String(signature || ""));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWebhookDeliveryQueue({ store, fetcher = fetch, lookup = dns.lookup, maxQueue = 100, concurrency = 4, maxAttempts = 3, timeoutMs = 5000, backoffMs = 500, allowPrivateTargets = false, sleep = wait } = {}) {
  const queue = [];
  let active = 0;
  let reserved = 0;

  async function deliver(job) {
    let responseStatus = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      await store.updateWebhookDelivery(job.id, { status: "delivering", attempts: attempt });
      try {
        const privateTargetsAllowed = typeof allowPrivateTargets === "function" ? await allowPrivateTargets() : allowPrivateTargets;
        await validateWebhookUrl(job.webhook.url, { allowPrivateTargets: privateTargetsAllowed, lookup });
        const body = JSON.stringify({ id: job.id, event: job.event, createdAt: job.createdAt, data: job.payload });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const response = await fetcher(job.webhook.url, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
          headers: { "content-type": "application/json", "user-agent": "Dardcor Code-Webhooks/1", "x-dardcor-event": job.event, "x-dardcor-delivery": job.id, "x-dardcor-timestamp": timestamp, "x-dardcor-signature": signWebhookPayload(job.webhook.secret, timestamp, body) },
          body,
        });
        responseStatus = response.status;
        if (response.status >= 200 && response.status < 300) {
          await store.updateWebhookDelivery(job.id, { status: "delivered", attempts: attempt, responseStatus });
          return;
        }
        if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
      } catch { /* retry without storing URL, secret, or response body */ }
      if (attempt < maxAttempts) {
        await store.updateWebhookDelivery(job.id, { status: "retrying", attempts: attempt, responseStatus });
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
    }
    await store.updateWebhookDelivery(job.id, { status: "failed", attempts, responseStatus, error: "Delivery failed" });
  }

  function drain() {
    while (active < concurrency && queue.length) {
      active++;
      deliver(queue.shift()).finally(() => { active--; drain(); });
    }
  }

  async function enqueue({ webhook, event, payload, idempotencyKey }) {
    if (queue.length + active + reserved >= maxQueue) return { accepted: false, status: "queue_full" };
    if (typeof webhook?.id !== "string" || !webhook.id) throw new Error("A valid webhook id is required");
    reserved++;
    const job = { id: crypto.randomUUID(), webhookId: webhook.id, webhook, event, payload, idempotencyKey, createdAt: new Date().toISOString() };
    let created;
    try { created = await store.createWebhookDelivery(job); }
    finally { reserved--; }
    if (!created) return { accepted: true, status: "duplicate" };
    queue.push(job); drain();
    return { accepted: true, status: "pending", deliveryId: job.id };
  }
  return { enqueue, stats: () => ({ queued: queue.length, active, capacity: maxQueue }) };
}
