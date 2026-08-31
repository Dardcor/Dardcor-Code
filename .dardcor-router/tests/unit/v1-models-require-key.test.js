import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

// ── import handlers after mocks are wired ───────────────────────────
const { GET: getModels } = await import(
  "../../src/app/api/v1/models/route.js"
);
const { GET: getModelsKind } = await import(
  "../../src/app/api/v1/models/[kind]/route.js"
);
const { GET: getModelsInfo } = await import(
  "../../src/app/api/v1/models/info/route.js"
);

// ── helpers ─────────────────────────────────────────────────────────
function req(url = "http://localhost:21128/v1/models") {
  return new Request(url);
}

function kindReq(kind = "image") {
  return new Request(`http://localhost:21128/v1/models/${kind}`);
}

function infoReq(id = "glm/glm-5.1") {
  return new Request(
    `http://localhost:21128/v1/models/info?id=${encodeURIComponent(id)}`
  );
}

const PARAMS = { params: Promise.resolve({ kind: "image" }) };

const UNAUTHORIZED_BODY = (msg) => ({
  error: { message: msg, type: "invalid_request_error" },
});

// ── tests ───────────────────────────────────────────────────────────
describe("requireApiKey on GET /v1/models routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: requireApiKey enabled
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
  });

  // ── missing key ───────────────────────────────────────────────
  it("GET /v1/models → 401 when requireApiKey=true and no key", async () => {
    mocks.extractApiKey.mockReturnValue(null);

    const res = await getModels(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY("Missing API key"));
  });

  it("GET /v1/models/[kind] → 401 when requireApiKey=true and no key", async () => {
    mocks.extractApiKey.mockReturnValue(null);

    const res = await getModelsKind(kindReq(), PARAMS);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY("Missing API key"));
  });

  it("GET /v1/models/info → 401 when requireApiKey=true and no key", async () => {
    mocks.extractApiKey.mockReturnValue(null);

    const res = await getModelsInfo(infoReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY("Missing API key"));
  });

  // ── invalid key ───────────────────────────────────────────────
  it("GET /v1/models → 401 when requireApiKey=true and key is invalid", async () => {
    mocks.extractApiKey.mockReturnValue("sk_bad");
    mocks.isValidApiKey.mockResolvedValue(false);

    const res = await getModels(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY("Invalid API key"));
  });

  it("GET /v1/models/info → 401 when requireApiKey=true and key is invalid", async () => {
    mocks.extractApiKey.mockReturnValue("sk_bad");
    mocks.isValidApiKey.mockResolvedValue(false);

    const res = await getModelsInfo(infoReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY("Invalid API key"));
  });

  // ── valid key passes through ──────────────────────────────────
  it("GET /v1/models/info → 200 when requireApiKey=true and key is valid", async () => {
    mocks.extractApiKey.mockReturnValue("sk_valid");
    mocks.isValidApiKey.mockResolvedValue(true);

    const res = await getModelsInfo(infoReq());

    expect(res.status).toBe(200);
  });

  // ── disabled → no key needed ──────────────────────────────────
  it("GET /v1/models/info → 200 when requireApiKey=false and no key", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.extractApiKey.mockReturnValue(null);

    const res = await getModelsInfo(infoReq());

    expect(res.status).toBe(200);
  });

  it("GET /v1/models → 200 when requireApiKey=false and no key", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.extractApiKey.mockReturnValue(null);

    const res = await getModels(req());

    expect(res.status).toBe(200);
  });

  it("GET /v1/models/[kind] → 200 when requireApiKey=false and no key", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.extractApiKey.mockReturnValue(null);

    const res = await getModelsKind(kindReq(), PARAMS);

    expect(res.status).toBe(200);
  });
});
