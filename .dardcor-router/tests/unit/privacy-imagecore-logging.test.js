/**
 * imageGenerationCore debug logging must not leak prompt content when
 * privacyMode is non-normal. Normal mode keeps the prompt preview (unchanged).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const originalFetch = global.fetch;

function collectLogs() {
  const calls = [];
  const log = { debug: (...a) => calls.push(a.join(" ")) };
  return { calls, log };
}

const imageResponse = () =>
  new Response(
    JSON.stringify({ created: 123, data: [{ url: "https://example.com/i.png" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("handleImageGenerationCore prompt logging", () => {
  it("normal mode logs the prompt preview", async () => {
    global.fetch.mockResolvedValueOnce(imageResponse());
    const { calls, log } = collectLogs();
    const result = await handleImageGenerationCore({
      body: { prompt: "SECRET PROMPT CONTENT", n: 1 },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "k" },
      log,
      privacyMode: "normal",
    });
    expect(result.success).toBe(true);
    expect(calls.join("\n")).toContain("SECRET PROMPT CONTENT");
  });

  it("strict mode omits prompt content from debug logs", async () => {
    global.fetch.mockResolvedValueOnce(imageResponse());
    const { calls, log } = collectLogs();
    const result = await handleImageGenerationCore({
      body: { prompt: "SECRET PROMPT CONTENT", n: 1 },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "k" },
      log,
      privacyMode: "strict",
    });
    expect(result.success).toBe(true);
    const all = calls.join("\n");
    expect(all).not.toContain("SECRET PROMPT CONTENT");
    expect(all).toContain("OPENAI | dall-e-3");
  });

  it("defaults to normal when privacyMode is omitted (no behavior change)", async () => {
    global.fetch.mockResolvedValueOnce(imageResponse());
    const { calls, log } = collectLogs();
    const result = await handleImageGenerationCore({
      body: { prompt: "visible in normal", n: 1 },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "k" },
      log,
    });
    expect(result.success).toBe(true);
    expect(calls.join("\n")).toContain("visible in normal");
  });
});
