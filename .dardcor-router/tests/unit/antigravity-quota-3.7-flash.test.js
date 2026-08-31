import { describe, expect, it, vi, beforeEach } from "vitest";

function makeFetch(models) {
  return vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => url.includes(":loadCodeAssist")
      ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" } }
      : { models },
    text: async () => "{}",
  }));
}

const TIERED_MODELS = {
  "gemini-3.7-flash-tiered(low)": {
    displayName: "Gemini 3.7 Flash (Low)",
    quotaInfo: { remainingFraction: 0.9, resetTime: "2026-08-16T12:00:00Z" },
  },
  "gemini-3.7-flash-tiered(medium)": {
    displayName: "Gemini 3.7 Flash (Medium)",
    quotaInfo: { remainingFraction: 0.6, resetTime: "2026-08-16T12:00:00Z" },
  },
  "gemini-3.7-flash-tiered(high)": {
    displayName: "Gemini 3.7 Flash (High)",
    quotaInfo: { remainingFraction: 0.4, resetTime: "2026-08-16T12:00:00Z" },
  },
};

const PLAIN_MODELS = {
  "gemini-3.7-flash": {
    displayName: "Gemini 3.7 Flash",
    quotaInfo: { remainingFraction: 0.5, resetTime: "2026-08-16T12:00:00Z" },
  },
};

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

describe("Antigravity quota tracker: Gemini 3.7 Flash low→high", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes all tiered 3.7 flash keys to their tiers", async () => {
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    proxyAwareFetch.mockImplementation(makeFetch(TIERED_MODELS));
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas["gemini-3.7-flash-low"]).toMatchObject({
      remainingPercentage: 90,
      displayName: "Gemini 3.7 Flash (Low)",
    });
    expect(usage.quotas["gemini-3.7-flash-medium"]).toMatchObject({
      remainingPercentage: 60,
      displayName: "Gemini 3.7 Flash (Medium)",
    });
    expect(usage.quotas["gemini-3.7-flash-high"]).toMatchObject({
      remainingPercentage: 40,
      displayName: "Gemini 3.7 Flash (High)",
    });
    expect(usage.quotas["gemini-3.7-flash"]).toBeUndefined();
  });

  it("maps the plain non-tiered key to the high tier", async () => {
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    proxyAwareFetch.mockImplementation(makeFetch(PLAIN_MODELS));
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const usage = await getAntigravityUsage("access-token", {});

    // plain `gemini-3.7-flash` must not leak as a raw key — it maps to high
    expect(usage.quotas["gemini-3.7-flash"]).toBeUndefined();
    expect(usage.quotas["gemini-3.7-flash-high"]).toMatchObject({
      remainingPercentage: 50,
      displayName: "Gemini 3.7 Flash",
    });
  });
});
