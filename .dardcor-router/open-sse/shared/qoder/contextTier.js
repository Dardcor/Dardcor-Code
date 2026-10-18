
import { QODER_CONTEXT_TIER_HEADROOM, QODER_CONTEXT_TIER_MODES } from "./constants.js";

const UNIT = { K: 1_000, M: 1_000_000 };

export function parseTierTokenCount(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (typeof value !== "string") return 0;
  const m = value.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*([KM])?$/);
  if (!m) return 0;
  const n = Number(m[1]) * (UNIT[m[2]] || 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function tierName(entry, tokenCount) {
  const raw = entry.name ?? entry.label ?? entry.display_name ?? entry.displayName ?? entry.key ?? entry.id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (tokenCount >= UNIT.M && tokenCount % UNIT.M === 0) return `${tokenCount / UNIT.M}M`;
  if (tokenCount >= UNIT.K && tokenCount % UNIT.K === 0) return `${tokenCount / UNIT.K}K`;
  return String(tokenCount);
}

export function getQoderContextTiers(modelConfig) {
  const list = modelConfig?.context_config ?? modelConfig?.contextConfig;
  if (!Array.isArray(list)) return [];
  const byCount = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const tokenCount = parseTierTokenCount(
      entry.tokenCount ?? entry.token_count ?? entry.max_input_tokens ?? entry.maxInputTokens ?? entry.contextLength ?? entry.context_length,
    );
    if (!tokenCount) continue;
    const isDefault = entry.isDefault === true || entry.is_default === true || entry.default === true;
    const prev = byCount.get(tokenCount);
    byCount.set(tokenCount, {
      name: tierName(entry, tokenCount),
      tokenCount,
      isDefault: (prev?.isDefault || false) || isDefault,
    });
  }
  return [...byCount.values()].sort((a, b) => a.tokenCount - b.tokenCount);
}

const CJK_RE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

export function estimateQoderPromptTokens({ system, messages, tools } = {}) {
  let text = "";
  try {
    text = JSON.stringify({ system: system || "", messages: messages || [], tools: tools || [] }) || "";
  } catch {
    return 0;
  }
  const cjk = (text.match(CJK_RE) || []).length;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

function normalizeMode(preference) {
  const p = String(preference ?? "").trim();
  return p ? p : QODER_CONTEXT_TIER_MODES.AUTO;
}

function findNamedTier(tiers, name) {
  const wanted = name.replace(/\s+/g, "").toUpperCase();
  const asCount = parseTierTokenCount(wanted);
  return tiers.find((t) => t.name.replace(/\s+/g, "").toUpperCase() === wanted || (asCount && t.tokenCount === asCount)) || null;
}

export function resolveQoderContextTier(modelConfig, prompt, options = {}) {
  const tiers = getQoderContextTiers(modelConfig);
  if (!tiers.length) return null;

  const mode = normalizeMode(options.preference);
  const largest = tiers[tiers.length - 1];
  const defaultTier = tiers.find((t) => t.isDefault) || tiers[0];
  const estimatedTokens = estimateQoderPromptTokens(prompt);
  const headroom = typeof options.headroom === "number" ? options.headroom : QODER_CONTEXT_TIER_HEADROOM;
  const need = Math.ceil(estimatedTokens * (1 + headroom));

  if (mode.toLowerCase() === QODER_CONTEXT_TIER_MODES.MAX) {
    return { tier: largest, estimatedTokens, reason: "forced:max" };
  }
  if (mode.toLowerCase() === QODER_CONTEXT_TIER_MODES.DEFAULT) {
    return { tier: defaultTier, estimatedTokens, reason: "forced:default" };
  }
  if (mode.toLowerCase() !== QODER_CONTEXT_TIER_MODES.AUTO) {
    const named = findNamedTier(tiers, mode);
    if (named) return { tier: named, estimatedTokens, reason: `forced:${named.name}` };
  }

  const currentMax = parseTierTokenCount(modelConfig?.max_input_tokens ?? modelConfig?.maxInputTokens);
  const currentLimit = currentMax || defaultTier.tokenCount;
  if (need <= currentLimit) return null;

  const fits = tiers.find((t) => t.tokenCount >= need && t.tokenCount > currentLimit);
  const tier = fits || largest;
  if (tier.tokenCount <= currentLimit) return null;
  return { tier, estimatedTokens, reason: fits ? "auto:fits" : "auto:largest" };
}

export function applyQoderContextTier(payload, tier) {
  if (!payload || !tier?.tokenCount) return payload;
  payload.parameters = { ...(payload.parameters || {}), context_length: tier.tokenCount };
  payload.chat_context = payload.chat_context || {};
  payload.chat_context.extra = {
    ...(payload.chat_context.extra || {}),
    ideModelConfigOverride: {
      ...(payload.chat_context.extra?.ideModelConfigOverride || {}),
      max_input_tokens: tier.tokenCount,
    },
  };
  if (payload.model_config && typeof payload.model_config === "object") {
    payload.model_config = { ...payload.model_config, max_input_tokens: tier.tokenCount };
  }
  return payload;
}
