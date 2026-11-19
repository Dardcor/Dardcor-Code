import REGISTRY from "../providers/registry/index.js";

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
  "gpt-5.6-luna": "duck/gpt-6-luna",
  "gpt-6-luna": "duck/gpt-6-luna",
  "cx/gpt-5.6-luna": "duck/gpt-6-luna",
  "duck/gpt-5.6-luna": "duck/gpt-6-luna",
  "cx/gpt-5.4-mini": "duck/gpt-5.4-mini",
  "gpt-5.4-mini": "duck/gpt-5.4-mini",
  "claude-haiku-4-5": "duck/claude-haiku-4-5",
  "cl/step-5-preview": "cl/cline-free/step-5-preview",
  "step-5-preview": "cl/cline-free/step-5-preview",
  "cl/mimo-v2.6-flash": "cl/cline-free/mimo-v2.6-flash",
  "cl/muse-spark-1.3": "cl/cline-free/muse-spark-1.3-contributor",
  "cl/solar-mini4": "cl/cline-free/solar-mini4",
  "kc/kilo-auto-free": "kc/kilo-auto/free",
  "kilo-auto/free": "kc/kilo-auto/free",
  "kc/free": "kc/kilo-auto/free",
};

export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  if (BUILTIN_MODEL_ALIASES[modelStr]) {
    const target = BUILTIN_MODEL_ALIASES[modelStr];
    const slash = target.indexOf("/");
    const p = target.slice(0, slash);
    const m = target.slice(slash + 1);
    return { provider: resolveProviderAlias(p), model: m, isAlias: true, providerAlias: p };
  }

  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

export function resolveModelAliasFromMap(alias, aliases) {
  if (!aliases) return null;

  const resolved = aliases[alias];
  if (!resolved) return null;

  if (typeof resolved === "string" && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(firstSlash + 1),
    };
  }

  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model,
    };
  }

  return null;
}

export async function getModelInfoCore(modelStr, aliasesOrGetter) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  const aliases =
    typeof aliasesOrGetter === "function"
      ? await aliasesOrGetter()
      : aliasesOrGetter;

  const resolved =
    resolveModelAliasFromMap(parsed.model, aliases) ||
    resolveModelAliasFromMap(parsed.model, BUILTIN_MODEL_ALIASES);
  if (resolved) {
    return resolved;
  }

  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
}

const MODEL_PREFIX_PROVIDERS = [
  [/^codex-auto-review$/, "codex"],
  [/^gpt-[56]\./, "codex"],
  [/^gpt-6-/, "codex"],
  [/^gpt-daybreak-/, "codex"],
  [/^gpt-reserve/, "codex"],
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/(-free$|^big-pickle$|^space-bunny)/, "opencode"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "openrouter"],
];

function inferProviderFromModelName(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  if (m.endsWith("-free") || m === "big-pickle" || m.startsWith("space-bunny")) return "opencode";
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}
