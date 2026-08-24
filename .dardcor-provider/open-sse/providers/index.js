// Single source: build PROVIDERS + PROVIDER_MODELS from registry/{id}.js (transport + models co-located).
import REGISTRY from "./registry/index.js";
import { PROVIDER_DEFAULTS } from "./schema.js";
import { normalizeModel } from "./models/schema.js";
import { buildTtsProviderModels } from "../config/ttsModels.js";
import { FREE_TIER_MODEL_RECORDS } from "../config/freeTierCatalog.js";

// oauth block is canonical for these fields; inject into transport so executors reading
// this.config.{clientId,clientSecret,tokenUrl} keep working without duplicating in transport
const OAUTH_INJECT_FIELDS = ["clientId", "clientSecret", "tokenUrl"];

// transport: re-apply shared default (format:"openai") + inject oauth-canonical fields
function buildTransport(transport, oauth) {
  const t = { ...transport };
  if (!t.format) t.format = PROVIDER_DEFAULTS.format;
  if (oauth) {
    for (const f of OAUTH_INJECT_FIELDS) {
      if (t[f] === undefined && oauth[f] !== undefined) t[f] = oauth[f];
    }
  }
  return t;
}

const MEDIA_KEYS = new Set([
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
]);

export const PROVIDERS = {};
export const PROVIDER_MODELS = {};
export const PROVIDER_OAUTH = {};
export const PROVIDER_MEDIA = {};
for (const entry of REGISTRY) {
  if (entry.transport) {
    PROVIDERS[entry.id] = buildTransport(entry.transport, entry.oauth);
    if (entry.transports) PROVIDERS[entry.id].transports = entry.transports;
  }
  if (entry.models !== undefined) PROVIDER_MODELS[entry.alias || entry.id] = entry.models.map(normalizeModel);
  if (entry.oauth) PROVIDER_OAUTH[entry.id] = entry.oauth;
  // Build PROVIDER_MEDIA from top-level fields (post-migration) + legacy entry.media
  const mediaFields = {};
  for (const k of MEDIA_KEYS) {
    if (entry[k] !== undefined) mediaFields[k] = entry[k];
  }
  if (entry.media) Object.assign(mediaFields, entry.media);
  if (Object.keys(mediaFields).length) PROVIDER_MEDIA[entry.id] = mediaFields;
}

// Import OmniRoute's curated free-model rows only for providers that already have
// a Dardcor Code runtime entry. Catalog-only providers stay out of PROVIDER_MODELS so
// model validation cannot make an unavailable provider routable.
const registryById = new Map(REGISTRY.map((entry) => [entry.id, entry]));
for (const row of FREE_TIER_MODEL_RECORDS) {
  if (!row.available) continue;
  const entry = registryById.get(row.provider);
  if (!entry) continue;
  const key = entry.alias || entry.id;
  const models = (PROVIDER_MODELS[key] ||= []);
  const freeTier = {
    monthlyTokens: row.monthlyTokens,
    creditTokens: row.creditTokens,
    freeType: row.freeType,
    poolKey: row.poolKey,
    tos: row.tos,
    ...(row.trainsOnPrompts !== undefined ? { trainsOnPrompts: row.trainsOnPrompts } : {}),
  };
  const existing = models.find((model) => model.id === row.modelId);
  if (existing) {
    existing.isFreeTier = true;
    existing.freeTier = freeTier;
  } else {
    models.push({ id: row.modelId, name: row.displayName, isFreeTier: true, freeTier });
  }
}

// TTS model/voice tables keyed by special names (openai-tts-models, ...), not provider ids
Object.assign(PROVIDER_MODELS, buildTtsProviderModels());
