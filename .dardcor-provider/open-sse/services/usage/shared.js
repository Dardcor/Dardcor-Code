/**
 * Shared usage helpers (cross-provider)
 */

import { PROVIDERS } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

// usage endpoints: single source from registry transport.usage
export const U = (id) => PROVIDERS[id]?.usage || {};

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
export function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

// Canonical subscription-tier labels. Aliases (case-insensitive) map onto them;
// anything else is an explicit upstream plan name and is preserved verbatim.
const PLAN_ALIASES = new Map([
  ["free", "Free"],
  ["free plan", "Free"],
  ["free tier", "Free"],
  ["plus", "Plus"],
  ["pro", "Pro"],
  ["professional", "Pro"],
  ["max", "Max"],
  ["team", "Team"],
  ["teams", "Team"],
  ["business", "Business"],
  ["business plan", "Business"],
  ["enterprise", "Enterprise"],
  ["enterprise plan", "Enterprise"],
  ["ultra", "Ultra"],
  ["standard", "Standard"],
  ["individual", "Individual"],
  ["unknown", "Unknown"],
  ["none", "Unknown"],
  ["null", "Unknown"],
  ["n/a", "Unknown"],
  ["pro+", "Pro+"],
  ["pro plus", "Pro+"],
  ["copilot pro+", "Pro+"],
  ["copilot pro plus", "Pro+"],
  ["copilot free", "Free"],
  ["copilot pro", "Pro"],
  ["copilot business", "Business"],
  ["copilot enterprise", "Enterprise"],
  ["copilot student", "Student"],
  ["chatgpt free", "Free"],
  ["chatgpt plus", "Plus"],
  ["chatgpt pro", "Pro"],
  ["chatgpt team", "Team"],
  ["chatgpt business", "Business"],
  ["chatgpt enterprise", "Enterprise"],
  ["claude free", "Free"],
  ["claude pro", "Pro"],
  ["claude team", "Team"],
  ["claude enterprise", "Enterprise"],
  ["default claude max 20x", "Max"],
  ["premium", "Pro"],
  ["google one", "Pro"],
  ["one ai", "Pro"],
  ["lite", "Lite"],
  ["light", "Lite"],
]);

/**
 * Normalize an upstream plan/tier value to a canonical label.
 * Missing/empty/non-string → "Unknown". Known aliases/casing → canonical label.
 * Unfamiliar upstream names are preserved verbatim — never synthesized here.
 */
export function normalizePlan(raw) {
  if (typeof raw !== "string") return "Unknown";
  const trimmed = raw.trim();
  if (!trimmed) return "Unknown";
  const key = trimmed.toLowerCase().replace(/[_\-\s]+/g, " ");
  return PLAN_ALIASES.get(key) || trimmed;
}

export function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeCloudCodeProjectId(project) {
  if (typeof project === "string") return project.trim() || null;
  if (project && typeof project === "object" && typeof project.id === "string") {
    return project.id.trim() || null;
  }
  return null;
}

export async function fetchWithTimeout(url, opts, ms = 10000, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await proxyAwareFetch(url, { ...opts, signal: controller.signal }, proxyOptions);
  } finally {
    clearTimeout(timeoutId);
  }
}
