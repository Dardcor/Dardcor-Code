import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const CLINE_RECOMMENDED_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const FETCH_TIMEOUT_MS = 5000;

function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return buildClineHeaders(token, { Accept: "application/json" });
}

async function fetchClineRawModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = buildModelListHeaders(token, isApiKey);

    const response = await fetch(CLINEPASS_MODELS_ENDPOINT, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    const rawList = Array.isArray(json) ? json : json?.data;
    return Array.isArray(rawList) ? rawList : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveClinepassModels(credentials) {
  const rawList = await fetchClineRawModels(credentials);
  if (!rawList) return null;

  const models = rawList
    .filter((m) => typeof m?.id === "string" && m.id.startsWith("cline-pass/"))
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
    }));

  return models.length ? { models } : null;
}

async function fetchClineFreeTierModels() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CLINE_RECOMMENDED_MODELS_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    const free = Array.isArray(json?.free) ? json.free : [];
    if (!free.length) return null;

    return free
      .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
      .map((m) => ({ id: m.id, name: m.name || m.id }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveClineModels(credentials) {
  const rawList = await fetchClineRawModels(credentials);
  if (!rawList) return null;

  const models = rawList
    .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
    }));

  const freeTier = await fetchClineFreeTierModels();
  const byId = new Map();
  for (const m of freeTier || []) {
    byId.set(m.id, { ...m, is_free: true });
  }
  for (const m of models) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }
  const merged = Array.from(byId.values());

  return merged.length ? { models: merged } : null;
}
