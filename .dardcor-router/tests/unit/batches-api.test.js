import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canAccess: vi.fn(), create: vi.fn(), list: vi.fn(), providers: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ canAccessLocalOnlyRoute: mocks.canAccess }));
vi.mock("@/lib/batches/service", () => ({ batchService: { create: mocks.create, list: mocks.list, providers: mocks.providers } }));

function request(body) { return new Request("http://localhost/api/batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

beforeEach(() => { vi.clearAllMocks(); mocks.canAccess.mockResolvedValue(true); mocks.list.mockResolvedValue([]); mocks.providers.mockReturnValue([]); });

describe("batch API", () => {
  it("requires local authentication", async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/batches/route.js");
    expect((await POST(request({ provider: "x", input: "{}" }))).status).toBe(403);
  });

  it("returns explicit unsupported-provider and size errors", async () => {
    const { POST } = await import("@/app/api/batches/route.js");
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("Provider x has no batch executor"), { code: "UNSUPPORTED_PROVIDER" }));
    expect((await POST(request({ provider: "x", input: "{}" }))).status).toBe(422);
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("Input size exceeds limit"), { code: "INPUT_TOO_LARGE" }));
    expect((await POST(request({ provider: "x", input: "large" }))).status).toBe(413);
  });

  it("returns invalid request for a missing provider", async () => {
    const { POST } = await import("@/app/api/batches/route.js");
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("Provider is required"), { code: "INVALID_REQUEST" }));
    expect((await POST(request({ input: "{}" }))).status).toBe(400);
  });

  it("sources providers from the executor registry", async () => {
    mocks.providers.mockReturnValue(["registered"]);
    const { GET } = await import("@/app/api/batches/route.js");
    const response = await GET(new Request("http://localhost/api/batches"));
    expect(await response.json()).toEqual({ batches: [], providers: ["registered"] });
  });

  it("creates an accepted queued job", async () => {
    mocks.create.mockResolvedValue({ id: "b1", status: "queued", inputPath: "/secret", resultPath: "/secret", errorPath: "/secret", inputFileContent: "secret", outputFileUrl: "secret", errorFileUrl: "secret" });
    const { POST } = await import("@/app/api/batches/route.js");
    const response = await POST(request({ provider: "test", input: "{}" }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ batch: { id: "b1", status: "queued" } });
    for (const key of ["inputPath", "resultPath", "errorPath", "inputFileContent", "outputFileUrl", "errorFileUrl"]) {
      expect(body.batch).not.toHaveProperty(key);
    }
  });
});
