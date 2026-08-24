import { describe, expect, it } from "vitest";

import {
  FREE_TIER_CATALOG_SOURCE,
  FREE_TIER_MODEL_RECORDS,
  FREE_TIER_MODELS_BY_PROVIDER,
  FREE_TIER_PROVIDERS,
  UNAVAILABLE_FREE_TIER_PROVIDER_IDS,
  isFreeTierProviderAvailable,
} from "../../open-sse/config/freeTierCatalog.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { isValidModel } from "../../open-sse/config/providerModels.js";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS as DISPLAY_FREE_TIER_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("OmniRoute Free Tier catalog import", () => {
  it("pins the complete attributed source snapshot", () => {
    expect(FREE_TIER_CATALOG_SOURCE).toEqual({
      repository: "OmniRoute",
      revision: "930018fd10c2b727dae623310d57cb5a2aec229f",
      providerMetadataUpdatedAt: "2026-07-28",
      modelCatalogCuratedAt: "2026-07-22",
    });
    expect(FREE_TIER_PROVIDERS).toHaveLength(134);
    expect(FREE_TIER_MODEL_RECORDS).toHaveLength(523);
    expect(new Set(FREE_TIER_PROVIDERS.map((provider) => provider.id)).size).toBe(134);
    expect(
      new Set(FREE_TIER_MODEL_RECORDS.map((model) => `${model.provider}\0${model.modelId}`)).size
    ).toBe(523);
  });

  it("contains every model provider and the latest source additions", () => {
    const providers = new Set(FREE_TIER_PROVIDERS.map((provider) => provider.id));
    for (const model of FREE_TIER_MODEL_RECORDS) {
      expect(providers.has(model.provider), `${model.provider}/${model.modelId}`).toBe(true);
      expect(FREE_TIER_MODELS_BY_PROVIDER[model.provider]).toContain(model);
    }
    for (const id of [
      "ainative", "aion", "nara", "navy", "routeway", "sealion",
      "zenmux-free", "veoaifree-web", "github-models", "ollama-cloud",
    ]) {
      expect(providers.has(id), id).toBe(true);
    }
  });

  it("keeps existing Dardcor Code providers active and enriches their model metadata", () => {
    const runtimeIds = new Set(REGISTRY.map((entry) => entry.id));
    for (const provider of FREE_TIER_PROVIDERS.filter((entry) => entry.available)) {
      expect(runtimeIds.has(provider.id), provider.id).toBe(true);
      expect(isFreeTierProviderAvailable(provider.id)).toBe(true);
    }

    const airforce = PROVIDER_MODELS.af.find((model) => model.id === "x-ai/grok-3");
    expect(airforce).toMatchObject({
      isFreeTier: true,
      freeTier: { freeType: "recurring-daily", monthlyTokens: 24_000_000 },
    });
  });

  it("marks catalog-only providers unavailable and never adds them to routing data", () => {
    const runtimeIds = new Set(REGISTRY.map((entry) => entry.id));
    const unavailable = FREE_TIER_PROVIDERS.filter((provider) => !provider.available);
    expect(unavailable.length).toBe(UNAVAILABLE_FREE_TIER_PROVIDER_IDS.size);
    expect(unavailable.length).toBeGreaterThan(0);

    for (const provider of unavailable) {
      expect(provider).toMatchObject({ disabled: true, unavailable: true });
      expect(provider.unavailableReason).toMatch(/no compatible executor\/transport/i);
      expect(runtimeIds.has(provider.id), provider.id).toBe(false);
      expect(PROVIDERS[provider.id], provider.id).toBeUndefined();
      expect(AI_PROVIDERS[provider.id], provider.id).toBeUndefined();
      expect(DISPLAY_FREE_TIER_PROVIDERS[provider.id], provider.id).toMatchObject({ disabled: true });
      expect(isFreeTierProviderAvailable(provider.id)).toBe(false);
      for (const model of FREE_TIER_MODELS_BY_PROVIDER[provider.id] || []) {
        expect(isValidModel(provider.id, model.modelId), `${provider.id}/${model.modelId}`).toBe(false);
      }
    }
  });
});
