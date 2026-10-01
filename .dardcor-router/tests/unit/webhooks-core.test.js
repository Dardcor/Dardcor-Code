import { describe, expect, it, vi } from "vitest";
import {
  createWebhookDeliveryQueue, signWebhookPayload, validateWebhookEvents,
  validateWebhookUrl, verifyWebhookSignature, WEBHOOK_EVENTS,
} from "../../src/lib/webhooks/core.js";

describe("webhook security helpers", () => {
  it("uses an explicit event allowlist", () => {
    expect(validateWebhookEvents([WEBHOOK_EVENTS[0], WEBHOOK_EVENTS[0]])).toEqual([WEBHOOK_EVENTS[0]]);
    expect(() => validateWebhookEvents(["arbitrary.proxy"])).toThrow(/allowlist/);
  });

  it.each([
    ["http://localhost/hook", [{ address: "127.0.0.1" }]],
    ["http://internal.test/hook", [{ address: "10.0.0.2" }]],
    ["http://metadata.google.internal/hook", [{ address: "169.254.169.254" }]],
    ["http://[::1]/hook", [{ address: "::1" }]],
  ])("blocks non-public target %s", async (url, addresses) => {
    await expect(validateWebhookUrl(url, { lookup: vi.fn().mockResolvedValue(addresses) })).rejects.toThrow(/blocked|private|reserved/);
  });

  it.each([
    "http://[::ffff:127.0.0.1]/hook",
    "http://[::ffff:7f00:1]/hook",
    "http://[::127.0.0.1]/hook",
    "http://[64:ff9b::127.0.0.1]/hook",
  ])("blocks IPv4-embedded IPv6 literal %s without DNS lookup", async (url) => {
    const lookup = vi.fn();
    await expect(validateWebhookUrl(url, { lookup })).rejects.toThrow(/private|reserved/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("accepts a public IPv6 literal without DNS lookup", async () => {
    const lookup = vi.fn();
    await expect(validateWebhookUrl("https://[2606:4700:4700::1111]/hook", { lookup })).resolves.toBe("https://[2606:4700:4700::1111]/hook");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("accepts a resolved public target and rejects URL credentials", async () => {
    await expect(validateWebhookUrl("https://hooks.example.test/a", { lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34" }]) })).resolves.toBe("https://hooks.example.test/a");
    await expect(validateWebhookUrl("https://user:pass@example.test/a", { lookup: vi.fn() })).rejects.toThrow(/credentials/);
  });

  it("signs and verifies without accepting malformed signatures", () => {
    const signature = signWebhookPayload("secret", "123", "{\"ok\":true}");
    expect(verifyWebhookSignature("secret", "123", "{\"ok\":true}", signature)).toBe(true);
    expect(verifyWebhookSignature("secret", "123", "changed", signature)).toBe(false);
    expect(verifyWebhookSignature("secret", "123", "x", "short")).toBe(false);
  });
});

describe("webhook delivery queue", () => {
  it("retries, records honest states, and deduplicates", async () => {
    const rows = new Set();
    const updates = [];
    const store = {
      createWebhookDelivery: vi.fn(async (job) => rows.has(job.idempotencyKey) ? false : (rows.add(job.idempotencyKey), true)),
      updateWebhookDelivery: vi.fn(async (_id, update) => updates.push(update)),
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("no", { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const queue = createWebhookDeliveryQueue({
      store, fetcher, lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34" }]),
      sleep: vi.fn(), concurrency: 1, maxAttempts: 3,
    });
    const webhook = { id: "w1", url: "https://hooks.example.test/a", secret: "not-logged" };
    const first = await queue.enqueue({ webhook, event: WEBHOOK_EVENTS[0], payload: { safe: true }, idempotencyKey: "same" });
    const duplicate = await queue.enqueue({ webhook, event: WEBHOOK_EVENTS[0], payload: {}, idempotencyKey: "same" });
    expect(first.status).toBe("pending");
    expect(duplicate.status).toBe("duplicate");
    await vi.waitFor(() => expect(updates.at(-1)?.status).toBe("delivered"));
    expect(updates.map((u) => u.status)).toEqual(["delivering", "retrying", "delivering", "delivered"]);
    expect(updates.at(-1)).toMatchObject({ attempts: 2, responseStatus: 204 });
  });

  it("reports queue saturation instead of claiming acceptance", async () => {
    let release;
    const fetcher = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const store = { createWebhookDelivery: vi.fn(async () => true), updateWebhookDelivery: vi.fn(async () => {}) };
    const queue = createWebhookDeliveryQueue({ store, fetcher, lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34" }]), maxQueue: 1, concurrency: 1 });
    const webhook = { id: "w", url: "https://hooks.example.test", secret: "s" };
    expect((await queue.enqueue({ webhook, event: WEBHOOK_EVENTS[0], payload: {}, idempotencyKey: "1" })).accepted).toBe(true);
    expect(await queue.enqueue({ webhook, event: WEBHOOK_EVENTS[0], payload: {}, idempotencyKey: "2" })).toMatchObject({ accepted: false, status: "queue_full" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    release(new Response(null, { status: 204 }));
  });
});
