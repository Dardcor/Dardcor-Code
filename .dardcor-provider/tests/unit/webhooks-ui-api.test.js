import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhooks UI API contract tests.
 *
 * Validates that the webhook API routes return the response shapes the
 * dashboard frontend expects. Uses the same mock pattern as
 * webhooks-route-auth.test.js to isolate from real storage.
 */

// ── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  listDeliveries: vi.fn(),
  privateEnabled: vi.fn(),
  validateUrl: vi.fn(),
  validateEvents: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  canAccessLocalOnlyRoute: mocks.canAccess,
}));

vi.mock("@/lib/localDb", () => ({
  listWebhooks: mocks.list,
  createWebhook: mocks.create,
  getWebhook: mocks.get,
  updateWebhook: mocks.update,
  deleteWebhook: mocks.del,
  listWebhookDeliveries: mocks.listDeliveries,
}));

vi.mock("@/lib/webhooks/core", () => ({
  WEBHOOK_EVENTS: [
    "request.completed",
    "request.failed",
    "provider.unavailable",
    "quota.exhausted",
  ],
  validateWebhookUrl: mocks.validateUrl,
  validateWebhookEvents: mocks.validateEvents,
}));

vi.mock("@/lib/webhooks/service", () => ({
  localDevPrivateTargetsEnabled: mocks.privateEnabled,
}));

// ── Helpers ────────────────────────────────────────────────────────

const seedWebhook = {
  id: "wh_1",
  name: "Test Hook",
  url: "https://hooks.example.com/abc",
  events: ["request.completed"],
  isActive: true,
  secret: "full-secret-that-must-not-leak",
  secretConfigured: true,
};

const seedDelivery = {
  id: "dlv_1",
  event: "request.completed",
  status: "delivered",
  attempts: 1,
  responseStatus: 200,
  createdAt: new Date().toISOString(),
};

function makeRequest(path, opts = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { "content-type": "application/json", ...opts.headers },
    ...opts,
  });
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.privateEnabled.mockResolvedValue(false);
  mocks.validateUrl.mockImplementation((url) => Promise.resolve(url));
  mocks.validateEvents.mockImplementation((events) => [...new Set(events)]);
});

// ── GET /api/webhooks ──────────────────────────────────────────────

describe("GET /api/webhooks", () => {
  it("returns webhooks array and supportedEvents", async () => {
    mocks.list.mockResolvedValue([seedWebhook]);
    const { GET } = await import("@/app/api/webhooks/route.js");
    const res = await GET(makeRequest("/api/webhooks"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.webhooks)).toBe(true);
    expect(data.webhooks[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      url: expect.any(String),
      events: expect.arrayContaining([expect.any(String)]),
      secretConfigured: true,
      secretPreview: expect.stringMatching(/3f8a|leak$/),
    });
    expect(data.webhooks[0]).not.toHaveProperty("secret");
    expect(Array.isArray(data.supportedEvents)).toBe(true);
    expect(data.supportedEvents).toContain("request.completed");
  });

  it("denies unauthenticated access", async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { GET } = await import("@/app/api/webhooks/route.js");
    const res = await GET(makeRequest("/api/webhooks"));
    expect(res.status).toBe(403);
  });
});

// ── POST /api/webhooks ─────────────────────────────────────────────

describe("POST /api/webhooks", () => {
  it("creates a webhook and returns 201", async () => {
    mocks.create.mockResolvedValue({ ...seedWebhook, id: "wh_new" });
    const { POST } = await import("@/app/api/webhooks/route.js");
    const res = await POST(
      makeRequest("/api/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: "Test Hook",
          url: "https://hooks.example.com/abc",
          events: ["request.completed"],
        }),
      })
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.webhook).toMatchObject({
      id: expect.any(String),
      name: "Test Hook",
      url: expect.any(String),
      events: expect.arrayContaining(["request.completed"]),
      secret: "full-secret-that-must-not-leak",
    });
  });

  it("denies unauthenticated access", async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/webhooks/route.js");
    const res = await POST(
      makeRequest("/api/webhooks", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(403);
  });
});

// ── GET /api/webhooks/[id] ─────────────────────────────────────────

describe("GET /api/webhooks/[id]", () => {
  it("returns webhook with deliveries", async () => {
    mocks.get.mockResolvedValue(seedWebhook);
    mocks.listDeliveries.mockResolvedValue([seedDelivery]);

    const { GET } = await import("@/app/api/webhooks/[id]/route.js");
    const res = await GET(makeRequest("/api/webhooks/wh_1"), {
      params: Promise.resolve({ id: "wh_1" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.webhook).toBeDefined();
    expect(data.webhook.id).toBe("wh_1");
    expect(data.webhook.secretConfigured).toBe(true);
    expect(data.webhook.secretPreview).toMatch(/leak$/);
    expect(data.webhook).not.toHaveProperty("secret");
    expect(Array.isArray(data.deliveries)).toBe(true);
  });

  it("returns 404 for unknown id", async () => {
    mocks.get.mockResolvedValue(null);
    const { GET } = await import("@/app/api/webhooks/[id]/route.js");
    const res = await GET(makeRequest("/api/webhooks/wh_999"), {
      params: Promise.resolve({ id: "wh_999" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/webhooks/[id] ───────────────────────────────────────

describe("PATCH /api/webhooks/[id]", () => {
  it("toggles isActive state", async () => {
    mocks.get.mockResolvedValue(seedWebhook);
    mocks.update.mockResolvedValue({ ...seedWebhook, isActive: false });

    const { PATCH } = await import("@/app/api/webhooks/[id]/route.js");
    const res = await PATCH(
      makeRequest("/api/webhooks/wh_1", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ id: "wh_1" }) }
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.webhook).toBeDefined();
    expect(mocks.update).toHaveBeenCalledWith(
      "wh_1",
      expect.objectContaining({ isActive: false })
    );
  });

  it("rejects invalid url", async () => {
    mocks.get.mockResolvedValue(seedWebhook);
    mocks.validateUrl.mockRejectedValue(new Error("Webhook URL is invalid"));

    const { PATCH } = await import("@/app/api/webhooks/[id]/route.js");
    const res = await PATCH(
      makeRequest("/api/webhooks/wh_1", {
        method: "PATCH",
        body: JSON.stringify({ url: "not-a-url" }),
      }),
      { params: Promise.resolve({ id: "wh_1" }) }
    );
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/webhooks/[id] ──────────────────────────────────────

describe("DELETE /api/webhooks/[id]", () => {
  it("deletes an existing webhook", async () => {
    mocks.del.mockResolvedValue(true);
    const { DELETE } = await import("@/app/api/webhooks/[id]/route.js");
    const res = await DELETE(makeRequest("/api/webhooks/wh_1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("returns 404 for unknown id", async () => {
    mocks.del.mockResolvedValue(false);
    const { DELETE } = await import("@/app/api/webhooks/[id]/route.js");
    const res = await DELETE(makeRequest("/api/webhooks/wh_999", { method: "DELETE" }), {
      params: Promise.resolve({ id: "wh_999" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── UI field contract ──────────────────────────────────────────────

describe("webhook response field contract", () => {
  it("webhook objects use isActive (not enabled) for state", async () => {
    mocks.list.mockResolvedValue([seedWebhook]);
    const { GET } = await import("@/app/api/webhooks/route.js");
    const { webhooks } = await (await GET(makeRequest("/api/webhooks"))).json();

    const wh = webhooks[0];
    expect(wh).toHaveProperty("isActive");
    expect(typeof wh.isActive).toBe("boolean");
    // Should NOT use 'enabled' — that was the old mock field
    expect(wh).not.toHaveProperty("enabled");
  });

  it("GET /api/webhooks returns supportedEvents key (not eventTypes)", async () => {
    mocks.list.mockResolvedValue([]);
    const { GET } = await import("@/app/api/webhooks/route.js");
    const data = await (await GET(makeRequest("/api/webhooks"))).json();

    expect(data).toHaveProperty("supportedEvents");
    expect(data).not.toHaveProperty("eventTypes");
  });

  it("GET /api/webhooks/[id] returns deliveries array", async () => {
    mocks.get.mockResolvedValue(seedWebhook);
    mocks.listDeliveries.mockResolvedValue([seedDelivery]);

    const { GET } = await import("@/app/api/webhooks/[id]/route.js");
    const data = await (
      await GET(makeRequest("/api/webhooks/wh_1"), {
        params: Promise.resolve({ id: "wh_1" }),
      })
    ).json();

    expect(data).toHaveProperty("deliveries");
    expect(Array.isArray(data.deliveries)).toBe(true);
    expect(data.deliveries[0]).toMatchObject({
      id: expect.any(String),
      event: expect.any(String),
      status: expect.any(String),
    });
  });
});
