import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { runMigrationOnce } from "../../src/lib/db/migrate.js";

const mocks = vi.hoisted(() => ({ getAdapter: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: mocks.getAdapter }));
const repo = await import("../../src/lib/db/repos/batchesRepo.js");

describe("batch repository", () => {
  let db;
  beforeEach(async () => { db = await createNodeSqliteAdapter(":memory:"); await runMigrationOnce(db); mocks.getAdapter.mockResolvedValue(db); });
  afterEach(() => db?.close());

  it("persists and transitions explicit lifecycle states", async () => {
    const now = new Date().toISOString();
    await repo.createBatch({ id: "b1", provider: "test", status: "queued", inputPath: "/data/input", resultPath: "/data/result", errorPath: "/data/error", inputBytes: 2, recordCount: 1, attempts: 0, error: null, createdAt: now, updatedAt: now, startedAt: null, completedAt: null });
    expect(await repo.getBatch("b1")).toMatchObject({ status: "queued", provider: "test", recordCount: 1 });
    expect(await repo.updateBatch("b1", { status: "running", startedAt: now })).toMatchObject({ status: "running" });
    expect(await repo.updateBatch("b1", { status: "completed", completedAt: now })).toMatchObject({ status: "completed" });
    expect(await repo.deleteBatch("b1")).toMatchObject({ id: "b1", status: "completed" });
    expect(await repo.getBatch("b1")).toBeFalsy();
  });
});
