// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
  ban: 30 * 60 * 1000, // permanent ban / disabled — won't self-resolve
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---

  // Auth / invalid API key (fixed cooldown — no backoff, won't self-resolve)
  { text: "invalid api key",           cooldownMs: COOLDOWN.long },
  { text: "invalid_key",               cooldownMs: COOLDOWN.long },
  { text: "no credentials",            cooldownMs: COOLDOWN.long },
  { text: "unauthorized",              cooldownMs: COOLDOWN.long },
  { text: "authentication",            cooldownMs: COOLDOWN.long },

  // Permanent ban / account blocked (fixed cooldown — no backoff)
  { text: "permanently banned",        cooldownMs: COOLDOWN.ban },
  { text: "account disabled",          cooldownMs: COOLDOWN.ban },
  { text: "account suspended",         cooldownMs: COOLDOWN.ban },
  { text: "suspended",                 cooldownMs: COOLDOWN.ban },

  // Content filter / safety policy (fixed cooldown)
  { text: "content policy",            cooldownMs: COOLDOWN.long },
  { text: "content_filter",            cooldownMs: COOLDOWN.long },
  { text: "safety",                    cooldownMs: COOLDOWN.long },

  // Context length overflow (fixed cooldown — request-level, may resolve on next request)
  { text: "context_length_exceeded",   cooldownMs: TRANSIENT_COOLDOWN_MS },
  { text: "context length",            cooldownMs: TRANSIENT_COOLDOWN_MS },
  { text: "maximum context",           cooldownMs: TRANSIENT_COOLDOWN_MS },
  { text: "token limit",               cooldownMs: TRANSIENT_COOLDOWN_MS },
  { text: "too many tokens",           cooldownMs: TRANSIENT_COOLDOWN_MS },

  // Existing text rules
  { text: "request not allowed",       cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },

  // Rate limits (exponential backoff)
  { text: "rate limit",                backoff: true },
  { text: "too many requests",         backoff: true },
  { text: "quota exceeded",            backoff: true },
  { text: "capacity",                  backoff: true },
  { text: "overloaded",                backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 406, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true },

  // Server errors (transient cooldown — no backoff)
  { status: 500, cooldownMs: TRANSIENT_COOLDOWN_MS },
  { status: 502, cooldownMs: TRANSIENT_COOLDOWN_MS },
  { status: 503, cooldownMs: TRANSIENT_COOLDOWN_MS },
  { status: 504, cooldownMs: TRANSIENT_COOLDOWN_MS },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
