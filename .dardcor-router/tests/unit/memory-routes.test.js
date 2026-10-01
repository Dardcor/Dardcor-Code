import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  createMemory: vi.fn(),
  listMemories: vi.fn(),
  searchMemories: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/db/repos/memoryRepo.js", () => ({
  createMemory: mocks.createMemory,
  listMemories: mocks.listMemories,
  searchMemories: mocks.searchMemories,
}));

const collection = await import("../../src/app/api/memory/route.js");
const search = await import("../../src/app/api/memory/search/route.js");

describe("memory API validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires explicit user scope", async () => {
    const response = await collection.GET({ url: "http://localhost/api/memory?sessionId=s1" });
    expect(response).toMatchObject({ status: 400 });
    expect(mocks.listMemories).not.toHaveBeenCalled();
  });

  it("rejects blank memory content", async () => {
    const request = { json: vi.fn().mockResolvedValue({ userId: "u1", sessionId: "s1", content: "  " }) };
    const response = await collection.POST(request);
    expect(response).toMatchObject({ status: 400 });
    expect(mocks.createMemory).not.toHaveBeenCalled();
  });

  it("rejects a non-object JSON body", async () => {
    const response = await collection.POST({ json: vi.fn().mockResolvedValue(null) });
    expect(response).toMatchObject({ status: 400 });
    expect(mocks.createMemory).not.toHaveBeenCalled();
  });

  it("passes validated scope to FTS search", async () => {
    mocks.searchMemories.mockResolvedValue([{ id: "m1" }]);
    const response = await search.GET({ url: "http://localhost/api/memory/search?userId=u1&sessionId=s1&q=alpha&limit=5" });
    expect(mocks.searchMemories).toHaveBeenCalledWith({ userId: "u1", sessionId: "s1", query: "alpha", limit: 5 });
    expect(response.body.memories).toEqual([{ id: "m1" }]);
  });
});
