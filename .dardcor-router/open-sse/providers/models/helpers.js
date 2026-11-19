import { FORMATS } from "../../translator/formats.js";

export const CODEX_REVIEW_SUFFIX = "-review";

export function withCodexReviewModels(models) {
  return models.flatMap((model) => {
    if ((model.kind || model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model];
    }
    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId || model.id,
        quotaFamily: "review"
      }
    ];
  });
}

export function isMuseSparkModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base);
}

export function isDeepSeekModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^deepseek-/i.test(base);
}

export function isOpencodeFreeTierModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /-free(?:$|:)/i.test(base) || base.toLowerCase() === "big-pickle";
}

const OPENCODE_FAMILIES = [
  { match: /^(grok|gpt|muse[-_]?spark)/i, supportedFormats: [FORMATS.OPENAI_RESPONSES], targetFormat: FORMATS.OPENAI_RESPONSES },
  { match: /^deepseek-v4(\.[0-9]+)?-(pro|flash)/, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES] },
  { match: /^(minimax|qwen)/, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE] },
  { match: /^claude-/i, supportedFormats: [FORMATS.CLAUDE] },
];

export function opencodeFamilyFormats(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  const base = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  return OPENCODE_FAMILIES.find((f) => f.match.test(base)) || null;
}
