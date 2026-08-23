// L1 exact-match response cache: in-memory TTL + bounded LRU keyed by a
// SHA-256 canonical hash of the normalized final request. Only deterministic
// (temperature=0 or seed-pinned) non-streaming, tool-free requests are cached.
// Fail-open: every function here returns without throwing.

import crypto from "crypto";

export const L1_TTL_MS = 5 * 60 * 1000; // entries expire after 5 minutes
export const L1_MAX_ENTRIES = 200;

// key -> { value: { status, body, contentType, storedAt }, expiresAt, lastUsed }
const store = new Map();

function now() {
  return Date.now();
}

// Drop expired entries and evict least-recently-used beyond the bound.
function sweep() {
  const t = now();
  for (const [key, entry] of store) {
    if (t >= entry.expiresAt) store.delete(key);
  }
  while (store.size > L1_MAX_ENTRIES) {
    let oldestKey = null;
    let oldestUsed = Infinity;
    for (const [key, entry] of store) {
      if (entry.lastUsed < oldestUsed) {
        oldestUsed = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey === null) break;
    store.delete(oldestKey);
  }
}

// Canonical deep-normalize for the cache key: sort keys, drop cache_control
// markers (they are L0/translator artifacts and do not affect the response).
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "cache_control") continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

// Cache isolation scope: router API key + provider account connection. Only
// ever fed into the SHA-256 key — the raw values are never stored or exposed.
export function cacheScope(connectionId, apiKey) {
  return `${connectionId || ""}::${apiKey || ""}`;
}

/**
 * SHA-256 canonical key over normalized request + model/provider/format/scope.
 * The key basis is the FINAL body (post translation, token savers, L0), so the
 * same provider request always maps to the same key. Scope isolates entries
 * across router API keys, provider accounts, and client formats.
 */
export function l1Key({ provider, model, sourceFormat, targetFormat, body, scope = "" }) {
  const request = JSON.stringify(canonicalize(body ?? {}));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ scope, provider, model, sourceFormat, targetFormat, request }))
    .digest("hex");
}

// Eligibility gate: only deterministic, non-streaming, tool-free, storable
// requests enter the cache. `stream` is the final dispatch decision.
export function isCacheable(body, { stream = false } = {}) {
  if (stream) return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (body.store === false) return false; // explicit no-store
  const temperature = Number(body.temperature);
  if (body.seed == null && (body.temperature == null || temperature !== 0)) return false;
  if (Array.isArray(body.tools) && body.tools.length > 0) return false;
  if (body.tool_choice && body.tool_choice !== "none") return false;

  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return false;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) return false;
    if (item.role === "tool") return false;
    if (typeof item.type === "string" && /function_call|custom_tool_call|function_call_output/.test(item.type)) return false;
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if (!block || typeof block !== "object") continue;
        if (typeof block.type === "string" && /tool_use|tool_result|tool_call/.test(block.type)) return false;
      }
    }
  }
  return true;
}

/** Look up a cached response. Returns { status, body, contentType, storedAt } or null. */
export function l1Lookup(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (now() >= entry.expiresAt) {
    store.delete(key);
    return null;
  }
  entry.lastUsed = now();
  sweep();
  return entry.value;
}

/** Store a response under the given key. Returns true when stored. */
export function l1Store(key, value) {
  sweep();
  store.set(key, { value, expiresAt: now() + L1_TTL_MS, lastUsed: now() });
  return true;
}

export function l1Stats() {
  sweep();
  return { entries: store.size, maxEntries: L1_MAX_ENTRIES, ttlMs: L1_TTL_MS };
}

export function l1Clear() {
  store.clear();
}
