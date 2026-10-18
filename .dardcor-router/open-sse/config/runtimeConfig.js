export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

export const CACHE_TTL = {
  userInfo: 300,
  modelAlias: 3600
};

export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
};

function envMs(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function envUrl(name, def) {
  const raw = process.env[name]?.trim();
  return raw || def;
}

export const SEARXNG_URL = envUrl("SEARXNG_URL", "http://localhost:8888/search");

export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);

export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);

export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);

export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

export const TOKEN_SAVER_HEADER = "x-dardcor-code-token-saver";

export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 0, delayMs: 0 },
  502: { attempts: 3, delayMs: 3000 },
  503: { attempts: 3, delayMs: 2000 },
  504: { attempts: 2, delayMs: 3000 }
};

export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs
  };
}

export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];
