export const dynamic = "force-dynamic";
export const revalidate = 0;

import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS, getModelKind } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases, getAllProviderStatuses, setProviderStatus } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveKimchiModels } from "open-sse/services/kimchiModels.js";
import { resolveQoderModels, routableQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels, resolveClineModels } from "open-sse/services/clinepassModels.js";
import { resolveGrokCliModels } from "open-sse/services/grokCliModels.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import { resolveZedModels } from "open-sse/shared/zedAuth.js";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { capabilitiesFromServiceKind, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

const LIVE_MODEL_RESOLVERS = {
  opencode: async () => {
    try {
      const res = await fetch("https://opencode.ai/zen/v1/models");
      if (!res.ok) return null;
      const json = await res.json();
      const raw = json.data ?? json.models ?? json;
      const filter = FILTERS["opencode-free"];
      const free = filter ? filter(Array.isArray(raw) ? raw : []) : [];
      return free.length ? { models: free } : null;
    } catch {
      return null;
    }
  },
  codex: async (conn) => {
    try {
      if (!conn?.accessToken) return null;
      const res = await fetch("https://chatgpt.com/backend-api/codex/models?client_version=0.154.0", {
        headers: {
          "Authorization": `Bearer ${conn.accessToken}`,
          "originator": "codex_cli_rs",
          "User-Agent": "codex_cli_rs/0.154.0",
        },
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (!Array.isArray(json.models) || !json.models.length) return null;
      return {
        models: json.models.map((m) => ({
          id: m.slug,
          name: m.display_name || m.slug,
        })),
      };
    } catch {
      return null;
    }
  },
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
      refreshToken: conn.refreshToken,
      email: conn.email,
      displayName: conn.displayName,
      providerSpecificData: conn.providerSpecificData || {}
    });
    const models = routableQoderModels(result);
    if (!models.length) return null;
    return { models: models.map((m) => ({ id: m.id, name: m.name })) };
  },
  github: async (conn) => {
    const result = await resolveCopilotModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, {
      log: console,
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  kimchi: async (conn) => {
    const result = await resolveKimchiModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cline: async (conn) => {
    const result = await resolveClineModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  "grok-cli": async (conn) => {
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const result = await resolveGrokCliModels({
      ...conn,
      connectionId: conn.id,
    }, {
      log: console,
      proxyOptions: {
        connectionProxyEnabled: proxy.connectionProxyEnabled === true,
        connectionProxyUrl: proxy.connectionProxyUrl || "",
        connectionNoProxy: proxy.connectionNoProxy || "",
        vercelRelayUrl: proxy.vercelRelayUrl || "",
        strictProxy: proxy.strictProxy === true,
      },
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  zed: async (conn) => {
    const result = await resolveZedModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models
        .filter((m) => !m.isDisabled)
        .map((m) => ({
          id: m.id,
          name: m.name,
          capabilities: m.supportsTools ? { tools: true } : undefined,
        })),
    };
  },
};

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

const INTERNAL_MODELS_FETCH_HEADER = "x-9r-internal-models-fetch";

const LLM_KIND = "llm";

const MODEL_TYPE_TO_KIND = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
  video: "video",
};

function modelKind(model) {
  const k = model?.kind || model?.type;
  if (!k) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[k] || LLM_KIND;
}

function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers: { ...headers, [INTERNAL_MODELS_FETCH_HEADER]: "1" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels
          .map((model) => model?.id || model?.name || model?.model)
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
      )
    );
  } catch {
    return [];
  }
}

function providerMatchesKinds(providerId, kindFilter) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.includes(kind);
}

export async function buildModelsList(kindFilter, options = {}) {
  const skipDynamicFetch = options.skipDynamicFetch === true;
  let connections = [];
  try {
    connections = await getProviderConnections();
    connections = connections.filter(c => c.isActive !== false);
  } catch (e) {
    console.log("Could not fetch providers, returning all models");
  }

  let combos = [];
  try {
    combos = await getCombos();
  } catch (e) {
    console.log("Could not fetch combos");
  }

  let customModels = [];
  try {
    customModels = await getCustomModels();
  } catch (e) {
    console.log("Could not fetch custom models");
  }

  let modelAliases = {};
  try {
    modelAliases = await getModelAliases();
  } catch (e) {
    console.log("Could not fetch model aliases");
  }

  let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch (e) {
    console.log("Could not fetch disabled models");
  }
  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  let providerStatuses = {};
  try {
    providerStatuses = await getAllProviderStatuses();
  } catch (e) {
    console.log("Could not fetch provider statuses");
  }

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.noAuth && !activeConnectionByProvider.has(provider.id)) {
      if (providerStatuses[provider.id.toLowerCase()] === true) {
        activeConnectionByProvider.set(provider.id, {
          id: "noauth",
          provider: provider.id,
          isActive: true,
          providerSpecificData: {},
        });
      }
    }
  }

  const models = [];

  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry = {
      id: combo.name,
      object: "model",
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    }
    models.push(entry);
  }

  if (activeConnectionByProvider.size === 0) {
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] || alias;
      if (providerStatuses[providerId.toLowerCase()] !== true) continue;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      for (const model of providerModels) {
        if (!kindFilter.includes(modelKind(model))) continue;
        if (isDisabled(alias, model.id)) continue;
        models.push({
          id: `${alias}/${model.id}`,
          object: "model",
          owned_by: alias,
        });
      }
    }

    for (const customModel of customModels) {
      if (!customModel?.id || (customModel.type && customModel.type !== "llm")) continue;
      if (!kindFilter.includes(LLM_KIND)) continue;
      const providerAlias = customModel.providerAlias;
      if (!providerAlias) continue;
      if (providerStatuses[providerAlias.toLowerCase()] !== true) continue;

      const modelId = String(customModel.id).trim();
      if (!modelId) continue;

      models.push({
        id: `${providerAlias}/${modelId}`,
        object: "model",
        owned_by: providerAlias,
      });
    }
  } else {
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      if (providerStatuses[providerId.toLowerCase()] !== true) {
        providerStatuses[providerId.toLowerCase()] = true;
        setProviderStatus(providerId, true).catch(() => {});
      }
      if (!providerMatchesKinds(providerId, kindFilter)) continue;

      const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const outputAlias = (
        conn?.providerSpecificData?.prefix
        || getProviderAlias(providerId)
        || staticAlias
      ).trim();
      const providerModels = PROVIDER_MODELS[staticAlias] || [];
      const enabledModels = conn?.providerSpecificData?.enabledModels;
      const hasExplicitEnabledModels =
        Array.isArray(enabledModels) && enabledModels.length > 0;
      const isCompatibleProvider =
        isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      const staticModelKindById = new Map(
        providerModels.map((m) => [m.id, modelKind(m)])
      );
      let liveModelKindById = new Map();
      let liveCapabilitiesById = new Map();

      let rawModelIds = hasExplicitEnabledModels
        ? Array.from(
            new Set(
              enabledModels.filter(
                (modelId) => typeof modelId === "string" && modelId.trim() !== "",
              ),
            ),
          )
        : providerModels.map((model) => model.id);

      if (isCompatibleProvider && rawModelIds.length === 0 && !skipDynamicFetch) {
        rawModelIds = await fetchCompatibleModelIds(conn);
      }

      const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
      if (liveResolver && !hasExplicitEnabledModels) {
        try {
          const live = await liveResolver(conn);
          if (live?.models?.length) {
            rawModelIds = live.models.map((m) => m.id);
            liveModelKindById = new Map(
              live.models
                .filter((m) => m?.id)
                .map((m) => [m.id, modelKind(m)])
            );
            liveCapabilitiesById = new Map(
              live.models
                .filter((m) => m?.id && m.capabilities)
                .map((m) => [m.id, m.capabilities])
            );
          }
        } catch (err) {
          console.log(`Live model fetch failed for ${providerId}: ${err?.message || err}`);
        }
      }

      const modelIds = rawModelIds
        .map((modelId) => {
          if (modelId.startsWith(`${outputAlias}/`)) {
            return modelId.slice(outputAlias.length + 1);
          }
          if (modelId.startsWith(`${staticAlias}/`)) {
            return modelId.slice(staticAlias.length + 1);
          }
          if (modelId.startsWith(`${providerId}/`)) {
            return modelId.slice(providerId.length + 1);
          }
          return modelId;
        })
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

      const customModelKindById = new Map();
      const customModelIds = customModels
        .filter((m) => {
          if (!m?.id) return false;
          const kind = getModelKind(m) || LLM_KIND;
          if (!kindFilter.includes(kind) && !(kind === "imageToText" && kindFilter.includes(LLM_KIND))) return false;
          const alias = m.providerAlias;
          return alias === staticAlias || alias === outputAlias || alias === providerId;
        })
        .map((m) => {
          const modelId = String(m.id).trim();
          if (modelId) customModelKindById.set(modelId, getModelKind(m) || LLM_KIND);
          return modelId;
        })
        .filter((modelId) => modelId !== "");

      const aliasModelIds = Object.values(modelAliases || {})
        .filter((fullModel) => {
          if (typeof fullModel !== "string" || !fullModel.includes("/")) return false;
          return (
            fullModel.startsWith(`${outputAlias}/`) ||
            fullModel.startsWith(`${staticAlias}/`) ||
            fullModel.startsWith(`${providerId}/`)
          );
        })
        .map((fullModel) => {
          if (fullModel.startsWith(`${outputAlias}/`)) {
            return fullModel.slice(outputAlias.length + 1);
          }
          if (fullModel.startsWith(`${staticAlias}/`)) {
            return fullModel.slice(staticAlias.length + 1);
          }
          if (fullModel.startsWith(`${providerId}/`)) {
            return fullModel.slice(providerId.length + 1);
          }
          return fullModel;
        })
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

      const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));
      mergedModelIds.sort((a, b) => {
        const aFree = a.startsWith("cline-free/") || a.includes(":free") || a.endsWith("-free") || a === "kilo-auto/free" || a === "stepfun/step-5-preview-free";
        const bFree = b.startsWith("cline-free/") || b.includes(":free") || b.endsWith("-free") || b === "kilo-auto/free" || b === "stepfun/step-5-preview-free";
        if (aFree && !bFree) return -1;
        if (!aFree && bFree) return 1;
        return 0;
      });

      for (const modelId of mergedModelIds) {
        const customKind = customModelKindById.get(modelId);
        const liveKind = liveModelKindById.get(modelId);
        const kind = customKind || liveKind || staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        const allowAsLlm = kind === "imageToText" && kindFilter.includes(LLM_KIND);
        if (!kindFilter.includes(kind) && !allowAsLlm) continue;
        if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;

        const isFree = Boolean(
          modelId.startsWith("cline-free/") ||
          modelId.includes(":free") ||
          modelId.endsWith("-free") ||
          modelId === "big-pickle" ||
          modelId === "kilo-auto/free" ||
          modelId === "stepfun/step-5-preview-free" ||
          providerId === "antigravity"
        );

        const model = {
          id: `${outputAlias}/${modelId}`,
          object: "model",
          owned_by: outputAlias,
          ...(isFree ? { is_free: true } : {})
        };
        const caps = liveCapabilitiesById.get(modelId)
          || capabilitiesFromServiceKind(customKind || liveKind)
          || (kind === LLM_KIND ? getCapabilitiesForModel(providerId, modelId) : null);
        if (caps) model.capabilities = caps;
        if (kind === LLM_KIND || allowAsLlm) {
          let contextWindow = caps?.contextWindow;
          let maxOutput = caps?.maxOutput;
          if (!Number.isFinite(contextWindow) || !Number.isFinite(maxOutput)) {
            const fallback = getCapabilitiesForModel(providerId, modelId);
            if (!Number.isFinite(contextWindow)) contextWindow = fallback.contextWindow;
            if (!Number.isFinite(maxOutput)) maxOutput = fallback.maxOutput;
          }
          if (Number.isFinite(contextWindow)) model.context_length = contextWindow;
          if (Number.isFinite(maxOutput)) model.max_completion_tokens = maxOutput;
        }
        models.push(model);
      }

      const providerInfo = AI_PROVIDERS[providerId];
      if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
        models.push({
          id: `${outputAlias}/search`,
          object: "model",
          kind: "webSearch",
          owned_by: outputAlias,
        });
      }
      if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
        models.push({
          id: `${outputAlias}/fetch`,
          object: "model",
          kind: "webFetch",
          owned_by: outputAlias,
        });
      }
    }
  }

  const dedupedModels = [];
  const seenModelIds = new Set();
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    seenModelIds.add(model.id);
    dedupedModels.push(model);
  }

  return dedupedModels;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request) {
  try {
    const skipDynamicFetch = request?.headers?.get(INTERNAL_MODELS_FETCH_HEADER) === "1";
    const data = await buildModelsList([LLM_KIND], { skipDynamicFetch });
    return Response.json({ object: "list", data }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
