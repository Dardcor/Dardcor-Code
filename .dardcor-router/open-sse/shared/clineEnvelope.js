import { PROVIDERS } from "../providers/index.js";

export function unwrapClineEnvelope(body, provider) {
  if (!provider || !PROVIDERS[provider]?.quirks?.clineEnvelope) return body;
  const { success, data } = body || {};
  if (success !== true || !data || typeof data !== "object" || Array.isArray(data)) return body;
  return data;
}
