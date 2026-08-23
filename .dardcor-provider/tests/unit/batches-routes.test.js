import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  retry: vi.fn(),
  get: vi.fn(),
  getResult: vi.fn(),
  getErrors: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => ({ canAccessLocalOnlyRoute: mocks.canAccess }));
vi.mock("@/lib/batches/service", () => ({ batchService: {
  cancel: mocks.cancel,
  delete: mocks.remove,
  retry: mocks.retry,
  get: mocks.get,
  getResult: mocks.getResult,
  getErrors: mocks.getErrors,
} }));

const request = new Request("http://localhost/api/batches/b1");
const context = { params: Promise.resolve({ id: "b1" }) };

beforeEach(() => { vi.clearAllMocks(); mocks.canAccess.mockResolvedValue(true); });

describe("batch status routes", () => {
  it.each(["queued", "running"])("cancels a %s batch without deleting its row or artifacts", async (status) => {
    const { POST } = await import("@/app/api/batches/[id]/cancel/route.js");
    mocks.cancel.mockResolvedValueOnce({ id: "b1", status: "canceled", previousStatus: status, inputPath: "/artifacts/input.jsonl" });

    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ batch: { id: "b1", status: "canceled", previousStatus: status } });
    expect(mocks.cancel).toHaveBeenCalledWith("b1");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("uses real delete and preserves terminal-state conflicts", async () => {
    const { DELETE } = await import("@/app/api/batches/[id]/route.js");
    mocks.remove.mockResolvedValueOnce({ id: "b1", status: "completed", inputPath: "/secret" });
    expect((await DELETE(request, context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("b1");
    mocks.remove.mockRejectedValueOnce(Object.assign(new Error("Only terminal batches can be deleted"), { code: "INVALID_STATE" }));
    expect((await DELETE(request, context)).status).toBe(409);
  });

  it("returns 429 when retry queue is full", async () => {
    const { POST } = await import("@/app/api/batches/[id]/retry/route.js");
    mocks.retry.mockRejectedValueOnce(Object.assign(new Error("Batch queue is full"), { code: "QUEUE_FULL" }));
    expect((await POST(request, context)).status).toBe(429);
  });

  it("returns 404 for legacy jobs without string artifact paths", async () => {
    mocks.get.mockResolvedValue({ id: "b1", status: "completed" });
    mocks.getResult.mockResolvedValue(null);
    mocks.getErrors.mockResolvedValue(null);
    const results = await import("@/app/api/batches/[id]/results/route.js");
    const errors = await import("@/app/api/batches/[id]/errors/route.js");
    expect((await results.GET(request, context)).status).toBe(404);
    expect((await errors.GET(request, context)).status).toBe(404);
  });
});
