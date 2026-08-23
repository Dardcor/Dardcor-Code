import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getCacheStats } from "@/lib/db/index.js";
import { listMemories, searchMemories } from "@/lib/db/repos/memoryRepo.js";
import { getModelAliases, getProviderConnections } from "@/models";
import { getProviderConnectionById } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const PROVIDER_FIELDS = ["id", "provider", "name", "displayName", "email", "authType", "isActive", "testStatus", "priority", "defaultModel", "expiresAt", "updatedAt"];

function pick(object, fields) {
  return Object.fromEntries(fields.filter((field) => object?.[field] !== undefined).map((field) => [field, object[field]]));
}

async function listProviders() {
  return (await getProviderConnections()).map((connection) => pick(connection, PROVIDER_FIELDS));
}

async function listModels({ provider } = {}) {
  const [aliases, disabled] = await Promise.all([getModelAliases(), getDisabledModels()]);
  return AI_MODELS.filter((item) => {
    const alias = getProviderAlias(item.provider) || item.provider;
    return (!provider || item.provider === provider || alias === provider) && !(disabled[alias] || disabled[item.provider] || []).includes(item.model);
  }).map((item) => {
    const fullModel = `${item.provider}/${item.model}`;
    return { provider: item.provider, model: item.model, fullModel, alias: aliases[fullModel] || item.model };
  });
}

async function getQuotaSnapshot({ connectionId }) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) throw new Error("Connection not found");
  const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const usage = await getUsageForProvider(connection, { ...proxy, strictProxy: false });
  return { connectionId, ...usage };
}

async function getCurrentStatus() {
  const providers = await listProviders();
  const active = providers.filter((item) => item.isActive !== false);
  return {
    status: active.length ? "ready" : "degraded",
    checkedAt: new Date().toISOString(),
    providers: { total: providers.length, active: active.length },
    connections: providers.map((item) => pick(item, ["id", "provider", "name", "isActive", "testStatus", "expiresAt", "updatedAt"])),
  };
}

export const mcpDependencies = {
  listProviders,
  listModels,
  getCacheStats,
  getQuotaSnapshot,
  getCurrentStatus,
  searchMemories,
  listMemories,
};
