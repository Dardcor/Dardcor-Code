import REGISTRY from "../providers/registry/index.js";

// Alias→id derived from registry single-source: id→id, alias→id, aliases[]→id.
// Media-only providers without a registry transport entry keep explicit aliases here.
const MEDIA_ONLY_ALIASES = {
  el: "elevenlabs",
  jina: "jina-ai",
  "jina-ai": "jina-ai",
  polly: "aws-polly",
  "aws-polly": "aws-polly",
};

const ALIAS_TO_PROVIDER_ID = { ...MEDIA_ONLY_ALIASES };
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

const BUILTIN_MODEL_ALIASES = {
  "grok-build": "gcli/grok-build",
  "ox-alpha-free": "opencode/ox-alpha-free",
  "ox-alpha": "opencode/ox-alpha-free",
  "ox_alpha": "opencode/ox-alpha-free",
  "big-pickle": "opencode/big-pickle",
  "deepseek-v4-flash-free": "opencode/deepseek-v4-flash-free",
  "x-preview-f-free": "opencode/x-preview-f-free",
  "muse-spark-1.2-contributor-free": "opencode/muse-spark-1.2-contributor-free",
  "mimo-v2.5-free": "opencode/mimo-v2.5-free",
  "hy3-free": "opencode/hy3-free",
  "nemotron-3-ultra-free": "opencode/nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free": "opencode/nemotron-3.5-lightning-free",
  "laguna-s-2.1-free": "opencode/laguna-s-2.1-free",
  "north-mini-code-free": "opencode/north-mini-code-free",
};

/**
 * Resolve provider alias to provider ID
 */
export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

/**
 * Parse model string: "alias/model" or "provider/model" or just alias
 */
export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  // Strip leading router namespace prefixes like "dardcor-code/" or "dardcorcode/" or "9router/"
  const cleanStr = modelStr.replace(/^(dardcor-code|dardcorcode|9router)\//i, "");

  // Check if standard format: provider/model or alias/model
  if (cleanStr.includes("/")) {
    const firstSlash = cleanStr.indexOf("/");
    const providerOrAlias = cleanStr.slice(0, firstSlash);
    const model = cleanStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  // Alias format (model alias, not provider alias)
  return {
    provider: null,
    model: cleanStr,
    isAlias: true,
    providerAlias: null,
  };
}

/**
 * Resolve model alias from aliases object
 * Format: { "alias": "provider/model" }
 */
export function resolveModelAliasFromMap(alias, aliases) {
  if (!aliases) return null;

  // Check if alias exists
  const resolved = aliases[alias];
  if (!resolved) return null;

  // Resolved value is "provider/model" format
  if (typeof resolved === "string" && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(firstSlash + 1),
    };
  }

  // Or object { provider, model }
  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model,
    };
  }

  return null;
}

/**
 * Get full model info (parse or resolve)
 * @param {string} modelStr - Model string
 * @param {object|function} aliasesOrGetter - Aliases object or async function to get aliases
 */
export async function getModelInfoCore(modelStr, aliasesOrGetter) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  // Get aliases (from object or function)
  const aliases =
    typeof aliasesOrGetter === "function"
      ? await aliasesOrGetter()
      : aliasesOrGetter;

  // Resolve alias
  const resolved =
    resolveModelAliasFromMap(parsed.model, aliases) ||
    resolveModelAliasFromMap(parsed.model, BUILTIN_MODEL_ALIASES);
  if (resolved) {
    return resolved;
  }

  // Fallback: infer provider from model name prefix
  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
}

// Config-driven prefix → provider inference (first match wins, fallback "openai").
const MODEL_PREFIX_PROVIDERS = [
  [/-free$/, "opencode"],
  [/^big-pickle$/, "opencode"],
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "openrouter"],
];

/**
 * Infer provider from model name prefix
 * Used as fallback when no provider prefix or alias is given
 */
function inferProviderFromModelName(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}
