
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

export { getGlmUsage } from "./glm.js";


const VERCEL_AI_GATEWAY_CREDITS_URL = U("vercel-ai-gateway").url;

export async function getIflowUsage(accessToken) {
  try {
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

export async function getOllamaUsage(apiKey, providerSpecificData, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Ollama Cloud API key not available." };
  }

  try {
    const response = await proxyAwareFetch("https://ollama.com/api/usage", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Ollama Cloud API key invalid or expired." };
    }

    if (!response.ok) {
      return { message: `Ollama Cloud usage API error (${response.status}).` };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { message: "Ollama Cloud usage response was not JSON." };
    }

    const me = await proxyAwareFetch("https://ollama.com/api/me", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Length": "0",
      },
    }, proxyOptions).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    const planRaw = typeof me?.Plan === "string" ? me.Plan : "";
    const plan = planRaw
      ? planRaw.charAt(0).toUpperCase() + planRaw.slice(1).toLowerCase()
      : "Ollama Cloud";

    const limits = data?.limits && typeof data.limits === "object" ? data.limits : {};

    function ratioQuota(usageRatio, resetAt = null) {
      const ratio = Math.max(0, Math.min(1, Number(usageRatio) || 0));
      const usedPct = Math.round(ratio * 100);
      return { used: usedPct, total: 100, remainingPercentage: 100 - usedPct, resetAt, unlimited: false };
    }

    const sessionRaw = limits.session?.usage;
    const weeklyRaw = limits.weekly?.usage;
    const sessionNum = Number(sessionRaw);
    const weeklyNum = Number(weeklyRaw);
    const hasSession = sessionRaw !== undefined && sessionRaw !== null && !Number.isNaN(sessionNum);
    const hasWeekly = weeklyRaw !== undefined && weeklyRaw !== null && !Number.isNaN(weeklyNum);

    if (!hasSession && !hasWeekly) {
      return {
        plan,
        message: "Ollama Cloud connected. No usage limits reported.",
        quotas: {},
      };
    }

    const quotas = {};
    if (hasSession) quotas["Session (5h)"] = ratioQuota(sessionNum);
    if (hasWeekly) quotas["Weekly (7d)"] = ratioQuota(weeklyNum);

    return { plan, quotas };
  } catch (error) {
    return { message: `Ollama Cloud error: ${error.message}` };
  }
}



export async function getVercelAiGatewayUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Vercel AI Gateway API key not available." };
  }

  try {
    const response = await proxyAwareFetch(VERCEL_AI_GATEWAY_CREDITS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Vercel AI Gateway API key invalid or expired." };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText ? `: ${errorText.slice(0, 200)}` : "";
      return { message: `Vercel AI Gateway credits API error (${response.status})${trimmed}` };
    }

    const data = await response.json();

    const balance = Number(data?.balance) || 0;
    const totalUsed = Number(data?.total_used) || 0;

    const MONTHLY_CREDIT = 5;
    const remainingPercentage = (balance / MONTHLY_CREDIT) * 100;

    if (balance <= 0 && totalUsed <= 0) {
      return {
        plan: "Pay-as-you-go",
        message: "Vercel AI Gateway connected. No credit allocation found (BYOK or unfunded account).",
        quotas: {},
      };
    }

    return {
      plan: "Pay-as-you-go",
      quotas: {
        "Used (USD)": {
          used: totalUsed,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true,
        },
        "Remaining (USD)": {
          used: balance,
          total: MONTHLY_CREDIT,
          remaining: balance,
          remainingPercentage,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `Vercel AI Gateway error: ${error.message}` };
  }
}

export async function getQoderUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      U("qoder").url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
    const quotas = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt,
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt,
      },
    };
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}
