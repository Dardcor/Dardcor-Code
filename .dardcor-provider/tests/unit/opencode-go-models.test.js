import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";

const CHAT_MODELS = [
  "glm-5.2",
  "glm-5.1",
  // OpenCode Go docs' endpoint table currently says kimi-k2.7, but its
  // config example and the live API use kimi-k2.7-code.
  "kimi-k2.7-code",
  "kimi-k2.6",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "glm-5.2-high",
  "glm-5.2-max",
  "glm-5",
  "kimi-k2.5",
  "kimi-k3",
  "kimi-k3-max",
  "mimo-v2.5-high",
  "mimo-v2.5-max",
  "hy3",
  "hy3-none",
  "hy3-low",
  "hy3-high",
  "hy3-preview",
  "grok-4.5",
  "grok-4.5-low",
  "grok-4.5-medium",
  "grok-4.5-high",
  "deepseek-v4-pro-low",
  "deepseek-v4-pro-medium",
  "deepseek-v4-pro-high",
  "deepseek-v4-pro-max",
  "deepseek-v4-flash-high",
  "deepseek-v4-flash-max",
];

const MESSAGES_MODELS = [
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.7-max-high",
  "qwen3.7-max-max",
  "qwen3.7-plus-high",
  "qwen3.7-plus-max",
  "qwen3.6-plus-high",
  "qwen3.6-plus-max",
  "qwen3.5-plus",
];

describe("OpenCode Go official model catalog", () => {
  it("matches the documented OpenCode Go model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((model) => model.id);

    const expected = [...CHAT_MODELS, ...MESSAGES_MODELS];
    expect(ids).toHaveLength(expected.length);
    expect(new Set(ids)).toEqual(new Set(expected));
  });

  it("marks documented Qwen and MiniMax models as Anthropic messages format", () => {
    for (const model of MESSAGES_MODELS) {
      expect(getModelTargetFormat("opencode-go", model)).toBe("claude");
    }
  });

  it("keeps GLM, Kimi, DeepSeek, and MiMo on OpenAI-compatible chat format", () => {
    for (const model of CHAT_MODELS) {
      expect(getModelTargetFormat("opencode-go", model)).toBeNull();
    }
  });
});

describe("OpenCode Go endpoint routing", () => {
  it("routes Qwen and MiniMax models to the messages endpoint with x-api-key auth", () => {
    const executor = new OpenCodeGoExecutor();

    for (const model of MESSAGES_MODELS) {
      expect(executor.buildUrl(model)).toBe("https://opencode.ai/zen/go/v1/messages");
      const headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
      expect(headers["x-api-key"]).toBe("sk-test");
      expect(headers["anthropic-version"]).toBeDefined();
      expect(headers.Authorization).toBeUndefined();
    }
  });

  it("routes GLM, Kimi, DeepSeek, and MiMo models to chat/completions with bearer auth", () => {
    const executor = new OpenCodeGoExecutor();

    for (const model of CHAT_MODELS) {
      expect(executor.buildUrl(model)).toBe("https://opencode.ai/zen/go/v1/chat/completions");
      const headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
      expect(headers.Authorization).toBe("Bearer sk-test");
      expect(headers["x-api-key"]).toBeUndefined();
      expect(headers["anthropic-version"]).toBeUndefined();
    }
  });
});
