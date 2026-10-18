
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

const MODELS_URL = U("groq").url;

function parseGroqDurationMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let match;
  let totalMs = 0;
  let matched = false;
  while ((match = re.exec(value))) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2];
    const unitMs = unit === "h" ? 3600000 : unit === "m" ? 60000 : unit === "ms" ? 1 : 1000;
    totalMs += amount * unitMs;
  }
  return matched ? totalMs : null;
}

function resetAtFromDuration(value) {
  const ms = parseGroqDurationMs(value);
  return ms === null ? null : new Date(Date.now() + ms).toISOString();
}

function buildRateLimitQuota(headers, limitKey, remainingKey, resetKey) {
  const limitRaw = headers.get(limitKey);
  const remainingRaw = headers.get(remainingKey);
  if (limitRaw === null || remainingRaw === null) return null;

  const limit = Number(limitRaw);
  const remaining = Number(remainingRaw);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;

  return {
    used: Math.max(0, limit - remaining),
    total: limit,
    resetAt: resetAtFromDuration(headers.get(resetKey)),
    unlimited: false,
  };
}

export async function getGroqUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Groq API key not available. Add a key to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      MODELS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { plan: "Groq", message: "Groq authentication failed. Check the API key." };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        plan: "Groq",
        message: `Groq usage API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    await response.text().catch(() => {});

    const requests = buildRateLimitQuota(
      response.headers,
      "x-ratelimit-limit-requests",
      "x-ratelimit-remaining-requests",
      "x-ratelimit-reset-requests",
    );
    const tokens = buildRateLimitQuota(
      response.headers,
      "x-ratelimit-limit-tokens",
      "x-ratelimit-remaining-tokens",
      "x-ratelimit-reset-tokens",
    );

    if (!requests && !tokens) {
      return {
        plan: "Groq",
        message: "Groq connected. No rate-limit data reported for this key yet.",
        quotas: {},
      };
    }

    const quotas = {};
    if (requests) quotas["Requests"] = requests;
    if (tokens) quotas["Tokens"] = tokens;

    return { plan: "Groq", quotas };
  } catch (error) {
    return { message: `Groq error: ${error.message}` };
  }
}
