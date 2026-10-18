
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime } from "./shared.js";

const MINIMAX_USAGE_URLS = {
  minimax: U("minimax").urls,
  "minimax-cn": U("minimax-cn").urls,
};

function getMiniMaxField(model, snakeKey, camelKey) {
  if (!model || typeof model !== "object") return null;
  return model[snakeKey] ?? model[camelKey] ?? null;
}

function getMiniMaxModelName(model) {
  return String(getMiniMaxField(model, "model_name", "modelName") || "").trim();
}

function formatMiniMaxQuotaName(model) {
  const rawName = getMiniMaxModelName(model);
  if (!rawName) return "MiniMax";

  if (rawName === "MiniMax-M*" || rawName === "general") return "M-series";

  return rawName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bTo\b/g, "to")
    .replace(/\bTts\b/g, "TTS")
    .replace(/\bHd\b/g, "HD");
}

function getMiniMaxProvidedPercent(model, snakeKey, camelKey) {
  if (!model || typeof model !== "object") return null;
  const raw = model[snakeKey] ?? model[camelKey];
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function getMiniMaxSessionTotal(model) {
  return Math.max(0, Number(getMiniMaxField(model, "current_interval_total_count", "currentIntervalTotalCount")) || 0);
}

function getMiniMaxWeeklyTotal(model) {
  return Math.max(0, Number(getMiniMaxField(model, "current_weekly_total_count", "currentWeeklyTotalCount")) || 0);
}

function hasMiniMaxQuota(model) {
  if (getMiniMaxSessionTotal(model) > 0 || getMiniMaxWeeklyTotal(model) > 0) return true;
  if (getMiniMaxProvidedPercent(model, "current_interval_remaining_percent", "currentIntervalRemainingPercent") !== null) return true;
  if (getMiniMaxProvidedPercent(model, "current_weekly_remaining_percent", "currentWeeklyRemainingPercent") !== null) return true;
  return false;
}

function getMiniMaxResetAt(model, capturedAtMs, remainsSnake, remainsCamel, endSnake, endCamel) {
  const remainsMs = Number(getMiniMaxField(model, remainsSnake, remainsCamel)) || 0;
  if (remainsMs > 0) return new Date(capturedAtMs + remainsMs).toISOString();
  return parseResetTime(getMiniMaxField(model, endSnake, endCamel));
}

function buildMiniMaxQuota(total, count, resetAt, countMeansRemaining, providedPercent = null) {
  const safeTotal = Math.max(0, total);
  const used = countMeansRemaining ? Math.max(safeTotal - count, 0) : Math.min(Math.max(0, count), safeTotal);
  const remaining = Math.max(safeTotal - used, 0);
  const remainingPercentage = providedPercentage(providedPercent, remaining, safeTotal);
  return {
    used,
    total: safeTotal,
    remaining,
    remainingPercentage,
    resetAt,
    unlimited: false,
  };
}

function providedPercentage(provided, remaining, total) {
  if (provided !== null && provided !== undefined && Number.isFinite(provided)) {
    return Math.max(0, Math.min(100, provided));
  }
  return total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
}

function addMiniMaxQuota(quotas, key, model, getTotal, countSnake, countCamel, percentSnake, percentCamel, resetArgs, countMeansRemaining) {
  const total = getTotal(model);
  const providedPercent = getMiniMaxProvidedPercent(model, percentSnake, percentCamel);
  if (total <= 0 && providedPercent === null) return;

  const count = Math.max(0, Number(getMiniMaxField(model, countSnake, countCamel)) || 0);
  let effectiveTotal = total;
  let effectiveCount = count;
  if (total <= 0) {
    effectiveTotal = 100;
    const pct = providedPercent;
    effectiveCount = countMeansRemaining
      ? Math.round(effectiveTotal * (pct / 100))
      : Math.round(effectiveTotal * (1 - pct / 100));
  }
  quotas[key] = buildMiniMaxQuota(
    effectiveTotal,
    effectiveCount,
    getMiniMaxResetAt(model, ...resetArgs),
    countMeansRemaining,
    providedPercent
  );
}

export async function getMiniMaxUsage(apiKey, provider, proxyOptions = null) {
  if (!apiKey) {
    return { message: "MiniMax API key not available." };
  }

  const usageUrls = MINIMAX_USAGE_URLS[provider] || [];
  let lastErrorMessage = "";

  for (let index = 0; index < usageUrls.length; index += 1) {
    const usageUrl = usageUrls[index];
    const canFallback = index < usageUrls.length - 1;

    try {
      const response = await proxyAwareFetch(usageUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }, proxyOptions);

      const rawText = await response.text();
      let payload = {};
      if (rawText) {
        try { payload = JSON.parse(rawText); } catch { payload = {}; }
      }

      const baseResp = (payload?.base_resp ?? payload?.baseResp) || {};
      const apiStatusCode = Number(baseResp.status_code ?? baseResp.statusCode) || 0;
      const apiStatusMessage = String(baseResp.status_msg ?? baseResp.statusMsg ?? "").trim();
      const combined = `${apiStatusMessage} ${rawText}`.trim();
      const authLike = /token plan|coding plan|invalid api key|invalid key|unauthorized|inactive/i;

      if (response.status === 401 || response.status === 403 || apiStatusCode === 1004 || authLike.test(combined)) {
        return { message: "MiniMax API key invalid or inactive. Use an active Token/Coding Plan key." };
      }

      if (!response.ok) {
        lastErrorMessage = `MiniMax usage endpoint error (${response.status})`;
        if ((response.status === 404 || response.status === 405 || response.status >= 500) && canFallback) continue;
        return { message: `MiniMax connected. ${lastErrorMessage}` };
      }

      if (apiStatusCode !== 0) {
        return { message: `MiniMax connected. ${apiStatusMessage || "Upstream quota API error"}` };
      }

      const modelRemains = payload?.model_remains ?? payload?.modelRemains;
      const allModels = Array.isArray(modelRemains) ? modelRemains : [];
      const quotaModels = allModels.filter(hasMiniMaxQuota);

      if (quotaModels.length === 0) {
        return { message: "MiniMax connected. No quota data was returned." };
      }

      const capturedAtMs = Date.now();
      const countMeansRemaining = usageUrl.includes("/coding_plan/remains");
      const quotas = {};

      for (const model of quotaModels) {
        const displayName = formatMiniMaxQuotaName(model);
        addMiniMaxQuota(
          quotas,
          `${displayName} (5h)`,
          model,
          getMiniMaxSessionTotal,
          "current_interval_usage_count",
          "currentIntervalUsageCount",
          "current_interval_remaining_percent",
          "currentIntervalRemainingPercent",
          [capturedAtMs, "remains_time", "remainsTime", "end_time", "endTime"],
          countMeansRemaining
        );

        addMiniMaxQuota(
          quotas,
          `${displayName} (7d)`,
          model,
          getMiniMaxWeeklyTotal,
          "current_weekly_usage_count",
          "currentWeeklyUsageCount",
          "current_weekly_remaining_percent",
          "currentWeeklyRemainingPercent",
          [capturedAtMs, "weekly_remains_time", "weeklyRemainsTime", "weekly_end_time", "weeklyEndTime"],
          countMeansRemaining
        );
      }

      if (Object.keys(quotas).length === 0) {
        return { message: "MiniMax connected. Unable to extract quota usage." };
      }

      return { quotas };
    } catch (error) {
      lastErrorMessage = error.message;
      if (!canFallback) break;
    }
  }

  return { message: lastErrorMessage ? `MiniMax connected. Unable to fetch usage: ${lastErrorMessage}` : "MiniMax connected. Unable to fetch usage." };
}
