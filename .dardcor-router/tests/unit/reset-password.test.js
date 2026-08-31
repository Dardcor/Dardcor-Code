// POST /api/auth/reset-password: clears stored hash into setup-required state,
// may report setupRequired, wire remains compatible ({ success: true }).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  updateSettings: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/localDb", () => ({ updateSettings: mocks.updateSettings }));

const { POST } = await import("../../src/app/api/auth/reset-password/route.js");

const ORIG_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (ORIG_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = ORIG_INITIAL_PASSWORD;
    mocks.updateSettings.mockResolvedValue({ requireLogin: true });
  });

  afterEach(() => {
    if (ORIG_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = ORIG_INITIAL_PASSWORD;
  });

  it("clears the stored hash and reports setup-required when no env password", async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ password: null });
    expect(res.body.setupRequired).toBe(true);
  });

  it("reports setupRequired false when INITIAL_PASSWORD is set", async () => {
    process.env.INITIAL_PASSWORD = "operator-pass";

    const res = await POST();

    expect(res.body.success).toBe(true);
    expect(res.body.setupRequired).toBe(false);
  });
});
