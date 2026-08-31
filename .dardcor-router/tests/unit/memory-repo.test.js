import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { runMigrationOnce } from "../../src/lib/db/migrate.js";

const mocks = vi.hoisted(() => ({ getAdapter: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: mocks.getAdapter }));

const memory = await import("../../src/lib/db/repos/memoryRepo.js");

describe("SQLite FTS5 memory repository", () => {
  let db;

  beforeEach(async () => {
    db = await createNodeSqliteAdapter(":memory:");
    await runMigrationOnce(db);
    mocks.getAdapter.mockResolvedValue(db);
  });

  afterEach(() => db?.close());

  it("creates, reads, updates, lists, and deletes memory within its scope", async () => {
    const created = await memory.createMemory({ userId: "u1", sessionId: "s1", content: "first note", metadata: { source: "test" } });
    expect(await memory.getMemory(created.id, { userId: "u1", sessionId: "s1" })).toMatchObject({ content: "first note", metadata: { source: "test" } });
    expect(await memory.getMemory(created.id, { userId: "u1", sessionId: "other" })).toBeNull();

    const updated = await memory.updateMemory(created.id, { userId: "u1", sessionId: "s1" }, { content: "updated note" });
    expect(updated.content).toBe("updated note");
    expect(await memory.listMemories({ userId: "u1", sessionId: "s1" })).toHaveLength(1);
    expect(await memory.deleteMemory(created.id, { userId: "u1", sessionId: "other" })).toBe(false);
    expect(await memory.deleteMemory(created.id, { userId: "u1", sessionId: "s1" })).toBe(true);
  });

  it("searches with FTS5 without leaking another user or session", async () => {
    await memory.createMemory({ userId: "u1", sessionId: "s1", content: "alpha private launch" });
    await memory.createMemory({ userId: "u1", sessionId: "s2", content: "alpha other session" });
    await memory.createMemory({ userId: "u2", sessionId: "s1", content: "alpha other user" });

    const results = await memory.searchMemories({ userId: "u1", sessionId: "s1", query: "alpha", limit: 10 });
    expect(results.map((row) => row.content)).toEqual(["alpha private launch"]);
  });

  it("reindexes and reports healthy index state", async () => {
    await memory.createMemory({ userId: "u1", sessionId: "", content: "global note" });
    expect(await memory.reindexMemories()).toEqual({ indexed: 1 });
    expect(await memory.getMemoryHealth()).toMatchObject({ ok: true, entries: 1, indexed: 1 });
  });

  it("reports a degraded state when FTS5 is unavailable", async () => {
    db.exec("DROP TABLE memoryFts");

    await expect(memory.getMemoryHealth()).resolves.toMatchObject({
      ok: false,
      available: false,
      status: "degraded",
      indexed: null,
    });
    await expect(memory.searchMemories({ userId: "u1", query: "note" }))
      .rejects.toMatchObject({ code: "FTS5_UNAVAILABLE", status: 503 });
    await expect(memory.reindexMemories())
      .rejects.toMatchObject({ code: "FTS5_UNAVAILABLE", status: 503 });
  });
});
