import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const WEB_COOKIE_PROVIDER_IDS = [
  "claude-web",
  "chatgpt-web",
  "deepseek-web",
  "gemini-web",
  "grok-web",
  "kimi-web",
  "manus-web",
  "notion-web",
  "perplexity-web",
  "qwen-web",
  "v0-vercel-web",
  "venice-web",
  "zai-web",
];

const originalFetch = globalThis.fetch;
const unauthorizedResponse = () => new Response(
  JSON.stringify({ error: { message: "missing credentials" } }),
  { status: 401, headers: { "Content-Type": "application/json" } },
);

describe("web-cookie provider contracts", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(unauthorizedResponse);
    globalThis.fetch = vi.fn(unauthorizedResponse);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(WEB_COOKIE_PROVIDER_IDS)("loads registry, auth, models, and executor for %s", (providerId) => {
    const entry = REGISTRY.find(({ id }) => id === providerId);

    expect(entry).toBeDefined();
    expect(entry.category).toBe("webCookie");
    expect(entry.authType).toBe("cookie");
    expect(entry.models).toEqual(expect.any(Array));
    expect(entry.models.length).toBeGreaterThan(0);

    expect(PROVIDERS[providerId]).toBeDefined();
    expect(PROVIDER_MODELS[entry.alias || providerId].map(({ id }) => id)).toEqual(
      entry.models.map(({ id }) => id),
    );
    expect(hasSpecializedExecutor(providerId)).toBe(true);
    expect(getExecutor(providerId).getProvider()).toBe(providerId);
  });

  it.each(WEB_COOKIE_PROVIDER_IDS)("handles empty credentials without a raw throw for %s", async (providerId) => {
    const entry = REGISTRY.find(({ id }) => id === providerId);
    const result = await getExecutor(providerId).execute({
      model: entry.models[0].id,
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: {},
    });

    expect(result).toEqual(expect.objectContaining({ response: expect.any(Response) }));
    expect(result.response.status).toBeGreaterThanOrEqual(400);
  });
});
