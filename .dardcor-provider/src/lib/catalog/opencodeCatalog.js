// OpenCode Zen server catalog: models fetched from the fixed /models endpoint,
// cached globally (hot-reload-safe) for 6h, classified for free tier + data
// retention, with an added/removed diff against the previous snapshot.
//
// The free set rotates upstream. A model is free when its id ends with "-free",
// its prompt+completion pricing is explicitly zero, OpenCode documents it as a
// free model without the suffix, or the user overrides it via zenFreeModelOverrides.
// data_retention defaults to "unknown" with a warning (fail-safe) unless
// zenRetentionOverrides pins a value.

import { getSettings } from "@/lib/localDb";

export const OPENCODE_MODELS_URL = "https://opencode.ai/zen/v1/models";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const RETRY_AFTER_FAIL_MS = 60 * 1000; // don't hammer a down endpoint
const FETCH_TIMEOUT_MS = 15000;
const DEFAULT_RETENTION = "unknown";
const DOCUMENTED_FREE_IDS = new Set(["big-pickle", "ox-alpha-free"]);

// globalThis keeps the cache across Next.js dev hot reloads (module-level `let`
// is reset on every HMR reload and would refetch + lose the diff baseline).
const GLOBAL_KEY = "__miaw_opencode_catalog_v1__";

function getGlobal() {
  globalThis[GLOBAL_KEY] ||= {
    models: null, // raw model objects from the last successful fetch
    lastIds: [], // model id snapshot used for the diff
    lastDiff: { added: [], removed: [] },
    fetchedAt: null,
    lastAttemptAt: 0,
    lastError: null,
  };
  return globalThis[GLOBAL_KEY];
}

function priceToNumber(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return value;
  const s = String(value).trim();
  if (s === "" || !Number.isFinite(Number(s))) return null;
  return Number(s);
}

// Missing prices are unknown, not free. The public Zen model list currently
// omits prices for paid and free models alike.
function isZeroPriced(model) {
  const pricing = model?.pricing || {};
  const prompt = priceToNumber(pricing.prompt ?? model?.input_price ?? model?.input_cost);
  const completion = priceToNumber(pricing.completion ?? model?.output_price ?? model?.output_cost);
  return prompt === 0 && completion === 0;
}

function overrideFor(id, overrides) {
  if (!overrides || typeof overrides !== "object") return undefined;
  if (Array.isArray(overrides)) return overrides.includes(id) ? true : undefined;
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  return undefined;
}

// Shared classifier: documented free id, `-free` suffix, explicit zero pricing,
// or a settings override (object map id -> bool, or array treated as a free-id list).
export function classifyModelFree(model, overrides = null) {
  const id = model?.id;
  if (!id) return false;
  const override = overrideFor(id, overrides);
  if (override !== undefined) return override === true || override === "true";
  if (String(id).endsWith("-free") || DOCUMENTED_FREE_IDS.has(id)) return true;
  return isZeroPriced(model);
}

// Retention: explicit override wins; otherwise default to unknown + warn.
export function classifyModelRetention(model, overrides = null) {
  const id = model?.id;
  const override = overrideFor(id, overrides);
  if (override !== undefined) {
    if (override === false || override === "false" || override === "none" || override === "no") {
      return { data_retention: "none", retention_warning: false };
    }
    if (typeof override === "string" && override.trim() !== "") {
      return { data_retention: override.trim(), retention_warning: false };
    }
  }
  return { data_retention: DEFAULT_RETENTION, retention_warning: true };
}

function parseModels(data) {
  const list = Array.isArray(data) ? [...data] : [...(data?.data ?? data?.models ?? [])];
  if (!list.some(m => m?.id === "ox-alpha-free")) {
    list.unshift({ id: "ox-alpha-free", name: "Ox Alpha Free", object: "model", owned_by: "opencode" });
  }
  return list;
}

async function fetchCatalog() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OPENCODE_MODELS_URL, {
      headers: { "x-opencode-client": "desktop" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenCode Zen models: HTTP ${res.status}`);
    const json = await res.json();
    const raw = parseModels(json).filter((m) => m && typeof m.id === "string");

    const g = getGlobal();
    const nextIds = raw.map((m) => m.id);
    g.lastDiff = {
      added: raw.filter((m) => !g.lastIds.includes(m.id)),
      removed: g.lastIds.filter((id) => !nextIds.includes(id)),
    };
    g.models = raw;
    g.lastIds = nextIds;
    g.fetchedAt = Date.now();
    g.lastAttemptAt = Date.now();
    g.lastError = null;
    return g;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Latest catalog. Never throws — returns stale cached data (flagged) on fetch
 * failure so routing keeps working from the last known-good snapshot.
 * @returns {Promise<{models: object[], diff: {added: object[], removed: string[]}, fetchedAt: number|null, stale: boolean, error: string|null}>}
 */
export async function getOpenCodeCatalog() {
  const g = getGlobal();
  const fresh = g.models && g.fetchedAt && Date.now() - g.fetchedAt < CACHE_TTL_MS;
  if (fresh) {
    return { models: g.models, diff: g.lastDiff, fetchedAt: g.fetchedAt, stale: false, error: null };
  }
  if (Date.now() - g.lastAttemptAt < RETRY_AFTER_FAIL_MS) {
    if (g.models) {
      return { models: g.models, diff: g.lastDiff, fetchedAt: g.fetchedAt, stale: true, error: g.lastError };
    }
    return { models: [], diff: { added: [], removed: [] }, fetchedAt: null, stale: true, error: g.lastError || "catalog fetch failed" };
  }
  try {
    const state = await fetchCatalog();
    return { models: state.models, diff: state.lastDiff, fetchedAt: state.fetchedAt, stale: false, error: null };
  } catch (err) {
    const message = err?.message || String(err);
    g.lastAttemptAt = Date.now();
    g.lastError = message;
    if (g.models) {
      return { models: g.models, diff: g.lastDiff, fetchedAt: g.fetchedAt, stale: true, error: message };
    }
    return { models: [], diff: { added: [], removed: [] }, fetchedAt: null, stale: true, error: message };
  }
}

/**
 * Catalog enriched with per-model `free`, `data_retention`, `retention_warning`
 * (raw metadata preserved — only augmented) plus the free-id set and whether
 * zenFreeOnly is active, so callers can hard-filter routing to free models.
 */
export async function getOpenCodeModelList(settingsOverride = null) {
  const catalog = await getOpenCodeCatalog();
  const settings = settingsOverride || (await getSettings());
  const overrides = settings.zenFreeModelOverrides || {};
  const retentionOverrides = settings.zenRetentionOverrides || {};

  const models = (catalog.models || []).map((m) => ({
    ...m,
    free: classifyModelFree(m, overrides),
    ...classifyModelRetention(m, retentionOverrides),
  }));
  const freeModels = models.filter((m) => m.free);
  const freeIds = new Set(freeModels.map((m) => m.id));

  return {
    ...catalog,
    models,
    freeModels,
    freeIds,
    overrides,
    freeOnlyEnabled: settings.zenFreeOnly === true,
  };
}

/**
 * zenFreeOnly guard for the chat path (single-model choke point). True when the
 * model may be routed: guard disabled, explicit positive override, `-free`
 * suffix, or present in the classified free set. Fail-closed — when the catalog
 * is empty/unavailable only the suffix/override exceptions pass. Never applies
 * to opencode-go (the caller checks provider === "opencode").
 * @param {string} modelId
 * @param {object|null} settings - optional preloaded settings to avoid a second DB read
 */
export async function isOpenCodeFreeAllowed(modelId, settings = null) {
  const s = settings || (await getSettings());
  if (s.zenFreeOnly !== true) return true;
  const overrides = s.zenFreeModelOverrides || {};
  const override = overrideFor(modelId, overrides);
  if (override !== undefined) return override === true || override === "true";
  if (String(modelId).endsWith("-free")) return true;
  const list = await getOpenCodeModelList(s);
  return list.freeIds.has(modelId);
}
