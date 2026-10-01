import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));
const logger = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), maskKey: vi.fn(() => "***") }));

vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({ requireApiKey: true })) }));
vi.mock("@/sse/services/auth.js", () => auth);
vi.mock("@/sse/utils/logger.js", () => logger);

import { handleChat } from "@/sse/handlers/chat.js";

describe("chat guardrail request boundary", () => {
  beforeEach(() => {
    auth.extractApiKey.mockReset().mockReturnValue(null);
    auth.isValidApiKey.mockReset().mockResolvedValue(false);
    logger.warn.mockClear();
  });

  it("blocks a missing key before model routing and emits metadata only", async () => {
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "private-model", messages: [] }),
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { message: "Missing API key" } });
    expect(logger.warn).toHaveBeenCalledWith("GUARDRAIL", "llm-api-key-missing:block");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("private-model");
  });

  it("blocks an invalid key without logging it", async () => {
    auth.extractApiKey.mockReturnValue("sk-private-secret");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer sk-private-secret", "content-type": "application/json" },
      body: JSON.stringify({ model: "model", messages: [] }),
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { message: "Invalid API key" } });
    expect(logger.warn).toHaveBeenCalledWith("GUARDRAIL", "llm-api-key-invalid:block");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-private-secret");
  });
});
