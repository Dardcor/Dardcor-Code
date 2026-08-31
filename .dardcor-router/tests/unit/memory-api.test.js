import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for /api/memory routes.
 *
 * Mocks the DB layer (memoryRepo) and next/server.
 * Validates that routes correctly delegate to the repo with proper parameters.
 */

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  createMemory: vi.fn(),
  listMemories: vi.fn(),
  getMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  searchMemories: vi.fn(),
  reindexMemories: vi.fn(),
  getMemoryHealth: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/db/repos/memoryRepo.js", () => ({
  createMemory: mocks.createMemory,
  listMemories: mocks.listMemories,
  getMemory: mocks.getMemory,
  updateMemory: mocks.updateMemory,
  deleteMemory: mocks.deleteMemory,
  searchMemories: mocks.searchMemories,
  reindexMemories: mocks.reindexMemories,
  getMemoryHealth: mocks.getMemoryHealth,
}));

// Import route handlers (top-level await for vi.mock hoisting)
const { GET, POST } = await import("../../src/app/api/memory/route.js");
const { GET: SearchGET } = await import("../../src/app/api/memory/search/route.js");
const { DELETE } = await import("../../src/app/api/memory/[id]/route.js");
const reindexRoute = await import("../../src/app/api/memory/reindex/route.js");
const healthRoute = await import("../../src/app/api/memory/health/route.js");

function lastBody() { return mocks.json.mock.calls[mocks.json.mock.calls.length - 1]?.[0]; }
function lastStatus() { return mocks.json.mock.calls[mocks.json.mock.calls.length - 1]?.[1]?.status || 200; }

const SAMPLE_MEMORY = {
  id: "mem_001",
  userId: "default",
  sessionId: "",
  content: "Dardcor Code uses a gateway pattern for LLM routing.",
  metadata: { tags: ["architecture"] },
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

// ── GET /api/memory ───────────────────────────────────────────────

describe("GET /api/memory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists memories for the given userId", async () => {
    mocks.listMemories.mockResolvedValue([SAMPLE_MEMORY]);
    await GET({ url: "http://localhost/api/memory?userId=default" });
    expect(mocks.listMemories).toHaveBeenCalledWith(expect.objectContaining({ userId: "default" }));
    expect(lastBody().memories).toEqual([SAMPLE_MEMORY]);
  });

  it("passes limit and offset to listMemories", async () => {
    mocks.listMemories.mockResolvedValue([]);
    await GET({ url: "http://localhost/api/memory?userId=default&limit=10&offset=20" });
    expect(mocks.listMemories).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }));
  });

  it("uses defaults when limit/offset are omitted", async () => {
    mocks.listMemories.mockResolvedValue([]);
    await GET({ url: "http://localhost/api/memory?userId=default" });
    expect(mocks.listMemories).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
  });

  it("returns 400 when userId is missing", async () => {
    await GET({ url: "http://localhost/api/memory" });
    expect(lastStatus()).toBe(400);
    expect(lastBody().error).toMatch(/userId/i);
  });
});

// ── POST /api/memory ──────────────────────────────────────────────

describe("POST /api/memory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a memory with content and returns it", async () => {
    mocks.createMemory.mockResolvedValue(SAMPLE_MEMORY);
    const request = { json: () => Promise.resolve({ userId: "default", content: "Test content" }) };
    await POST(request);
    expect(mocks.createMemory).toHaveBeenCalledWith(expect.objectContaining({
      userId: "default",
      content: "Test content",
      metadata: {},
    }));
    expect(lastBody().memory).toEqual(SAMPLE_MEMORY);
    expect(lastStatus()).toBe(201);
  });

  it("passes metadata to createMemory", async () => {
    mocks.createMemory.mockResolvedValue(SAMPLE_MEMORY);
    const meta = { tags: ["test"] };
    const request = { json: () => Promise.resolve({ userId: "default", content: "Test", metadata: meta }) };
    await POST(request);
    expect(mocks.createMemory).toHaveBeenCalledWith(expect.objectContaining({ metadata: meta }));
  });

  it("returns 400 when userId is missing", async () => {
    const request = { json: () => Promise.resolve({ content: "Test" }) };
    await POST(request);
    expect(lastStatus()).toBe(400);
  });

  it("returns 400 when content is missing", async () => {
    const request = { json: () => Promise.resolve({ userId: "default" }) };
    await POST(request);
    expect(lastStatus()).toBe(400);
  });

  it("returns 400 for invalid JSON", async () => {
    const request = { json: () => Promise.reject(new SyntaxError("Unexpected token")) };
    await POST(request);
    expect(lastStatus()).toBe(400);
  });

  it("returns 500 for unexpected repo errors", async () => {
    mocks.createMemory.mockRejectedValue(new Error("db down"));
    const request = { json: () => Promise.resolve({ userId: "default", content: "Test" }) };
    await POST(request);
    expect(lastStatus()).toBe(500);
  });
});

// ── GET /api/memory/search ────────────────────────────────────────

describe("GET /api/memory/search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches memories with the given query", async () => {
    mocks.searchMemories.mockResolvedValue([SAMPLE_MEMORY]);
    await SearchGET({ url: "http://localhost/api/memory/search?userId=default&q=gateway" });
    expect(mocks.searchMemories).toHaveBeenCalledWith(expect.objectContaining({
      userId: "default",
      query: "gateway",
    }));
    expect(lastBody().memories).toEqual([SAMPLE_MEMORY]);
  });

  it("passes limit parameter", async () => {
    mocks.searchMemories.mockResolvedValue([]);
    await SearchGET({ url: "http://localhost/api/memory/search?userId=default&q=test&limit=5" });
    expect(mocks.searchMemories).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });

  it("returns 400 when q is missing", async () => {
    await SearchGET({ url: "http://localhost/api/memory/search?userId=default" });
    expect(lastStatus()).toBe(400);
  });
});

// ── DELETE /api/memory/[id] ───────────────────────────────────────

describe("DELETE /api/memory/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a memory by id", async () => {
    mocks.deleteMemory.mockResolvedValue(true);
    await DELETE(
      { url: "http://localhost/api/memory/mem_001?userId=default" },
      { params: Promise.resolve({ id: "mem_001" }) }
    );
    expect(mocks.deleteMemory).toHaveBeenCalledWith("mem_001", expect.objectContaining({ userId: "default" }));
    expect(lastBody().deleted).toBe(true);
    expect(lastStatus()).toBe(200);
  });

  it("returns 404 when memory not found", async () => {
    mocks.deleteMemory.mockResolvedValue(false);
    await DELETE(
      { url: "http://localhost/api/memory/nonexistent?userId=default" },
      { params: Promise.resolve({ id: "nonexistent" }) }
    );
    expect(lastStatus()).toBe(404);
    expect(lastBody().error).toMatch(/not found/i);
  });

  it("returns 400 when userId is missing", async () => {
    await DELETE(
      { url: "http://localhost/api/memory/mem_001" },
      { params: Promise.resolve({ id: "mem_001" }) }
    );
    expect(lastStatus()).toBe(400);
  });
});

// ── POST /api/memory/reindex ──────────────────────────────────────

describe("POST /api/memory/reindex", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rebuilds the FTS index and returns count", async () => {
    mocks.reindexMemories.mockResolvedValue({ indexed: 42 });
    await reindexRoute.POST();
    expect(mocks.reindexMemories).toHaveBeenCalled();
    expect(lastBody().indexed).toBe(42);
  });

  it("returns 500 on repo failure", async () => {
    mocks.reindexMemories.mockRejectedValue(new Error("fts broken"));
    await reindexRoute.POST();
    expect(lastStatus()).toBe(500);
  });

  it("returns 503 with an explicit code when FTS5 is unavailable", async () => {
    const error = Object.assign(new Error("FTS5 is unavailable for the active SQLite driver"), {
      code: "FTS5_UNAVAILABLE",
      status: 503,
    });
    mocks.reindexMemories.mockRejectedValue(error);
    await reindexRoute.POST();
    expect(lastStatus()).toBe(503);
    expect(lastBody()).toMatchObject({ code: "FTS5_UNAVAILABLE", detail: expect.stringContaining("FTS5") });
  });
});

// ── GET /api/memory/health ────────────────────────────────────────

describe("GET /api/memory/health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns healthy status when entries match index", async () => {
    mocks.getMemoryHealth.mockResolvedValue({ ok: true, driver: "node:sqlite", entries: 5, indexed: 5 });
    await healthRoute.GET();
    expect(lastBody().ok).toBe(true);
    expect(lastBody().entries).toBe(5);
    expect(lastBody().indexed).toBe(5);
    expect(lastStatus()).toBe(200);
  });

  it("returns 503 when entries and index are mismatched", async () => {
    mocks.getMemoryHealth.mockResolvedValue({ ok: false, driver: "node:sqlite", entries: 5, indexed: 3 });
    await healthRoute.GET();
    expect(lastBody().ok).toBe(false);
    expect(lastStatus()).toBe(503);
  });

  it("returns explicit degraded status when FTS5 is unavailable", async () => {
    mocks.getMemoryHealth.mockResolvedValue({
      ok: false,
      available: false,
      status: "degraded",
      reason: "FTS5 is unavailable",
      driver: "sql.js",
      entries: 5,
      indexed: null,
    });
    await healthRoute.GET();
    expect(lastBody()).toMatchObject({ available: false, status: "degraded", indexed: null });
    expect(lastStatus()).toBe(503);
  });

  it("returns 500 on health check failure", async () => {
    mocks.getMemoryHealth.mockRejectedValue(new Error("fts5 table missing"));
    await healthRoute.GET();
    expect(lastStatus()).toBe(500);
  });
});
