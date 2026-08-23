// Fixed upstream URL per filter type. The route ignores any client-supplied
// `url` query param and fetches only these, so /api/providers/suggested-models
// cannot be used as an authenticated SSRF proxy.
import { OPENCODE_MODELS_URL, classifyModelFree } from "@/lib/catalog/opencodeCatalog";

export const FILTER_URLS = {
  "openrouter-free": "https://openrouter.ai/api/v1/models",
  "opencode-free": OPENCODE_MODELS_URL,
  "mimo-free": "https://models.dev/api.json",
};

export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  // Shared classifier: documented free id, -free suffix, explicit zero pricing, or settings override
  // (no hardcoded rotating list — the free set changes upstream).
  "opencode-free": (models) =>
    models
      .filter((m) => classifyModelFree(m))
      .map((m) => ({ id: m.id, name: m.id })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),
};
