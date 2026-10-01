import { describe, expect, it } from "vitest";

import {
  FREE_TIER_PROVIDERS,
  FREE_TIER_MODEL_RECORDS,
  FREE_TIER_MODELS_BY_PROVIDER,
  FREE_TIER_PROVIDER_BY_ID,
  FREE_TIER_CATALOG_SOURCE,
  isFreeTierProviderAvailable,
} from "../../open-sse/config/freeTierCatalog.js";

describe("Free Tier pages data shape", () => {
  it("every available provider shown by the page has at least one enabled model", () => {
    // Page filters: available AND has enabled models AND (llm kind OR has models)
    const shown = FREE_TIER_PROVIDERS.filter((p) => {
      if (!p.available) return false;
      const models = (FREE_TIER_MODELS_BY_PROVIDER[p.id] || []).filter(
        (m) => !m.disabled,
      );
      return models.length > 0;
    });
    expect(shown.length).toBeGreaterThan(0);

    for (const provider of shown) {
      const models = (FREE_TIER_MODELS_BY_PROVIDER[provider.id] || []).filter(
        (m) => !m.disabled,
      );
      expect(
        models.length,
        `shown provider "${provider.id}" unexpectedly has no enabled models`,
      ).toBeGreaterThan(0);
    }
  });

  it("available providers all have required UI fields (name, icon, color)", () => {
    for (const provider of FREE_TIER_PROVIDERS.filter((p) => p.available)) {
      expect(provider.name, `${provider.id} missing name`).toBeTruthy();
      expect(provider.icon, `${provider.id} missing icon`).toBeTruthy();
      expect(provider.color, `${provider.id} missing color`).toBeTruthy();
    }
  });

  it("FREE_TIER_MODELS_BY_PROVIDER covers every model record", () => {
    for (const record of FREE_TIER_MODEL_RECORDS) {
      const group = FREE_TIER_MODELS_BY_PROVIDER[record.provider];
      expect(group, `${record.provider} not in MODELS_BY_PROVIDER`).toBeDefined();
      expect(group).toContain(record);
    }
  });

  it("FREE_TIER_PROVIDER_BY_ID covers every provider", () => {
    for (const provider of FREE_TIER_PROVIDERS) {
      expect(FREE_TIER_PROVIDER_BY_ID[provider.id]).toBe(provider);
    }
  });

  it("model records have required fields for page display", () => {
    for (const model of FREE_TIER_MODEL_RECORDS) {
      expect(model.provider, "model missing provider").toBeTruthy();
      expect(model.modelId, "model missing modelId").toBeTruthy();
      // displayName or modelId should be present for display
      expect(
        model.displayName || model.modelId,
        `${model.provider}/${model.modelId} missing display name`,
      ).toBeTruthy();
    }
  });

  it("available providers with noAuth flag have models", () => {
    const keyless = FREE_TIER_PROVIDERS.filter((p) => p.available && p.noAuth);
    // At least some keyless providers should exist
    expect(keyless.length).toBeGreaterThan(0);
    for (const provider of keyless) {
      const models = FREE_TIER_MODELS_BY_PROVIDER[provider.id] || [];
      expect(
        models.length,
        `keyless provider "${provider.id}" has no models`,
      ).toBeGreaterThan(0);
    }
  });

  it("catalog source metadata is present", () => {
    expect(FREE_TIER_CATALOG_SOURCE.repository).toBeTruthy();
    expect(FREE_TIER_CATALOG_SOURCE.modelCatalogCuratedAt).toBeTruthy();
  });

  it("available providers have valid tos values on models", () => {
    const validTos = new Set(["ok", "caution", "ambiguous", "avoid", "unknown"]);
    for (const provider of FREE_TIER_PROVIDERS.filter((p) => p.available)) {
      const models = FREE_TIER_MODELS_BY_PROVIDER[provider.id] || [];
      for (const model of models) {
        if (model.tos) {
          expect(
            validTos.has(model.tos),
            `${provider.id}/${model.modelId} has invalid tos "${model.tos}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("available providers have valid freeType values on models", () => {
    const validTypes = new Set([
      "recurring-daily",
      "recurring-monthly",
      "recurring-uncapped",
      "recurring-credit",
      "one-time-initial",
      "keyless",
    ]);
    for (const provider of FREE_TIER_PROVIDERS.filter((p) => p.available)) {
      const models = FREE_TIER_MODELS_BY_PROVIDER[provider.id] || [];
      for (const model of models) {
        if (model.freeType) {
          expect(
            validTypes.has(model.freeType),
            `${provider.id}/${model.modelId} has invalid freeType "${model.freeType}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("isFreeTierProviderAvailable matches provider.available flag", () => {
    for (const provider of FREE_TIER_PROVIDERS) {
      expect(isFreeTierProviderAvailable(provider.id)).toBe(!!provider.available);
    }
  });
});
