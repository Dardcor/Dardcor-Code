// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  // Check explicit model aliases configured in localDb
  const aliases = await getModelAliases();
  const resolvedAlias = resolveModelAliasFromMap(parsed.model, aliases);
  if (resolvedAlias) {
    return resolvedAlias;
  }

  // Smart Routing: Check active provider connections in SQLite
  try {
    const conns = await getProviderConnections();
    const activeProviderIds = new Set(
      conns.filter((c) => c.isActive !== false).map((c) => c.provider)
    );

    if (activeProviderIds.size > 0) {
      // 1. Check if any active provider explicitly advertises this model in registry
      for (const entry of REGISTRY) {
        if (activeProviderIds.has(entry.id)) {
          if (entry.models?.some((m) => m.id === parsed.model || m.name === parsed.model)) {
            return { provider: entry.id, model: parsed.model };
          }
        }
      }

      // 2. Check family matching and intelligent fallback for active providers
      const modelLower = parsed.model.toLowerCase();

      // Auto / generic / default routing when standard provider is not active
      if (["auto", "default", "chat", "gpt-4o", "gpt-4o-mini", "gpt-4"].includes(modelLower)) {
        if (!activeProviderIds.has("openai")) {
          if (activeProviderIds.has("antigravity")) {
            return { provider: "antigravity", model: "gemini-2.5-flash" };
          }
          if (activeProviderIds.has("claude") || activeProviderIds.has("anthropic")) {
            return { provider: activeProviderIds.has("claude") ? "claude" : "anthropic", model: "claude-3-5-sonnet-20241022" };
          }
          if (activeProviderIds.has("gemini")) {
            return { provider: "gemini", model: "gemini-2.5-flash" };
          }
          const firstProvider = Array.from(activeProviderIds)[0];
          return { provider: firstProvider, model: parsed.model };
        }
      }

      // Gemini family routing
      if (modelLower.startsWith("gemini-") || modelLower === "gemini") {
        if (activeProviderIds.has("antigravity") && !activeProviderIds.has("gemini") && !activeProviderIds.has("gemini-cli")) {
          if (modelLower.includes("3.7")) {
            return { provider: "antigravity", model: "gemini-3.7-flash-high" };
          }
          if (modelLower.includes("3.6")) {
            return { provider: "antigravity", model: "gemini-3.6-flash-high" };
          }
          if (modelLower.includes("3.5")) {
            return { provider: "antigravity", model: "gemini-3.5-flash-high" };
          }
          return { provider: "antigravity", model: "gemini-2.5-flash" };
        }
      }

      // Claude family routing
      if (modelLower.startsWith("claude-") || modelLower === "claude") {
        if (activeProviderIds.has("antigravity") && !activeProviderIds.has("anthropic") && !activeProviderIds.has("claude-oauth")) {
          if (modelLower.includes("opus")) {
            return { provider: "antigravity", model: "claude-opus-4-6-thinking" };
          }
          return { provider: "antigravity", model: "claude-sonnet-4-6" };
        }
      }

      if (modelLower.startsWith("gpt-oss-") && activeProviderIds.has("antigravity")) {
        return { provider: "antigravity", model: "gpt-oss-120b-medium" };
      }

      // If only 1 active provider in DB, fallback all unmatched models to it
      if (activeProviderIds.size === 1) {
        const onlyProvider = Array.from(activeProviderIds)[0];
        if (onlyProvider === "antigravity") {
          return { provider: "antigravity", model: "gemini-2.5-flash" };
        }
        return { provider: onlyProvider, model: parsed.model };
      }
    }
  } catch (err) {
    // ignore DB error and fallback to default
  }

  return getModelInfoCore(modelStr, aliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
