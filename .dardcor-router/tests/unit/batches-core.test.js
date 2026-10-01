import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBatchService, parseJsonl, resolveBatchPath } from "../../src/lib/batches/core.js";

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-batch-")); dirs.push(dir); return dir; }

function memoryStore(initial = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  return {
    create: vi.fn(async (row) => (rows.set(row.id, { ...row }), row)),
    get: vi.fn(async (id) => rows.get(id) || null),
    list: vi.fn(async () => [...rows.values()]),
    update: vi.fn(async (id, changes) => { const row = { ...rows.get(id), ...changes }; rows.set(id, row); return row; }),
    delete: vi.fn(async (id) => { const row = rows.get(id) || null; rows.delete(id); return row; }),
    removeExpired: vi.fn(async () => []),
  };
}

describe("batch input safety", () => {
  it("bounds bytes and records and requires JSON objects", () => {
    expect(parseJsonl('{"a":1}\n{"b":2}\n', { maxBytes: 30, maxRecords: 2 })).toHaveLength(2);
    expect(() => parseJsonl("x", { maxBytes: 30 })).toThrow(/line 1/i);
    expect(() => parseJsonl("[]", { maxBytes: 30 })).toThrow(/object/i);
    expect(() => parseJsonl('{"long":"value"}', { maxBytes: 5 })).toThrow(/size/i);
    expect(() => parseJsonl('{}\n{}', { maxRecords: 1 })).toThrow(/records/i);
  });

  it("keeps paths inside the controlled directory and rejects symlink escape", () => {
    const root = tempDir();
    const outside = tempDir();
    fs.symlinkSync(outside, path.join(root, "escape"));
    expect(() => resolveBatchPath(root, "../outside")).toThrow(/path/i);
    expect(() => resolveBatchPath(root, "/tmp/outside")).toThrow(/path/i);
    expect(() => resolveBatchPath(root, "escape/file.jsonl")).toThrow(/symlink/i);
    expect(resolveBatchPath(root, "job/input.jsonl")).toBe(path.join(root, "job/input.jsonl"));
  });
});

describe("batch lifecycle", () => {
  it("runs queued work to completion and exposes result/error files", async () => {
    const service = createBatchService({ dataDir: tempDir(), store: memoryStore(), concurrency: 1,
      executors: { test: async (record) => ({ custom_id: record.custom_id, ok: true }) } });
    const job = await service.create({ provider: "test", input: '{"custom_id":"a"}\n' });
    await vi.waitFor(async () => expect((await service.get(job.id)).status).toBe("completed"));
    expect(await service.getResult(job.id)).toContain('"ok":true');
    expect(await service.getErrors(job.id)).toBe("");
  });

  it("cancels queued/running jobs and never marks them completed", async () => {
    let release;
    const service = createBatchService({ dataDir: tempDir(), store: memoryStore(), concurrency: 1,
      executors: { test: () => new Promise((resolve) => { release = resolve; }) } });
    const job = await service.create({ provider: "test", input: "{}" });
    await vi.waitFor(async () => expect((await service.get(job.id)).status).toBe("running"));
    expect((await service.cancel(job.id)).status).toBe("canceled");
    release({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await service.get(job.id)).status).toBe("canceled");
  });

  it("retries failed jobs but rejects unsupported providers honestly", async () => {
    let fail = true;
    const service = createBatchService({ dataDir: tempDir(), store: memoryStore(), concurrency: 1,
      executors: { test: async () => { if (fail) throw new Error("temporary"); return { ok: true }; } } });
    await expect(service.create({ provider: "not-real", input: "{}" })).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER" });
    await expect(service.create({ input: "{}" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const job = await service.create({ provider: "test", input: "{}" });
    await vi.waitFor(async () => expect((await service.get(job.id)).status).toBe("failed"));
    fail = false;
    expect((await service.retry(job.id)).status).toBe("queued");
    await vi.waitFor(async () => expect((await service.get(job.id)).status).toBe("completed"));
  });

  it("enforces bounded queue capacity", async () => {
    const service = createBatchService({ dataDir: tempDir(), store: memoryStore(), concurrency: 1, maxQueued: 1,
      executors: { test: () => new Promise(() => {}) } });
    await service.create({ provider: "test", input: "{}" });
    await expect(service.create({ provider: "test", input: "{}" })).rejects.toMatchObject({ code: "QUEUE_FULL" });
  });

  it("deletes only terminal jobs and their controlled artifact directory", async () => {
    const dataDir = tempDir();
    let release;
    const store = memoryStore();
    const service = createBatchService({ dataDir, store, concurrency: 1,
      executors: { test: () => new Promise((resolve) => { release = resolve; }) } });
    const job = await service.create({ provider: "test", input: "{}" });
    await vi.waitFor(async () => expect((await service.get(job.id)).status).toBe("running"));
    await expect(service.delete(job.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    release({ ok: true });
    await vi.waitFor(async () => expect((await service.get(job.id)).status).toBe("completed"));
    const artifactDir = path.join(dataDir, "batches", job.id);
    expect(fs.existsSync(artifactDir)).toBe(true);
    expect((await service.delete(job.id)).id).toBe(job.id);
    expect(await service.get(job.id)).toBeNull();
    expect(fs.existsSync(artifactDir)).toBe(false);
  });

  it("returns no artifact for null and non-string legacy paths", async () => {
    const base = { status: "completed", resultPath: null, errorPath: { legacy: true } };
    const service = createBatchService({ dataDir: tempDir(), store: memoryStore([{ ...base, id: "legacy" }]), executors: {} });
    await expect(service.getResult("legacy")).resolves.toBeNull();
    await expect(service.getErrors("legacy")).resolves.toBeNull();
  });

  it("exposes registry providers and marks stale running jobs failed at startup", async () => {
    const store = memoryStore([{ id: "stale", provider: "z", status: "running" }]);
    const service = createBatchService({ dataDir: tempDir(), store, executors: { z: vi.fn(), a: vi.fn() } });
    expect(service.providers()).toEqual(["a", "z"]);
    await expect(service.get("stale")).resolves.toMatchObject({
      status: "failed",
      error: "Batch execution was interrupted by a service restart",
    });
  });
});
