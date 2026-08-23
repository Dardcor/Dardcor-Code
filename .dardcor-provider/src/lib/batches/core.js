import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BATCH_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxRecords: 10_000, concurrency: 2, maxQueued: 100, maxRetries: 2, retentionMs: 7 * 86400_000, maxRetained: 500 });
export const BATCH_STATES = Object.freeze(["queued", "running", "completed", "failed", "canceled"]);

export class BatchError extends Error {
  constructor(code, message) { super(message); this.name = "BatchError"; this.code = code; }
}

export function parseJsonl(input, limits = {}) {
  if (typeof input !== "string") throw new BatchError("INVALID_INPUT", "Input must be a JSONL string");
  const maxBytes = limits.maxBytes ?? BATCH_LIMITS.maxBytes;
  if (Buffer.byteLength(input, "utf8") > maxBytes) throw new BatchError("INPUT_TOO_LARGE", `Input size exceeds ${maxBytes} bytes`);
  const lines = input.split(/\r?\n/).filter((line) => line.trim());
  const maxRecords = limits.maxRecords ?? BATCH_LIMITS.maxRecords;
  if (!lines.length) throw new BatchError("INVALID_INPUT", "Input must contain at least one JSONL record");
  if (lines.length > maxRecords) throw new BatchError("TOO_MANY_RECORDS", `Input exceeds ${maxRecords} records`);
  return lines.map((line, index) => {
    let value;
    try { value = JSON.parse(line); } catch { throw new BatchError("INVALID_JSONL", `Invalid JSON on line ${index + 1}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BatchError("INVALID_JSONL", `Line ${index + 1} must be a JSON object`);
    return value;
  });
}

export function resolveBatchPath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) throw new BatchError("INVALID_PATH", "Invalid batch path");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootReal = fs.realpathSync(root);
  const candidate = path.resolve(rootReal, relative);
  if (candidate !== rootReal && !candidate.startsWith(`${rootReal}${path.sep}`)) throw new BatchError("INVALID_PATH", "Batch path escapes data directory");
  let cursor = rootReal;
  for (const part of path.relative(rootReal, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new BatchError("SYMLINK_PATH", "Symlinks are not allowed in batch paths"); }
    catch (error) { if (error.code !== "ENOENT") throw error; break; }
  }
  return candidate;
}

function appendJsonl(file, value) { fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 }); }

export function createBatchService(options) {
  const store = options.store;
  const root = path.join(options.dataDir, "batches");
  const executors = options.executors || {};
  const concurrency = options.concurrency ?? BATCH_LIMITS.concurrency;
  const maxQueued = options.maxQueued ?? BATCH_LIMITS.maxQueued;
  const maxRetries = options.maxRetries ?? BATCH_LIMITS.maxRetries;
  const queue = [];
  const active = new Map();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  let ready;
  function initialize() {
    ready ||= (async () => {
      const jobs = await store.list();
      const completedAt = new Date().toISOString();
      await Promise.all(jobs.filter((job) => job.status === "running").map((job) => store.update(job.id, {
        status: "failed",
        completedAt,
        error: "Batch execution was interrupted by a service restart",
      })));
    })();
    return ready;
  }

  async function cleanup() {
    const removed = await store.removeExpired?.(new Date(Date.now() - (options.retentionMs ?? BATCH_LIMITS.retentionMs)).toISOString(), options.maxRetained ?? BATCH_LIMITS.maxRetained) || [];
    for (const row of removed) {
      const dir = resolveBatchPath(root, row.id);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  function pump() {
    while (active.size < concurrency && queue.length) {
      const id = queue.shift();
      const controller = new AbortController();
      active.set(id, controller);
      void run(id, controller).finally(() => { active.delete(id); pump(); });
    }
  }

  async function run(id, controller) {
    let job = await store.get(id);
    if (!job || job.status !== "queued") return;
    job = await store.update(id, { status: "running", startedAt: new Date().toISOString(), completedAt: null, error: null });
    const executor = executors[job.provider];
    let failures = 0;
    try {
      const records = parseJsonl(fs.readFileSync(job.inputPath, "utf8"), { maxBytes: job.inputBytes, maxRecords: job.recordCount });
      for (let index = 0; index < records.length; index += 1) {
        if (controller.signal.aborted || (await store.get(id))?.status === "canceled") return;
        const record = records[index];
        try {
          const output = await executor(record, { signal: controller.signal, batchId: id, index });
          appendJsonl(job.resultPath, { custom_id: record.custom_id ?? null, response: output });
        } catch (error) {
          if (controller.signal.aborted) return;
          failures += 1;
          appendJsonl(job.errorPath, { custom_id: record.custom_id ?? null, error: error?.message || "Execution failed" });
        }
      }
      if ((await store.get(id))?.status === "canceled") return;
      await store.update(id, { status: failures ? "failed" : "completed", completedAt: new Date().toISOString(), error: failures ? `${failures} record(s) failed` : null });
    } catch (error) {
      if ((await store.get(id))?.status !== "canceled") await store.update(id, { status: "failed", completedAt: new Date().toISOString(), error: error?.message || "Batch failed" });
    }
  }

  async function create({ provider, input }) {
    await initialize();
    if (typeof provider !== "string" || !provider.trim()) throw new BatchError("INVALID_REQUEST", "Provider is required");
    if (!executors[provider]) throw new BatchError("UNSUPPORTED_PROVIDER", `Provider ${provider} has no batch executor`);
    if (active.size + queue.length >= maxQueued) throw new BatchError("QUEUE_FULL", "Batch queue is full");
    const records = parseJsonl(input, options);
    const id = crypto.randomUUID();
    const dir = resolveBatchPath(root, id);
    fs.mkdirSync(dir, { mode: 0o700 });
    const inputPath = resolveBatchPath(root, `${id}/input.jsonl`);
    const resultPath = resolveBatchPath(root, `${id}/result.jsonl`);
    const errorPath = resolveBatchPath(root, `${id}/errors.jsonl`);
    const normalizedInput = input;
    fs.writeFileSync(inputPath, normalizedInput, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.writeFileSync(resultPath, "", { mode: 0o600, flag: "wx" });
    fs.writeFileSync(errorPath, "", { mode: 0o600, flag: "wx" });
    const now = new Date().toISOString();
    const job = await store.create({ id, provider, status: "queued", inputPath, resultPath, errorPath, inputBytes: Buffer.byteLength(normalizedInput), recordCount: records.length, attempts: 0, error: null, createdAt: now, updatedAt: now, startedAt: null, completedAt: null });
    queue.push(id); pump();
    await cleanup().catch((error) => console.warn(`[batch] retention cleanup failed: ${error.message}`));
    return job;
  }

  async function cancel(id) {
    await initialize();
    const job = await store.get(id);
    if (!job) return null;
    if (["completed", "failed", "canceled"].includes(job.status)) return job;
    const index = queue.indexOf(id); if (index >= 0) queue.splice(index, 1);
    active.get(id)?.abort();
    return store.update(id, { status: "canceled", completedAt: new Date().toISOString(), error: null });
  }

  async function retry(id) {
    await initialize();
    const job = await store.get(id);
    if (!job) return null;
    if (job.status !== "failed") throw new BatchError("INVALID_STATE", "Only failed batches can be retried");
    if (job.attempts >= maxRetries) throw new BatchError("RETRY_LIMIT", "Batch retry limit reached");
    if (active.size + queue.length >= maxQueued) throw new BatchError("QUEUE_FULL", "Batch queue is full");
    if (typeof job.provider !== "string" || !job.provider.trim()) throw new BatchError("INVALID_REQUEST", "Provider is required");
    if (!executors[job.provider]) throw new BatchError("UNSUPPORTED_PROVIDER", `Provider ${job.provider} has no batch executor`);
    fs.writeFileSync(job.resultPath, "", { mode: 0o600 }); fs.writeFileSync(job.errorPath, "", { mode: 0o600 });
    const next = await store.update(id, { status: "queued", attempts: job.attempts + 1, error: null, startedAt: null, completedAt: null });
    queue.push(id); pump();
    return next;
  }

  async function remove(id) {
    await initialize();
    const job = await store.get(id);
    if (!job) return null;
    if (!["completed", "failed", "canceled"].includes(job.status) || active.has(id)) throw new BatchError("INVALID_STATE", "Only inactive terminal batches can be deleted");
    fs.rmSync(resolveBatchPath(root, job.id), { recursive: true, force: true });
    return store.delete(id);
  }

  async function readArtifact(id, key) {
    await initialize();
    const job = await store.get(id); if (!job) return null;
    if (typeof job[key] !== "string" || !job[key]) return null;
    const relative = path.relative(root, job[key]);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const artifactPath = resolveBatchPath(root, relative);
    try { return fs.readFileSync(artifactPath, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  return { create, get: async (id) => { await initialize(); return store.get(id); }, list: async () => { await initialize(); return store.list(); }, cancel, retry, delete: remove,
    providers: () => Object.keys(executors).sort(),
    getResult: (id) => readArtifact(id, "resultPath"), getErrors: (id) => readArtifact(id, "errorPath") };
}
