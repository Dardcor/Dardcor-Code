import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonFetch } from "../../src/app/(dashboard)/dashboard/memory/components/useMemoryApi.js";

describe("memory dashboard API contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns parsed memory payloads and disables fetch caching", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ memories: [{ id: "m1", content: "note" }] }),
    });
    vi.stubGlobal("fetch", fetch);

    await expect(jsonFetch("/api/memory?userId=default")).resolves.toEqual({
      memories: [{ id: "m1", content: "note" }],
    });
    expect(fetch).toHaveBeenCalledWith("/api/memory?userId=default", { cache: "no-store" });
  });

  it("surfaces the API error contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: "Memory search unavailable", code: "FTS5_UNAVAILABLE" }),
    }));

    await expect(jsonFetch("/api/memory/search")).rejects.toThrow("Memory search unavailable");
  });
});
