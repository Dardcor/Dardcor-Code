import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  deliveries: new Map(),
  webhook: {
    id: "webhook-1",
    url: "https://93.184.216.34/hook",
    secret: "test-secret",
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  listActiveWebhooksForEvent: vi.fn(async () => [memory.webhook]),
  createWebhookDelivery: vi.fn(async (delivery) => {
    if (typeof delivery.webhookId !== "string" || !delivery.webhookId) {
      throw new Error("webhookId must be a concrete string");
    }
    const key = `${delivery.webhookId}:${delivery.idempotencyKey}`;
    if (memory.deliveries.has(key)) return false;
    memory.deliveries.set(key, { ...delivery, status: "pending" });
    return true;
  }),
  updateWebhookDelivery: vi.fn(async () => {}),
}));

describe("emitWebhookEvent delivery persistence", () => {
  beforeEach(() => {
    memory.deliveries.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  });

  it("persists the webhook id through the real delivery queue", async () => {
    const { emitWebhookEvent } = await import("../../src/lib/webhooks/service.js");

    const deliveries = await emitWebhookEvent("request.completed", { ok: true }, "request-1");

    expect(deliveries).toEqual([expect.objectContaining({ accepted: true, status: "pending" })]);
    expect(memory.deliveries.get("webhook-1:request-1")).toMatchObject({
      webhookId: "webhook-1",
      event: "request.completed",
      idempotencyKey: "request-1",
    });
  });
});
