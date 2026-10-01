import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

async function freshDb() {
  vi.resetModules();
  const mod = await import("@/lib/db/index.js");
  await mod.initDb();
  return mod;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-privacy-"));
  process.env.DATA_DIR = tempDir;
  db = await freshDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("createRequestLogger — options.enabled=false", () => {
  it("returns no-op logger when options.enabled is false", async () => {
    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    const logger = await createRequestLogger("openai", "claude", "gpt-4", { enabled: false });
    expect(logger.sessionPath).toBeNull();
    expect(typeof logger.logClientRawRequest).toBe("function");
    expect(typeof logger.logRawRequest).toBe("function");
    expect(typeof logger.logProviderResponse).toBe("function");
    expect(typeof logger.logError).toBe("function");
  });

  it("all methods are callable without error", async () => {
    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    const logger = await createRequestLogger("openai", "claude", "gpt-4", { enabled: false });
    expect(() => logger.logClientRawRequest("/v1/chat", {}, {})).not.toThrow();
    expect(() => logger.logRawRequest({})).not.toThrow();
    expect(() => logger.logOpenAIRequest({})).not.toThrow();
    expect(() => logger.logTargetRequest("http://x", {}, {})).not.toThrow();
    expect(() => logger.logProviderResponse(200, "ok", {}, {})).not.toThrow();
    expect(() => logger.appendProviderChunk("chunk")).not.toThrow();
    expect(() => logger.appendOpenAIChunk("chunk")).not.toThrow();
    expect(() => logger.logConvertedResponse({})).not.toThrow();
    expect(() => logger.appendConvertedChunk("chunk")).not.toThrow();
    expect(() => logger.logError(new Error("test"))).not.toThrow();
  });

  it("omitting options preserves existing behavior (no-op if env disabled)", async () => {
    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    const logger = await createRequestLogger("openai", "claude", "gpt-4");
    expect(logger.sessionPath).toBeNull();
  });
});

describe("requestDetailsRepo — privacyMode body suppression", () => {
  it("normal mode: bodies are stored", async () => {
    await db.updateSettings({ privacyMode: "normal" });
    db = await freshDb();
    await db.saveRequestDetail({
      id: "priv-normal-1", provider: "openai", model: "gpt-4", status: "ok",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      request: { messages: [{ role: "user", content: "hello" }] },
      providerRequest: { url: "https://api.openai.com/v1/chat" },
      providerResponse: { id: "chatcmpl-123" },
      response: { content: "hi" },
    });
    await new Promise((r) => setTimeout(r, 200));

    const got = await db.getRequestDetailById("priv-normal-1");
    expect(got).toBeDefined();
    expect(got.request).toBeDefined();
    expect(got.request.messages).toBeDefined();
    expect(got.providerRequest).toBeDefined();
    expect(got.providerResponse).toBeDefined();
    expect(got.response).toBeDefined();
  });

  it("non-normal mode: bodies are omitted, metadata preserved", async () => {
    await db.updateSettings({ privacyMode: "strict" });
    db = await freshDb();

    await db.saveRequestDetail({
      id: "priv-strict-1", provider: "anthropic", model: "claude-3", status: "ok",
      latency: { ttft: 100, total: 500 },
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      request: { messages: [{ role: "user", content: "secret data" }] },
      providerRequest: { url: "https://api.anthropic.com/v1/messages" },
      providerResponse: { id: "msg-123" },
      response: { content: "response with secrets" },
    });
    await new Promise((r) => setTimeout(r, 200));

    const got = await db.getRequestDetailById("priv-strict-1");
    expect(got).toBeDefined();
    expect(got.provider).toBe("anthropic");
    expect(got.model).toBe("claude-3");
    expect(got.status).toBe("ok");
    expect(got.latency).toEqual({ ttft: 100, total: 500 });
    expect(got.tokens).toEqual({ prompt_tokens: 20, completion_tokens: 10 });
    expect(got.request).toBeUndefined();
    expect(got.providerRequest).toBeUndefined();
    expect(got.providerResponse).toBeUndefined();
    expect(got.response).toBeUndefined();
  });

  it("restoring normal mode: bodies stored again", async () => {
    await db.updateSettings({ privacyMode: "normal" });
    db = await freshDb();
    await db.saveRequestDetail({
      id: "priv-restored-1", provider: "openai", model: "gpt-4", status: "ok",
      tokens: {},
      request: { messages: [{ role: "user", content: "back to normal" }] },
      response: { content: "ok" },
    });
    await new Promise((r) => setTimeout(r, 200));

    const got = await db.getRequestDetailById("priv-restored-1");
    expect(got.request).toBeDefined();
    expect(got.request.messages).toBeDefined();
    expect(got.response).toBeDefined();
  });

  it("settings read failure: saveRequestDetail does not throw", async () => {
    vi.doMock("@/lib/db/repos/settingsRepo.js", async () => ({
      getSettings: () => { throw new Error("DB down"); },
      updateSettings: () => { throw new Error("DB down"); },
      exportSettings: () => { throw new Error("DB down"); },
    }));

    const failDb = await freshDb();
    await expect(
      failDb.saveRequestDetail({
        id: "priv-failsafe-1", provider: "openai", model: "gpt-4", status: "ok",
        tokens: {},
        request: { messages: [{ role: "user", content: "test" }] },
        response: { content: "ok" },
      })
    ).resolves.not.toThrow();

    vi.doUnmock("@/lib/db/repos/settingsRepo.js");
  });
});
