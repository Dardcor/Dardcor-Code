import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export const PRIVACY_MODES = [
  "normal",
  "private-cache",
  "private-no-cache",
  "strict",
  "local-only",
];

// Per-mode permission matrix. Flags are permission gates, not effective values:
// the effective flag is `permission ∧ user toggle` (see computeEffectivePrivacyFlags).
// "normal" permits every user-controlled behavior; the actual defaults for those
// toggles live in settingsRepo (L1 on, L2/L3/headroom/pxpipe off).
const DEFAULT_FLAGS = {
  cacheL1: true,
  cacheL2: true,
  cacheL3: true,
  bodyLogging: true,
  headroom: true,
  pxpipe: true,
  blockProviders: [],
};

export const MODE_TABLE = {
  normal: { ...DEFAULT_FLAGS },
  "private-cache": {
    ...DEFAULT_FLAGS,
    // L1/L3 stay user-controlled; L2 additionally needs a local semantic
    // embedding model. Anything shipping the body to an external service
    // (headroom proxy, pxpipe transform, request-body logs) is forced off.
    bodyLogging: false,
    headroom: false,
    pxpipe: false,
  },
  "private-no-cache": {
    cacheL1: false,
    cacheL2: false,
    cacheL3: false,
    bodyLogging: false,
    headroom: false,
    pxpipe: false,
    blockProviders: [],
  },
  strict: {
    cacheL1: false,
    cacheL2: false,
    cacheL3: false,
    bodyLogging: false,
    headroom: false,
    pxpipe: false,
    blockProviders: [],
  },
  "local-only": {
    cacheL1: false,
    cacheL2: false,
    cacheL3: false,
    bodyLogging: false,
    headroom: false,
    pxpipe: false,
    blockProviders: [],
  },
};

export function resolvePrivacyFlags(settings) {
  const mode = settings?.privacyMode || "normal";
  const table = MODE_TABLE[mode] || MODE_TABLE.normal;
  return {
    ...table,
    blockProviders: [
      ...table.blockProviders,
      ...(settings?.privacyBlockedProviders || []),
    ],
  };
}

export function privacyProviderBlock(provider, privacy) {
  if (!provider || !privacy) return false;
  const flags = privacy.blockProviders || privacy;
  if (!Array.isArray(flags)) return false;
  const id = (provider.id || provider.name || provider).toString().toLowerCase();
  return flags.some((b) => b.toLowerCase() === id);
}

/**
 * Combine the user's settings toggles with the privacy-mode posture into the
 * effective per-request flags chatCore receives.
 * - normal: user toggles govern everything.
 * - private-cache: L1/L3 follow user toggles; L2 only when the semantic
 *   embedding model is local (regex fails closed — unknown/cloud ids disable
 *   L2). headroom/pxpipe/bodyLogging are forced off.
 * - private-no-cache / strict / local-only: all caches off, plus
 *   headroom/pxpipe/bodyLogging off.
 */
export function computeEffectivePrivacyFlags(settings) {
  const mode = settings?.privacyMode || "normal";
  const privacy = resolvePrivacyFlags(settings);
  const l2Local = mode !== "private-cache" || isLocalEmbeddingModel(settings?.semanticCacheModel);
  return {
    mode,
    blockProviders: privacy.blockProviders,
    cacheL1Enabled: !!privacy.cacheL1 && settings?.cacheL1Enabled !== false,
    cacheL2Enabled: !!privacy.cacheL2 && settings?.cacheL2Enabled === true && l2Local,
    cacheL3Enabled: !!privacy.cacheL3 && settings?.cacheL3Enabled === true,
    headroomEnabled: !!privacy.headroom && settings?.headroomEnabled === true,
    pxpipeEnabled: !!privacy.pxpipe && settings?.pxpipeEnabled === true,
    bodyLoggingEnabled: !!privacy.bodyLogging,
  };
}

const LOCAL_HOSTNAME_RE =
  /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\]|::1|.*\.local|.*\.internal)$/i;
const PRIVATE_IP_RE =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/i;

export function isLocalConnection(credentials) {
  // Self-hosted connections carry the endpoint either top-level (custom
  // connections) or in providerSpecificData (ollama-local stores baseUrl there).
  const raw = credentials?.baseUrl || credentials?.providerSpecificData?.baseUrl;
  if (!raw) return false;
  let hostname;
  try {
    const url = new URL(raw);
    hostname = url.hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;
  return LOCAL_HOSTNAME_RE.test(hostname) || PRIVATE_IP_RE.test(hostname);
}

const LOCAL_MODEL_RE =
  /^(ollama|llama\.cpp|vllm|whisper|koka|local|localhost|127\.\d|10\.\d|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i;

export function isLocalEmbeddingModel(model) {
  if (!model || typeof model !== "string") return false;
  return LOCAL_MODEL_RE.test(model);
}

/**
 * Shared privacy gate for every modality handler (chat, image, embeddings,
 * search, fetch, tts, stt, video). Call it twice per request:
 *
 * 1. Before credential selection, without `credentials` — blocks providers on
 *    the strict/local-only blocked list with a 403 BEFORE anything is sent.
 * 2. Inside the account-fallback loop, with the selected `credentials` —
 *    local-only skips remote (non-local) accounts without marking them
 *    unavailable; `bail` is set when the account has no connectionId (virtual
 *    noAuth creds can't be excluded), so the caller returns instead of looping.
 *
 * Returns null when the request may proceed.
 * @param {{provider: string, credentials?: object, settings: object}} arg
 * @returns {null | {block: true, status: number, message: string}
 *                 | {skip: true, bail: boolean, status: number, message: string}}
 */
export function checkPrivacy({ provider, credentials, settings }) {
  const mode = settings?.privacyMode || "normal";
  if (mode !== "strict" && mode !== "local-only") return null;

  if (privacyProviderBlock(provider, resolvePrivacyFlags(settings))) {
    return {
      block: true,
      status: HTTP_STATUS.FORBIDDEN,
      message: `Provider "${provider}" is blocked by privacy settings (${mode})`,
    };
  }

  if (mode === "local-only" && credentials && !isLocalConnection(credentials)) {
    return {
      skip: true,
      bail: !credentials.connectionId,
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      message: `local-only: provider "${provider}" has no local connection`,
    };
  }

  return null;
}
