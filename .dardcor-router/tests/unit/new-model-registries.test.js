import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import grokCli from "../../open-sse/providers/registry/grok-cli.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";

const require = createRequire(import.meta.url);
const { MODEL_SYNONYMS, MODEL_PATTERNS } = require("../../src/mitm/config.js");

describe("new provider models", () => {
  it("registers Antigravity Gemini 3.7 Flash tiers", () => {
    const models = new Map(antigravity.models.map((model) => [model.id, model]));

    expect(models.get("gemini-3.7-flash-high")?.upstreamModelId).toBe("gemini-3.7-flash-tiered(high)");
    expect(models.get("gemini-3.7-flash-medium")?.upstreamModelId).toBe("gemini-3.7-flash-tiered(medium)");
    expect(models.get("gemini-3.7-flash-low")?.upstreamModelId).toBe("gemini-3.7-flash-tiered(low)");
  });

  it("registers Grok CLI 4.6", () => {
    expect(grokCli.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "grok-4.6",
        name: "Grok 4.6",
        contextLength: 500000,
        maxOutputTokens: 64000,
      }),
    ]));
  });

  it("resolves Gemini 3.7 and Grok 4.6 capabilities", () => {
    expect(getCapabilitiesForModel("antigravity", "gemini-3.7-flash-high")).toMatchObject({
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
    });
    expect(getCapabilitiesForModel("grok-cli", "grok-4.6")).toMatchObject({
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 500000,
      maxOutput: 64000,
    });
  });

  it("registers usage-accounting prices", () => {
    const geminiPricing = { input: 0.75, output: 3.75, cached: 0.075, reasoning: 5.625, cache_creation: 0.9375 };
    for (const tier of ["high", "medium", "low"]) {
      expect(MODEL_PRICING[`gemini-3.7-flash-${tier}`]).toEqual(geminiPricing);
    }
    expect(MODEL_PRICING["grok-4.6"]).toEqual({
      input: 2.00,
      output: 6.00,
      cached: 0.50,
      reasoning: 9.00,
      cache_creation: 2.00,
    });
  });

  it("keeps Gemini 3.7 aliases exact and matches them before generic Flash", () => {
    for (const tier of ["high", "medium", "low"]) {
      const id = `gemini-3.7-flash-${tier}`;
      expect(MODEL_SYNONYMS.antigravity[id]).toBe(id);

      const rawModel = `gemini-3.7-flash-tiered(${tier})`;
      const pattern = MODEL_PATTERNS.antigravity.find(({ match }) => match.test(rawModel));
      expect(pattern?.alias).toBe(id);
    }

    const specificIndex = MODEL_PATTERNS.antigravity.findIndex(({ match }) => match.test("gemini-3.7-flash-tiered(high)"));
    const genericIndex = MODEL_PATTERNS.antigravity.findIndex(({ alias }) => alias === "gemini-3-flash-agent");
    expect(specificIndex).toBeGreaterThanOrEqual(0);
    expect(specificIndex).toBeLessThan(genericIndex);
    expect(MODEL_PATTERNS.antigravity[specificIndex].alias).toBe("gemini-3.7-flash-high");
  });
});
