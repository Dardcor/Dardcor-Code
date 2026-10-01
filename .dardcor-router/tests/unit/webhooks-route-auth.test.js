import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(), list: vi.fn(), create: vi.fn(), privateEnabled: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({ canAccessLocalOnlyRoute: mocks.canAccess }));
vi.mock("@/lib/localDb", () => ({ listWebhooks: mocks.list, createWebhook: mocks.create }));
vi.mock("@/lib/webhooks/service", () => ({ localDevPrivateTargetsEnabled: mocks.privateEnabled }));

describe("webhook CRUD route authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccess.mockResolvedValue(false);
    mocks.privateEnabled.mockResolvedValue(false);
  });

  it("denies non-local unauthenticated reads and writes before storage", async () => {
    const route = await import("@/app/api/webhooks/route.js");
    expect((await route.GET(new Request("http://localhost/api/webhooks"))).status).toBe(403);
    const response = await route.POST(new Request("http://localhost/api/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates only an allowlisted, public webhook", async () => {
    mocks.canAccess.mockResolvedValue(true);
    mocks.create.mockImplementation(async (value) => ({ id: "w1", ...value, secret: "generated-once" }));
    const { POST } = await import("@/app/api/webhooks/route.js");
    const response = await POST(new Request("http://localhost/api/webhooks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Build", url: "https://93.184.216.34/hook", events: ["request.completed"] }),
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).webhook.secret).toBe("generated-once");
  });
});
