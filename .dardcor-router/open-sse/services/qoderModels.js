
import { createHash } from "crypto";

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { buildCosyHeaders } from "../shared/qoder/cosy.js";
import {
  QODER_IDE_VERSION,
  QODER_CLIENT_TYPE,
  qoderRegionOf,
  qoderJobTokenExchangeUrl,
  qoderUserInfoUrl,
  qoderInferenceBase,
} from "../shared/qoder/constants.js";

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

const PAT_PREFIX = "pt-";

const PAT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const PAT_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function isQoderPat(token) {
  return typeof token === "string" && token.startsWith(PAT_PREFIX);
}

const patJobCache = new Map();

const catalogCache = new Map();

const inflight = new Map();

async function exchangeJobToken(pat, proxyOptions = null, signal = null, region = "intl") {
  const res = await proxyAwareFetch(
    qoderJobTokenExchangeUrl(region),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "qodercli/1.0.0",
        "Cosy-Version": QODER_IDE_VERSION,
        "Cosy-ClientType": QODER_CLIENT_TYPE,
      },
      body: JSON.stringify({ personal_token: pat }),
      signal,
    },
    proxyOptions,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`qoder PAT exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error("qoder PAT exchange returned no job token");

  let expiresAt = Date.now() + PAT_DEFAULT_TTL_MS;
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at);
    if (!Number.isNaN(parsed)) expiresAt = parsed;
  } else if (typeof data.expires_in === "number" && data.expires_in > 0) {
    expiresAt = Date.now() + data.expires_in;
  }
  return { jobToken: data.token, jobRefreshToken: data.refresh_token || "", expiresAt };
}

async function fetchUserIdForJobToken(jobToken, proxyOptions = null, signal = null, region = "intl") {
  try {
    const res = await proxyAwareFetch(
      qoderUserInfoUrl(region),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jobToken}`,
          Accept: "application/json",
          "User-Agent": "qodercli/1.0.0",
        },
        signal,
      },
      proxyOptions,
    );
    if (!res.ok) return "";
    const data = await res.json().catch(() => ({}));
    return data.id || data.userId || data.user_id || "";
  } catch {
    return "";
  }
}

async function resolvePatCredential(pat, proxyOptions = null, signal = null, region = "intl") {
  const cacheKey = `${region}:${pat}`;
  const cached = patJobCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > PAT_REFRESH_BUFFER_MS) return cached;

  const { jobToken, expiresAt } = await exchangeJobToken(pat, proxyOptions, signal, region);
  const userId = await fetchUserIdForJobToken(jobToken, proxyOptions, signal, region);
  const resolved = { accessToken: jobToken, userId, expiresAt };
  patJobCache.set(cacheKey, resolved);
  return resolved;
}

export async function resolveQoderCredentials(credentials, proxyOptions = null, signal = null, region) {
  const raw = credentials?.apiKey || credentials?.accessToken;
  if (isQoderPat(raw)) {
    const effRegion = region || qoderRegionOf(credentials?.provider);
    const resolved = await resolvePatCredential(raw, proxyOptions, signal, effRegion);
    return {
      ...credentials,
      accessToken: resolved.accessToken,
      apiKey: undefined,
      providerSpecificData: {
        authMethod: "pat",
        ...(credentials?.providerSpecificData || {}),
        userId: resolved.userId || credentials?.providerSpecificData?.userId || "",
        machineId: credentials?.providerSpecificData?.machineId || "",
      },
    };
  }
  return credentials;
}

function cacheKey(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const seed = psd.userId || credentials?.refreshToken || credentials?.accessToken || "anonymous";
  const region = qoderRegionOf(credentials?.provider);
  return createHash("sha256").update(`qoder:${region}:${seed}`).digest("hex");
}

function cosyCredsFromConnection(credentials) {
  const psd = credentials?.providerSpecificData || {};
  return {
    userId: psd.userId,
    authToken: credentials.accessToken,
    name: credentials.displayName || "",
    email: credentials.email || "",
    machineId: psd.machineId || "",
  };
}

async function fetchQoderCatalogRaw(credentials, signal, proxyOptions = null, region = "intl") {
  const creds = cosyCredsFromConnection(credentials);
  if (!creds.userId || !creds.authToken) return null;

  const modelListUrl = `${qoderInferenceBase(credentials, region)}/algo/api/v2/model/list`;

  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    ...buildCosyHeaders(Buffer.alloc(0), modelListUrl, creds),
  };

  const controller = new AbortController();
  let timer = null;
  let abortListener = null;
  let response;
  try {
    timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        abortListener = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abortListener);
      }
    }
    response = await proxyAwareFetch(
      modelListUrl,
      {
        method: "GET",
        headers,
        signal: controller.signal,
      },
      proxyOptions,
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

  if (!response.ok) return null;

  const body = await response.json().catch(() => null);
  if (!body || !Array.isArray(body.chat)) return null;

  const models = [];
  const rawConfigs = new Map();
  for (const entry of body.chat) {
    if (!entry || typeof entry !== "object") continue;
    const key = entry.key;
    if (!key) continue;

    rawConfigs.set(key, entry);
    if (entry.enable === false) continue;

    const display = entry.display_name || key;
    const ctx = Number(entry.max_input_tokens) || 131_072;
    models.push({
      id: key,
      name: `${display}`,
      contextLength: ctx,
      isVL: !!entry.is_vl,
      isReasoning: !!entry.is_reasoning,
      maxOutputTokens: Number(entry.max_output_tokens) || 0,
      description: entry.description || "",
    });
  }

  return { models, rawConfigs };
}

export async function getQoderModelConfig(credentials, modelKey, options = {}) {
  const cached = await resolveQoderModels(credentials, options);
  if (!cached) return null;
  const config = cached.rawConfigs.get(modelKey);
  if (!config) return null;
  return { ...config, key: modelKey };
}

export async function resolveQoderModels(credentials, options = {}) {
  const region = options.region || qoderRegionOf(credentials?.provider);
  let resolved;
  try {
    resolved = await resolveQoderCredentials(credentials, options.proxyOptions, options.signal, region);
  } catch (error) {
    options.log?.warn?.("QODER", `PAT exchange failed: ${error.message}`);
    return null;
  }
  if (!resolved?.accessToken || !(resolved.providerSpecificData || {}).userId) return null;
  if (resolved && !resolved.provider) {
    resolved.provider = region === "cn" ? "qoder-cn" : "qoder";
  }

  const key = cacheKey(resolved);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached;
    }
  }

  const existing = inflight.get(key);
  if (existing && !options.forceRefresh) {
    return existing;
  }

  const fetchPromise = (async () => {
    const fetched = await fetchQoderCatalogRaw(resolved, options.signal, options.proxyOptions, region);
    if (!fetched) return null;
    const entry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      models: fetched.models,
      rawConfigs: fetched.rawConfigs,
      fetched: true,
    };
    catalogCache.set(key, entry);
    return entry;
  })();

  inflight.set(key, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    if (inflight.get(key) === fetchPromise) {
      inflight.delete(key);
    }
  }
}

export function routableQoderModels(catalog) {
  if (!catalog) return [];
  const out = [];
  const seen = new Set();
  for (const m of catalog.models || []) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, name: m.name || m.id, hidden: false });
  }
  for (const [key, cfg] of catalog.rawConfigs || []) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, name: cfg?.display_name || key, hidden: true });
  }
  return out;
}

export function invalidateQoderCatalog(credentials) {
  if (!credentials) return;
  catalogCache.delete(cacheKey(credentials));
}

export function clearQoderCatalog() {
  catalogCache.clear();
}
