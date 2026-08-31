import { describe, it, expect, vi } from "vitest";

// Track headers passed to NextResponse.json and NextResponse constructor
let lastJsonHeaders;
let lastOptionsHeaders;

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init) {
      lastJsonHeaders = init?.headers || {};
      return { status: init?.status || 200, body, headers: lastJsonHeaders };
    },
  },
}));

describe("health endpoint CORS", () => {
  it("does not emit wildcard Access-Control-Allow-Origin on GET", async () => {
    const { GET } = await import("../../src/app/api/health/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const origin = lastJsonHeaders["Access-Control-Allow-Origin"];
    expect(origin).toBeUndefined();
  });

  it("does not emit wildcard Access-Control-Allow-Headers on GET", async () => {
    const { GET } = await import("../../src/app/api/health/route.js");
    await GET();
    const headers = lastJsonHeaders["Access-Control-Allow-Headers"];
    expect(headers).toBeUndefined();
  });

  it("does not emit CORS headers on OPTIONS", async () => {
    let optsHeaders;
    class FakeNextResponse {
      constructor(body, init) {
        optsHeaders = init?.headers || {};
        this.status = init?.status || 200;
        this.headers = optsHeaders;
      }
      static json(body, init) {
        return { status: init?.status || 200, body, headers: init?.headers || {} };
      }
    }
    vi.doMock("next/server", () => ({ NextResponse: FakeNextResponse }));
    vi.resetModules();
    const { OPTIONS } = await import("../../src/app/api/health/route.js");
    await OPTIONS();
    expect(optsHeaders["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(optsHeaders["Access-Control-Allow-Headers"]).toBeUndefined();
  });
});
