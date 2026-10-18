
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../../config/grokCli.js";
import { decodeGrokCreditsFrame } from "./grokCliQuotaFrame.js";

const USAGE = U("grok-cli");
const BILLING_URL = USAGE.url || "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const USER_URL = USAGE.userUrl || "https://cli-chat-proxy.grok.com/v1/user?include=subscription";

const GRPC_CREDITS_URL =
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
const GRPC_WEB_EMPTY_REQUEST_FRAME = Buffer.from([0, 0, 0, 0, 0]);

function unwrapVal(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "val" in value) {
    return toFiniteNumber(value.val, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function buildGrokCliHeaders(accessToken, providerSpecificData = {}) {
  const psd = providerSpecificData || {};
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-mode": "headless",
  };
  const email = psd.email;
  const userId = psd.userId || psd.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

function subscriptionTier(user, config) {
  const rawTier =
    user?.subscriptionTier ??
    user?.subscription_tier ??
    user?.subscription?.tier ??
    config?.subscriptionTier ??
    config?.subscription_tier;
  return typeof rawTier === "string" ? rawTier.trim() : "";
}

function resolvePlan(user, config) {
  const tier = subscriptionTier(user, config);
  if (tier) {
    return tier
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (user?.hasGrokCodeAccess === true) return "Grok Code";
  if (config?.isUnifiedBillingUser === true) return "Grok Build";
  return "Grok Build";
}

function planFromAccessToken(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url"));
    return {
      0: "Free",
      1: "SuperGrok",
      2: "X Basic",
      3: "X Premium",
      4: "X Premium Plus",
      5: "SuperGrok Heavy",
      6: "SuperGrok Lite",
    }[payload.tier] || "";
  } catch {
    return "";
  }
}

function makeQuota({ used, total, resetAt, unlimited = false }) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  if (unlimited || safeTotal === 0) {
    return {
      used: safeUsed,
      total: 0,
      remainingPercentage: unlimited ? 100 : 0,
      resetAt: resetAt || null,
      unlimited: true,
    };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  const remainingPercentage = (remaining / safeTotal) * 100;
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

export function parseGrokCliBilling(billing, user = null) {
  const root = billing && typeof billing === "object" ? billing : {};
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : root;

  const periodEnd =
    parseResetTime(config.billingPeriodEnd) ||
    parseResetTime(config.billing_period_end) ||
    parseResetTime(config.currentPeriod?.end) ||
    parseResetTime(config.resetAt || config.resetsAt || config.periodEnd) ||
    parseResetTime(root.billingPeriodEnd) ||
    parseResetTime(root.billing_period_end) ||
    parseResetTime(root.resetAt || root.resetsAt || root.periodEnd) ||
    null;

  const quotas = {};
  const tier = subscriptionTier(user, config);
  const subscriptionAccess = Boolean(tier) && !/^(free|none|null)$/i.test(tier);

  const monthlyLimit = unwrapVal(
    config.monthlyLimit ?? config.monthly_limit ?? root.monthlyLimit ?? root.monthly_limit,
    NaN,
  );
  const includedUsed = unwrapVal(
    config.includedUsed ?? config.included_used ?? root.includedUsed ?? root.included_used,
    NaN,
  );
  const totalUsed = unwrapVal(
    config.totalUsed ?? config.total_used ?? root.totalUsed ?? root.total_used,
    NaN,
  );
  if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
    quotas["Monthly included"] = makeQuota({
      used: Number.isFinite(includedUsed)
        ? includedUsed
        : Number.isFinite(totalUsed)
          ? totalUsed
          : 0,
      total: monthlyLimit,
      resetAt: periodEnd,
    });
  }

  const onDemandCap = unwrapVal(config.onDemandCap ?? root.onDemandCap, NaN);
  const onDemandUsed = unwrapVal(config.onDemandUsed ?? root.onDemandUsed, NaN);
  if (Number.isFinite(onDemandCap) && onDemandCap > 0) {
    const used = Number.isFinite(onDemandUsed) ? Math.max(0, onDemandUsed) : 0;
    quotas["On-demand"] = makeQuota({
      used,
      total: onDemandCap,
      resetAt: periodEnd,
    });
  } else if (
    !subscriptionAccess &&
    Number.isFinite(onDemandCap) &&
    onDemandCap === 0 &&
    Number.isFinite(onDemandUsed)
  ) {
    quotas["On-demand"] = {
      used: 1,
      total: 1,
      remainingPercentage: 0,
      resetAt: periodEnd,
      unlimited: false,
    };
  }

  const prepaid = unwrapVal(config.prepaidBalance ?? root.prepaidBalance, NaN);
  if (Number.isFinite(prepaid) && prepaid > 0) {
    quotas["Prepaid"] = {
      used: 0,
      total: prepaid,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
    };
  }

  const usedPct = unwrapVal(
    config.creditUsagePercent ?? config.credit_usage_percent ?? root.creditUsagePercent,
    NaN,
  );
  if (Number.isFinite(usedPct) && usedPct >= 0) {
    quotas["Weekly SuperGrok"] = makeQuota({
      used: Math.max(0, Math.min(100, usedPct)),
      total: 100,
      resetAt: periodEnd,
    });
  }

  const creditBags = [
    root.credits,
    root.creditBalance,
    root.usage,
    config.credits,
    config.includedCredits,
    config.subscriptionCredits,
  ].filter((bag) => bag && typeof bag === "object" && !Array.isArray(bag));

  for (const bag of creditBags) {
    const total = unwrapVal(
      bag.total ?? bag.limit ?? bag.cap ?? bag.allocation ?? bag.amount,
      NaN,
    );
    const used = unwrapVal(bag.used ?? bag.spent ?? bag.consumed, NaN);
    const remaining = unwrapVal(bag.remaining ?? bag.balance ?? bag.left, NaN);
    if (Number.isFinite(total) && total > 0) {
      const resolvedUsed = Number.isFinite(used)
        ? used
        : Number.isFinite(remaining)
          ? Math.max(0, total - remaining)
          : 0;
      if (!quotas.Credits) {
        quotas.Credits = makeQuota({
          used: resolvedUsed,
          total,
          resetAt: parseResetTime(bag.resetAt || bag.resetsAt || bag.end) || periodEnd,
        });
      }
    } else if (Number.isFinite(remaining) && remaining >= 0 && !quotas.Credits) {
      quotas.Credits = {
        used: 0,
        total: remaining > 0 ? remaining : 1,
        remainingPercentage: remaining > 0 ? 100 : 0,
        resetAt: periodEnd,
        unlimited: false,
      };
    }
  }

  const exhausted =
    Object.keys(quotas).length > 0 &&
    Object.values(quotas).every(
      (q) => q.unlimited !== true && (q.remainingPercentage ?? 100) <= 0,
    );

  return {
    plan: resolvePlan(user, config),
    quotas,
    periodEnd,
    exhausted,
    subscriptionAccess,
    rawConfig: config,
  };
}

export async function fetchGrokCliCreditsConfig(accessToken, proxyOptions = null) {
  if (!accessToken) return null;
  try {
    const res = await proxyAwareFetch(
      GRPC_CREDITS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/grpc-web+proto",
          "X-Grpc-Web": "1",
          Accept: "application/grpc-web+proto",
        },
        body: GRPC_WEB_EMPTY_REQUEST_FRAME,
      },
      proxyOptions,
    );
    if (!res?.ok) return null;
    const arrayBuffer = await res.arrayBuffer().catch(() => null);
    if (!arrayBuffer) return null;
    return decodeGrokCreditsFrame(Buffer.from(arrayBuffer));
  } catch {
    return null;
  }
}

function quotasFromGrpcCredits(decoded) {
  if (!decoded || !Number.isFinite(decoded.percentUsed)) return null;
  const used = Math.round(Math.max(0, Math.min(100, decoded.percentUsed)));
  return {
    "Weekly SuperGrok": makeQuota({
      used,
      total: 100,
      resetAt: decoded.resetAt || null,
    }),
  };
}

export async function getGrokCliUsage(accessToken, providerSpecificData = null, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Grok CLI access token not available." };
  }

  const headers = buildGrokCliHeaders(accessToken, providerSpecificData);

  try {
    const [billingRes, userRes] = await Promise.all([
      proxyAwareFetch(
        BILLING_URL,
        { method: "GET", headers },
        proxyOptions,
      ),
      proxyAwareFetch(
        USER_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
    ]);

    if (billingRes.status === 401 || billingRes.status === 403) {
      return { message: "Grok CLI authentication expired. Please re-authorize." };
    }

    if (!billingRes.ok) {
      const errText = await billingRes.text().catch(() => "");
      const trimmed = errText ? `: ${errText.slice(0, 200)}` : "";
      return { message: `Grok CLI billing API error (${billingRes.status})${trimmed}` };
    }

    const billing = await billingRes.json().catch(() => null);
    if (!billing || typeof billing !== "object") {
      return { message: "Grok CLI billing response was not JSON." };
    }

    let user = null;
    if (userRes?.ok) {
      user = await userRes.json().catch(() => null);
    }

    const parsed = parseGrokCliBilling(billing, user);
    parsed.plan = planFromAccessToken(accessToken) || parsed.plan;

    if (!parsed.quotas || Object.keys(parsed.quotas).length === 0) {
      const grpc = await fetchGrokCliCreditsConfig(accessToken, proxyOptions);
      const grpcQuotas = quotasFromGrpcCredits(grpc);
      if (grpcQuotas) {
        return {
          plan: parsed.plan,
          quotas: grpcQuotas,
        };
      }
      return {
        plan: parsed.plan,
        message: parsed.subscriptionAccess
          ? "Subscription access is active; Grok does not expose a numeric included quota."
          : "Grok Build connected, but no credit allotment was returned. Free promo may be exhausted.",
        quotas: {},
      };
    }

    return {
      plan: parsed.plan,
      quotas: parsed.quotas,
    };
  } catch (error) {
    return { message: `Grok CLI usage error: ${error.message}` };
  }
}
