
import { CLIENT_METADATA } from "../../config/appConstants.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT } from "../../providers/shared.js";
import { U, parseResetTime, normalizeCloudCodeProjectId, fetchWithTimeout } from "./shared.js";
import { fetchAntigravityWeeklyQuota } from "./antigravity-weekly.js";

const ANTIGRAVITY_CONFIG = {
  ...U("antigravity"),
  ...ANTIGRAVITY_OAUTH_CLIENT,
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

export async function getGeminiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    let projectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId(subInfo?.cloudaicompanionProject);
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return {
        plan,
        message: "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const response = await fetchWithTimeout(
      U("gemini-cli").quotaUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
      },
      10000,
      proxyOptions
    );

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000;
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Gemini CLI error: ${error.message}` };
  }
}

async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(
      U("gemini-cli").loadCodeAssistUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metadata: CLIENT_METADATA }),
      },
      10000,
      proxyOptions
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
    const projectId = subscriptionInfo?.cloudaicompanionProject || null;

    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.quotaApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
      body: JSON.stringify({
        ...(projectId ? { project: projectId } : {})
      }),
    }, 10000, proxyOptions);

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {}
      };
    }

    if (response.status === 401) {
      return {
        message: "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {}
      };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas = {};

    const paidTierId = subscriptionInfo?.paidTier?.id;
    const isFreeTier = !paidTierId || paidTierId === "free-tier";

    if (!isFreeTier && data.models) {
      const importantModels = [
        'gemini-3.8-flash-high',
        'gemini-3.8-flash-medium',
        'gemini-3.8-flash-low',
        'gemini-3.7-flash-high',
        'gemini-3.7-flash-medium',
        'gemini-3.7-flash-low',
        'gemini-3.6-flash-high',
        'gemini-3.6-flash-medium',
        'gemini-3.6-flash-low',
        'gemini-3.5-flash-low',
        'gemini-3.5-flash-extra-low',
        'gemini-pro-agent',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
        'gemini-3.1-flash-image',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        if (!info.quotaInfo) {
          continue;
        }

        if (info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = remainingFraction * 100;

        const total = 1000;
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
        };
      }
    }

    try {
      const weeklyQuotas = await fetchAntigravityWeeklyQuota(
        accessToken,
        projectId,
        proxyOptions
      );

      const entries = Object.entries(quotas);
      const geminiModels = entries.filter(([k]) => k.startsWith("gemini-") && !k.includes("image"));
      const claudeModels = entries.filter(([k]) => k.startsWith("claude-"));

      if (weeklyQuotas.gemini_weekly && geminiModels.length > 0) {
        const allGeminiExhausted = geminiModels.every(([, q]) => (q.remainingPercentage ?? 0) === 0);
        if (allGeminiExhausted && weeklyQuotas.gemini_weekly.remainingPercentage > 0) {
          const maxResetAt = geminiModels.reduce((max, [, q]) =>
            !max || (q.resetAt && new Date(q.resetAt) > new Date(max)) ? q.resetAt : max, null
          );
          weeklyQuotas.gemini_weekly.used = weeklyQuotas.gemini_weekly.total;
          weeklyQuotas.gemini_weekly.remainingPercentage = 0;
          if (maxResetAt) {
            weeklyQuotas.gemini_weekly.resetAt = maxResetAt;
          }
        }
      }

      if (weeklyQuotas.claude_gpt_weekly && claudeModels.length > 0) {
        const allClaudeExhausted = claudeModels.every(([, q]) => (q.remainingPercentage ?? 0) === 0);
        if (allClaudeExhausted && weeklyQuotas.claude_gpt_weekly.remainingPercentage > 0) {
          const maxResetAt = claudeModels.reduce((max, [, q]) =>
            !max || (q.resetAt && new Date(q.resetAt) > new Date(max)) ? q.resetAt : max, null
          );
          weeklyQuotas.claude_gpt_weekly.used = weeklyQuotas.claude_gpt_weekly.total;
          weeklyQuotas.claude_gpt_weekly.remainingPercentage = 0;
          if (maxResetAt) {
            weeklyQuotas.claude_gpt_weekly.resetAt = maxResetAt;
          }
        }
      }

      Object.assign(quotas, weeklyQuotas);
    } catch {
    }

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}

async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
    }, 10000, proxyOptions);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  }
}
