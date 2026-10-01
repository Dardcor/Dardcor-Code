// PATCH /api/settings first-password path: no 123456 special-casing, local-only
// no-hash setup gate before any DB write, existing-hash re-auth preserved.
import { describe, it, expect, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  isLocalRequest: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: mocks.resetComboRotation }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

function request(body) {
  return { json: async () => body };
}

describe("PATCH /api/settings password handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true, rtkEnabled: true });
    mocks.updateSettings.mockImplementation(async (body) => ({ requireLogin: true, ...body }));
    mocks.isLocalRequest.mockReturnValue(true);
  });

  it("no hash + local: hashes newPassword and persists (no 123456 handling)", async () => {
    const res = await PATCH(request({ newPassword: "first-pass-9", currentPassword: "" }));

    expect(res.status).toBe(200);
    const write = mocks.updateSettings.mock.calls[0][0];
    expect(write.password).toBeTruthy();
    expect(write.password).not.toBe("first-pass-9");
    expect(bcrypt.compareSync("first-pass-9", write.password)).toBe(true);
    expect(write).not.toHaveProperty("newPassword");
    expect(write).not.toHaveProperty("currentPassword");
  });

  it("no hash + remote: rejects before any DB write", async () => {
    mocks.isLocalRequest.mockReturnValue(false);

    const res = await PATCH(request({ newPassword: "first-pass-9" }));

    expect(res.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("no hash + remote + legacy currentPassword 123456: still rejected, no write", async () => {
    mocks.isLocalRequest.mockReturnValue(false);

    const res = await PATCH(
      request({ newPassword: "first-pass-9", currentPassword: "123456" }),
    );

    expect(res.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("no hash + local + legacy currentPassword 123456: currentPassword ignored, succeeds", async () => {
    const res = await PATCH(
      request({ newPassword: "first-pass-9", currentPassword: "123456" }),
    );

    expect(res.status).toBe(200);
    expect(bcrypt.compareSync("first-pass-9", mocks.updateSettings.mock.calls[0][0].password)).toBe(true);
  });

  it("no hash + local + short newPassword: 400, no write", async () => {
    const res = await PATCH(request({ newPassword: "short", currentPassword: "" }));

    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("no hash + local + legacy 123456 newPassword: 400, no write", async () => {
    const res = await PATCH(request({ newPassword: "123456", currentPassword: "" }));

    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("no hash + local + non-string newPassword: 400, no write", async () => {
    const res = await PATCH(request({ newPassword: 12345678, currentPassword: "" }));

    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("no hash + local + exactly-8-char newPassword: persists", async () => {
    const res = await PATCH(request({ newPassword: "12345678" }));

    expect(res.status).toBe(200);
    expect(bcrypt.compareSync("12345678", mocks.updateSettings.mock.calls[0][0].password)).toBe(true);
  });

  it("existing hash: correct current password allows change", async () => {
    const oldHash = bcrypt.hashSync("old-pass", 10);
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });

    const res = await PATCH(request({ newPassword: "new-pass-9", currentPassword: "old-pass" }));

    expect(res.status).toBe(200);
    expect(bcrypt.compareSync("new-pass-9", mocks.updateSettings.mock.calls[0][0].password)).toBe(true);
  });

  it("existing hash: wrong current password -> 401, no DB write", async () => {
    const oldHash = bcrypt.hashSync("old-pass", 10);
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });

    const res = await PATCH(request({ newPassword: "new-pass-9", currentPassword: "nope" }));

    expect(res.status).toBe(401);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("existing hash: missing current password -> 400, no DB write", async () => {
    const oldHash = bcrypt.hashSync("old-pass", 10);
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });

    const res = await PATCH(request({ newPassword: "new-pass-9" }));

    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("existing hash + remote: re-auth change allowed (not setup)", async () => {
    const oldHash = bcrypt.hashSync("old-pass", 10);
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });
    mocks.isLocalRequest.mockReturnValue(false);

    const res = await PATCH(request({ newPassword: "new-pass-9", currentPassword: "old-pass" }));

    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
  });

  describe("newPassword validation applies before hash branches", () => {
    it("existing hash + short newPassword: 400, no write", async () => {
      const oldHash = bcrypt.hashSync("old-pass", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });

      const res = await PATCH(request({ newPassword: "short", currentPassword: "old-pass" }));

      expect(res.status).toBe(400);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("existing hash + non-string newPassword: 400, no write", async () => {
      const oldHash = bcrypt.hashSync("old-pass", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });

      const res = await PATCH(request({ newPassword: 12345678, currentPassword: "old-pass" }));

      expect(res.status).toBe(400);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("existing hash + empty newPassword: 400, no write (no fall-through)", async () => {
      const oldHash = bcrypt.hashSync("old-pass", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });

      const res = await PATCH(request({ newPassword: "", currentPassword: "old-pass" }));

      expect(res.status).toBe(400);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("no hash + empty newPassword: 400, no write (no fall-through)", async () => {
      const res = await PATCH(request({ newPassword: "", currentPassword: "" }));

      expect(res.status).toBe(400);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("no hash + null newPassword: 400, no write", async () => {
      const res = await PATCH(request({ newPassword: null }));

      expect(res.status).toBe(400);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("existing hash + exactly-8 newPassword + correct current: persists", async () => {
      const oldHash = bcrypt.hashSync("old-pass", 10);
      mocks.getSettings.mockResolvedValue({ requireLogin: true, password: oldHash });

      const res = await PATCH(request({ newPassword: "12345678", currentPassword: "old-pass" }));

      expect(res.status).toBe(200);
      expect(bcrypt.compareSync("12345678", mocks.updateSettings.mock.calls[0][0].password)).toBe(true);
    });
  });
});
