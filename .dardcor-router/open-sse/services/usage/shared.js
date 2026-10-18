
import { PROVIDERS } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

export const U = (id) => PROVIDERS[id]?.usage || {};

export function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

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
