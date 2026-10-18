
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { ANTHROPIC_API_VERSION, CLAUDE_CLI_VERSION } from "../../providers/shared.js";
import { U, parseResetTime } from "./shared.js";

const CLAUDE_CONFIG = {
  oauthUsageUrl: U("claude").oauthUrl,
  usageUrl: U("claude").orgUrl,
  settingsUrl: U("claude").settingsUrl,
  profileUrl: U("claude").profileUrl,
  resetUrl: U("claude").resetUrl,
  apiVersion: ANTHROPIC_API_VERSION,
  userAgent: `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
};

const OAUTH_429_COOLDOWN_MS = 180000;
const oauthCooldown = new Map();

const USAGE_CACHE_TTL_MS = 300000;
const usageCache = new Map();

export async function getClaudeUsage(accessToken, proxyOptions = null, options = {}) {
  const force = options?.force === true;

  if (!force && accessToken) {
    const hit = usageCache.get(accessToken);
    if (hit?.promise) return hit.promise;
    if (hit && hit.expiresAt > Date.now()) return hit.result;
  }

  const stale = (!force && accessToken && usageCache.get(accessToken)?.result) || null;

  const promise = (async () => {
    const result = await fetchClaudeUsageRaw(accessToken, proxyOptions);
    if (accessToken && result?.quotas) {
      usageCache.set(accessToken, {
        result,
        expiresAt: Date.now() + USAGE_CACHE_TTL_MS,
      });
      return result;
    }
    if (stale) return stale;
    return result;
  })();

  if (accessToken) usageCache.set(accessToken, { promise });
  return promise;
}

async function fetchClaudeUsageRaw(accessToken, proxyOptions = null) {
  try {
    const cooldownUntil = oauthCooldown.get(accessToken);
    if (cooldownUntil && Date.now() < cooldownUntil) {
      return await getClaudeUsageLegacy(accessToken, proxyOptions);
    }

    const oauthResponse = await proxyAwareFetch(`${CLAUDE_CONFIG.oauthUsageUrl}?cedar_ember=1`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
        "User-Agent": CLAUDE_CONFIG.userAgent,
      },
    }, proxyOptions);

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas = {};

      const hasUtilization = (window) =>
        window && typeof window === "object" && typeof window.utilization === "number";

      const createQuotaObject = (window) => {
        const used = window.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(window.resets_at),
          unlimited: false,
        };
      };

      if (hasUtilization(data.five_hour)) {
        quotas["session (5h)"] = createQuotaObject(data.five_hour);
      }

      if (hasUtilization(data.seven_day)) {
        quotas["weekly (7d)"] = createQuotaObject(data.seven_day);
      }

      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day" && hasUtilization(value)) {
          const modelName = key.replace("seven_day_", "");
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject(value);
        }
      }

      if (Array.isArray(data.limits)) {
        for (const limit of data.limits) {
          if (limit?.kind !== "weekly_scoped") continue;
          const modelName = String(limit?.scope?.model?.display_name || "").trim().toLowerCase();
          if (!modelName || typeof limit.percent !== "number") continue;
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject({
            utilization: Math.max(0, Math.min(100, limit.percent)),
            resets_at: limit.resets_at,
          });
        }
      }

      return {
        plan: "Claude Code",
        extraUsage: data.extra_usage ?? null,
        resetCredits: parseClaudeResetGrants(data.cedar_ember),
        quotas,
      };
    }

    if (oauthResponse.status === 429) {
      oauthCooldown.set(accessToken, Date.now() + OAUTH_429_COOLDOWN_MS);
    }

    console.warn(`[Claude Usage] OAuth endpoint returned ${oauthResponse.status}, falling back to legacy`);
    return await getClaudeUsageLegacy(accessToken, proxyOptions);
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

export function parseClaudeResetGrants(block) {
  if (!block?.eligible || !Array.isArray(block.grants)) return null;
  const grants = block.grants.filter((g) => g?.id && !g.paused && Number(g.resets_left) > 0);
  const next = grants.find((g) => g.id === block.next_grant_id) || grants[0] || null;
  return {
    availableCount: grants.reduce((sum, g) => sum + Number(g.resets_left), 0),
    nextGrantId: next?.id || null,
    expiresAt: next?.ends_at || null,
    clears: next?.clears || [],
    cooldownUntil: block.cooldown_until || null,
    weeklyResetsAt: block.weekly_resets_at || null,
    grants: block.grants.filter((g) => g?.id).map((g) => ({
      id: g.id,
      label: g.label || "",
      resetsLeft: Number(g.resets_left) || 0,
      resetsTotal: Number(g.resets_total) || 0,
      startsAt: g.starts_at || null,
      endsAt: g.ends_at || null,
      clears: Array.isArray(g.clears) ? g.clears : [],
      paused: g.paused === true,
      usableNow: g.usable_now === true,
      useRequiresLimit: g.use_requires_limit !== false,
    })),
  };
}

export async function consumeClaudeResetGrant(accessToken, grantId, proxyOptions = null) {
  if (!accessToken) throw new Error("No Claude access token available. Please re-authorize the connection.");
  if (!/^[a-z0-9_-]{1,40}$/.test(grantId || "")) throw new Error("Invalid reset grant id.");

  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": CLAUDE_CONFIG.apiVersion,
    "User-Agent": CLAUDE_CONFIG.userAgent,
    "Content-Type": "application/json",
  };

  const profileRes = await proxyAwareFetch(CLAUDE_CONFIG.profileUrl, { method: "GET", headers }, proxyOptions);
  const profile = await profileRes.json().catch(() => null);
  const orgId = profile?.organization?.uuid;
  if (!profileRes.ok || !orgId) throw new Error(`Cannot resolve Claude organization (${profileRes.status}).`);

  const res = await proxyAwareFetch(CLAUDE_CONFIG.resetUrl.replace("{org_id}", orgId), {
    method: "POST",
    headers,
    body: JSON.stringify({ program: "cedar_ember", grant_id: grantId, request_id: crypto.randomUUID() }),
  }, proxyOptions);
  const data = await res.json().catch(() => null);

  usageCache.delete(accessToken);
  return {
    ok: res.ok && data?.result === "reset",
    status: res.status,
    result: data?.result || null,
    reason: data?.reason || null,
    resetsLeft: data?.resets_left ?? null,
    message: data?.error?.message || null,
  };
}

async function getClaudeUsageLegacy(accessToken, proxyOptions = null) {
  try {
    const settingsResponse = await proxyAwareFetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await proxyAwareFetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            quotas: usage,
          };
        }
      }

      return {
        plan: settings.plan || "Unknown",
        organization: settings.organization_name,
        message: "Claude connected. Usage details require admin access.",
      };
    }

    return { message: "Claude connected. Usage API requires admin permissions." };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}
