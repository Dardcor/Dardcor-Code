import { describe, expect, it } from "vitest";

import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import {
  FREE_TIER_MODEL_RECORDS,
  isFreeTierProviderAvailable,
} from "../../open-sse/config/freeTierCatalog.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

const EXPECTED = {
  "github-models": {
    alias: "ghm",
    baseUrl: "https://models.github.ai/inference/chat/completions",
    firstModel: "cohere/cohere-command-a",
  },
  reka: {
    alias: "reka",
    baseUrl: "https://api.reka.ai/v1/chat/completions",
    firstModel: "reka-flash-3",
  },
  deepinfra: {
    alias: "deepinfra",
    baseUrl: "https://api.deepinfra.com/v1/openai/chat/completions",
    firstModel: "anthropic/claude-4-opus",
  },
  inception: {
    alias: "inception",
    baseUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
    firstModel: "mercury-2",
  },
  "nous-research": {
    alias: "nous",
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    firstModel: "Hermes-4-405B",
  },
  ai21: {
    alias: "ai21",
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    firstModel: "jamba-large-1.7",
  },
  friendliai: {
    alias: "friendli",
    baseUrl: "https://api.friendli.ai/serverless/v1/chat/completions",
    firstModel: "meta-llama-3.1-70b-instruct",
  },
};

describe("Wave 1 OmniRoute provider adapters", () => {
  it("registers each absent OpenAI-compatible provider with its exact route and alias", () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const entry = REGISTRY.find((provider) => provider.id === id);
      expect(entry, id).toMatchObject({ id, alias: expected.alias, category: "freeTier" });
      expect(PROVIDERS[id]?.baseUrl, id).toBe(expected.baseUrl);
      expect(resolveProviderAlias(expected.alias), expected.alias).toBe(id);
      expect(getModelsByProviderId(id)[0]?.id, id).toBe(expected.firstModel);
      expect(isFreeTierProviderAvailable(id), id).toBe(true);
    }
  });

  it("preserves the existing Featherless adapter instead of adding a duplicate alias", () => {
    expect(REGISTRY.filter((provider) => provider.id === "featherless")).toHaveLength(1);
    expect(REGISTRY.some((provider) => provider.id === "featherless-ai")).toBe(false);
    expect(resolveProviderAlias("featherless")).toBe("featherless");
    expect(isFreeTierProviderAvailable("featherless-ai")).toBe(false);
  });

  it("exports only routable GitHub chat models from the free-tier rows", () => {
    const githubModels = PROVIDER_MODELS.ghm;
    expect(githubModels).toHaveLength(19);
    expect(githubModels.some((model) => model.id.startsWith("openai/text-embedding-"))).toBe(false);

    const embeddingRows = FREE_TIER_MODEL_RECORDS.filter(
      (row) => row.provider === "github-models" && row.modelId.startsWith("openai/text-embedding-")
    );
    expect(embeddingRows).toHaveLength(2);
    expect(embeddingRows.every((row) => row.available === false)).toBe(true);
  });

  it("sends Reka's required bearer and X-Api-Key headers", () => {
    const headers = new DefaultExecutor("reka").buildHeaders({ apiKey: "reka-key" });
    expect(headers.Authorization).toBe("Bearer reka-key");
    expect(headers["X-Api-Key"]).toBe("reka-key");
  });
});
