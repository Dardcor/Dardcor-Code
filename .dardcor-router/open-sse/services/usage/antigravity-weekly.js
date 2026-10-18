
import { U, parseResetTime, fetchWithTimeout } from "./shared.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../../providers/shared.js";

const WEEKLY_CONFIG = {
  ...U("antigravity"),
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

const WEEKLY_CACHE_TTL_MS = 180_000;
const weeklyCache = new Map();

function cacheKey(accessToken, projectId) {
  return `${accessToken}::${projectId || ""}`;
}

export function _clearWeeklyCache() {
  weeklyCache.clear();
}

const GROUP_MATCHERS = [
  { pattern: /gemini/i, key: "gemini_weekly", displayName: "Gemini (Weekly)" },
  { pattern: /claude|gpt/i, key: "claude_gpt_weekly", displayName: "Claude & GPT (Weekly)" },
];

export function parseWeeklyQuotaSummary(data) {
  if (!data || typeof data !== "object") return {};

  const groups = Array.isArray(data.groups)
    ? data.groups
    : Array.isArray(data.quotaSummary?.groups)
      ? data.quotaSummary.groups
      : null;

  if (!groups) return {};

  const result = {};

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const displayName = group.displayName || "";

    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== "object") continue;

      const bucketText = `${bucket.bucketId || ""} ${bucket.displayName || ""}`.toLowerCase();
      if (!bucketText.includes("weekly")) continue;

      if (bucket.disabled === true) continue;

      const remainingFraction = Number(bucket.remainingFraction);
      if (!Number.isFinite(remainingFraction)) continue;

      for (const matcher of GROUP_MATCHERS) {
        if (matcher.pattern.test(displayName)) {
          const total = 1000;
          const remaining = Math.round(total * remainingFraction);
          const used = Math.max(0, total - remaining);

          result[matcher.key] = {
            used,
            total,
            resetAt: parseResetTime(bucket.resetTime),
            remainingPercentage: remainingFraction * 100,
            unlimited: false,
            displayName: matcher.displayName,
          };
          break;
        }
      }
    }
  }

  return result;
}

export async function fetchAntigravityWeeklyQuota(accessToken, projectId, proxyOptions = null) {
  const key = cacheKey(accessToken, projectId);

  const hit = weeklyCache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  const promise = (async () => {
    try {
      const url = WEEKLY_CONFIG.quotaSummaryApiUrl;
      if (!url) return {};

      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": WEEKLY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {}),
        }),
      }, 10000, proxyOptions);

      if (!response.ok) return {};

      const data = await response.json();
      return parseWeeklyQuotaSummary(data);
    } catch {
      return {};
    }
  })();

  weeklyCache.set(key, { promise });

  try {
    const result = await promise;
    if (result && Object.keys(result).length > 0) {
      weeklyCache.set(key, { result, expiresAt: Date.now() + WEEKLY_CACHE_TTL_MS });
    } else {
      weeklyCache.delete(key);
    }
    return result;
  } catch {
    weeklyCache.delete(key);
    return {};
  }
}
