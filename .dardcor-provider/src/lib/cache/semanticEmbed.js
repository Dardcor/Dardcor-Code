// src-side semantic embedding callback injected into the L2 cache layer.
// Calls the existing local /v1/embeddings route (real embeddings only) when a
// semantic cache model is configured; returns null otherwise. Fail-open: any
// error resolves to null and the L2 layer simply misses.

import { getApiKeys } from "@/lib/localDb";

const DEFAULT_BASE = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:21128";
const EMBED_TIMEOUT_MS = 10000;

// A local /v1 call still needs a valid API key when requireApiKey is on; reuse
// the first active stored key. Cached briefly to avoid a DB read per embed.
let cachedKey = null;
let cachedKeyAt = 0;
const KEY_CACHE_MS = 5 * 60 * 1000;

async function pickApiKey() {
  if (cachedKey && Date.now() - cachedKeyAt < KEY_CACHE_MS) return cachedKey;
  try {
    const keys = await getApiKeys();
    const active = (keys || []).find((k) => k && k.isActive !== false && k.key);
    cachedKey = active?.key || null;
    cachedKeyAt = Date.now();
    return cachedKey;
  } catch {
    return null;
  }
}

/**
 * @param {string} model - semantic cache embedding model (from settings)
 * @returns {((text: string) => Promise<number[] | null>) | null}
 */
export function createSemanticEmbed(model) {
  if (!model) return null;

  return async function semanticEmbed(text) {
    try {
      const headers = { "Content-Type": "application/json" };
      const apiKey = await pickApiKey();
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(`${DEFAULT_BASE}/v1/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: [String(text ?? "")] }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const vector = data?.data?.[0]?.embedding;
      return Array.isArray(vector) && vector.length > 0 ? vector : null;
    } catch {
      return null; // fail-open: L2 treats a failed embed as a miss
    }
  };
}
