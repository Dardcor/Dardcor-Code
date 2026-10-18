
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { refreshKiroToken } from "./tokenRefresh.js";

const KIRO_RUNTIME_SDK_VERSION = "1.0.0";
const KIRO_AGENT_OS = "windows";
const KIRO_AGENT_OS_VERSION = "10.0.26200";
const KIRO_NODE_VERSION = "22.21.1";
const KIRO_VERSION = "0.10.32";

const DEFAULT_REGION = "us-east-1";
const FETCH_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

const catalogCache = new Map();

function stripSyntheticSuffixes(id) {
  let out = id;
  if (out.endsWith("-agentic")) out = out.slice(0, -"-agentic".length);
  if (out.endsWith("-thinking")) out = out.slice(0, -"-thinking".length);
  return out;
}

function regionFromProfileArn(profileArn) {
  if (!profileArn || typeof profileArn !== "string") return DEFAULT_REGION;
  const parts = profileArn.split(":");
  if (parts.length >= 4 && parts[3]) return parts[3];
  return DEFAULT_REGION;
}

function buildKiroFingerprintHeaders(credentials) {
  const seed =
    credentials?.providerSpecificData?.clientId
    || credentials?.refreshToken
    || credentials?.providerSpecificData?.profileArn
    || credentials?.accessToken
    || "kiro-anonymous";
  const machineId = createHash("sha256").update(String(seed)).digest("hex");

  const userAgent =
    `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ua/2.1 ` +
    `os/${KIRO_AGENT_OS}#${KIRO_AGENT_OS_VERSION} ` +
    `lang/js md/nodejs#${KIRO_NODE_VERSION} ` +
    `api/codewhispererruntime#${KIRO_RUNTIME_SDK_VERSION} m/N,E ` +
    `KiroIDE-${KIRO_VERSION}-${machineId}`;
  const amzUserAgent = `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} KiroIDE-${KIRO_VERSION}-${machineId}`;

  return {
    "User-Agent": userAgent,
    "x-amz-user-agent": amzUserAgent,
    "x-amzn-kiro-agent-mode": "vibe",
    "x-amzn-codewhisperer-optout": "true",
    "amz-sdk-request": "attempt=1; max=1",
    "amz-sdk-invocation-id": uuidv4(),
    "Accept": "application/json"
  };
}

function buildVariants(upstream, displayName) {
  const safeUpstream = stripSyntheticSuffixes(upstream);
  const display = displayName || `Kiro ${safeUpstream}`;
  const isAuto = safeUpstream === "auto";

  const variants = [
    {
      id: safeUpstream,
      name: display,
      capabilities: { thinking: false, agentic: false }
    },
    {
      id: `${safeUpstream}-thinking`,
      name: `${display} (Thinking)`,
      capabilities: { thinking: true, agentic: false }
    }
  ];

  if (!isAuto) {
    variants.push({
      id: `${safeUpstream}-agentic`,
      name: `${display} (Agentic)`,
      capabilities: { thinking: false, agentic: true }
    });
    variants.push({
      id: `${safeUpstream}-thinking-agentic`,
      name: `${display} (Thinking + Agentic)`,
      capabilities: { thinking: true, agentic: true }
    });
  }

  return variants;
}

function formatDisplayName(modelName, modelId, rateMultiplier) {
  const base = (modelName || modelId || "Kiro").trim();
  const rate = Number(rateMultiplier);
  if (!Number.isFinite(rate) || Math.abs(rate - 1.0) < 1e-9 || rate <= 0) {
    return `Kiro ${base}`;
  }
  const rateStr = rate.toFixed(1).replace(",", ".");
  return `Kiro ${base} (${rateStr}x credit)`;
}

async function fetchKiroCatalogRaw(credentials, signal) {
  const profileArn = credentials?.providerSpecificData?.profileArn || "";
  const region = regionFromProfileArn(profileArn);
  const params = new URLSearchParams();
  params.set("origin", "AI_EDITOR");
  if (profileArn) params.set("profileArn", profileArn);
  const url = `https://q.${region}.amazonaws.com/ListAvailableModels?${params.toString()}`;

  const headers = {
    ...buildKiroFingerprintHeaders(credentials),
    "Authorization": `Bearer ${credentials?.accessToken || ""}`
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  if (signal && typeof signal.addEventListener === "function") {
    signal.addEventListener("abort", () => controller.abort(signal.reason));
  }

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(`Kiro ListAvailableModels ${response.status}: ${text || response.statusText}`);
    err.status = response.status;
    err.body = text;
    throw err;
  }

  const data = await response.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models;
}

function cacheKey(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const seed =
    psd.profileArn
    || psd.clientId
    || credentials?.refreshToken
    || credentials?.accessToken
    || "anonymous";
  return createHash("sha256").update(`kiro:${seed}`).digest("hex");
}

export async function resolveKiroModels(credentials, options = {}) {
  if (!credentials || !credentials.accessToken) {
    options.log?.debug?.("KIRO_MODELS", "No accessToken; skipping live fetch");
    return null;
  }

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) {
      return { models: cached.models, rawModels: cached.rawModels };
    }
  }

  let raw;
  try {
    raw = await fetchKiroCatalogRaw(credentials, options.signal);
  } catch (err) {
    if (err && err.status === 401 && credentials.refreshToken) {
      options.log?.info?.("KIRO_MODELS", "Got 401 from Kiro; refreshing token");
      const refreshed = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        options.log
      );
      if (refreshed?.accessToken) {
        const next = { ...credentials, ...refreshed };
        if (typeof options.onCredentialsRefreshed === "function") {
          try { await options.onCredentialsRefreshed(refreshed); } catch (e) {
            options.log?.warn?.("KIRO_MODELS", `onCredentialsRefreshed failed: ${e?.message || e}`);
          }
        }
        try {
          raw = await fetchKiroCatalogRaw(next, options.signal);
          credentials.accessToken = next.accessToken;
          if (next.refreshToken) credentials.refreshToken = next.refreshToken;
        } catch (err2) {
          options.log?.warn?.("KIRO_MODELS", `Retry after refresh failed: ${err2?.message || err2}`);
          return null;
        }
      } else {
        options.log?.warn?.("KIRO_MODELS", "Token refresh did not return accessToken");
        return null;
      }
    } else {
      options.log?.warn?.("KIRO_MODELS", `ListAvailableModels failed: ${err?.message || err}`);
      return null;
    }
  }

  const expanded = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const upstreamId = m.modelId || m.id;
    if (!upstreamId) continue;
    const display = formatDisplayName(m.modelName, upstreamId, m.rateMultiplier);
    const ctx = Number(m?.tokenLimits?.maxInputTokens) || 200_000;
    for (const v of buildVariants(upstreamId, display)) {
      expanded.push({
        ...v,
        contextLength: ctx,
        rateMultiplier: Number.isFinite(Number(m.rateMultiplier)) ? Number(m.rateMultiplier) : 1.0,
        upstreamModelId: upstreamId,
        description: m.description || ""
      });
    }
  }

  catalogCache.set(key, {
    expiresAt: now + CACHE_TTL_MS,
    models: expanded,
    rawModels: raw
  });

  return { models: expanded, rawModels: raw };
}

export function invalidateKiroModelCache(credentials) {
  if (!credentials) return;
  catalogCache.delete(cacheKey(credentials));
}

export function clearKiroModelCache() {
  catalogCache.clear();
}
