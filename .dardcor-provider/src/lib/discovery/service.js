import { createA2ASkillRegistry } from "@/lib/a2a/core";
import { a2aDependencies } from "@/lib/a2a/adapters";
import { createDardcorToolRegistry } from "@/lib/mcp/core";
import { mcpDependencies } from "@/lib/mcp/adapters";
import { agentRegistry } from "@/lib/agents/service";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { AI_MODELS } from "@/shared/constants/models";
import { SKILLS } from "@/shared/constants/skills";
import { API_ENDPOINT_CATALOG } from "./catalog.js";
import { serializeEndpoint, serializeSkill } from "./serializers.js";

const TYPES = new Set(["provider", "model", "agent", "skill", "endpoint"]);
const unavailable = (id) => ({ id, status: "unavailable", count: 0, error: "Source unavailable" });
const available = (id, count) => ({ id, status: "available", count });

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function valueOf(source) {
  return typeof source === "function" ? source() : source;
}

async function collect(id, operation) {
  try {
    const items = asArray(await operation());
    return { items, source: available(id, items.length) };
  } catch {
    return { items: [], source: unavailable(id) };
  }
}

function safeText(value) {
  return value == null ? "" : String(value);
}

function serializeProvider(provider, fallbackId) {
  const id = safeText(provider?.id ?? fallbackId);
  return {
    type: "provider",
    id,
    name: safeText(provider?.name ?? provider?.displayName ?? provider?.alias ?? id),
    description: safeText(provider?.description ?? provider?.notice?.text),
    source: "providers",
    status: provider?.disabled ? "unavailable" : safeText(provider?.status ?? "available"),
  };
}

function serializeModel(model) {
  const id = safeText(model?.id ?? model?.model);
  const provider = safeText(model?.provider ?? model?.providerId);
  return {
    type: "model",
    id: provider && !id.startsWith(`${provider}/`) ? `${provider}/${id}` : id,
    name: safeText(model?.name ?? id),
    description: safeText(model?.description),
    provider,
    source: "models",
    status: safeText(model?.status ?? "available"),
  };
}

function serializeAgent(agent) {
  return {
    type: "agent",
    id: safeText(agent?.id),
    name: safeText(agent?.name ?? agent?.id),
    description: safeText(agent?.description ?? agent?.kind),
    source: "agents",
    status: safeText(agent?.status?.state ?? agent?.status ?? "available"),
  };
}

export function createDiscoveryService(overrides = {}) {
  const dependencies = {
    a2aRegistry: () => createA2ASkillRegistry(a2aDependencies),
    mcpRegistry: () => createDardcorToolRegistry(mcpDependencies),
    skills: SKILLS,
    endpoints: API_ENDPOINT_CATALOG,
    providers: AI_PROVIDERS,
    models: AI_MODELS,
    agentRegistry,
    ...overrides,
  };

  async function listAgentSkills() {
    const [a2a, mcp, catalog] = await Promise.all([
      collect("a2a", async () => asArray(await valueOf(dependencies.a2aRegistry)).map((skill) => serializeSkill({
        ...skill, source: "a2a", scope: "a2a:read", inputSchema: skill.inputSchema ?? skill.schema,
        endpoint: "/api/a2a",
      }))),
      collect("mcp", async () => asArray(await valueOf(dependencies.mcpRegistry)).map((tool) => serializeSkill({
        id: tool.name, name: tool.name, description: tool.description, source: "mcp",
        scope: tool.scope, inputSchema: tool.inputSchema, endpoint: "/api/mcp", status: tool.status,
      }))),
      collect("catalog-skills", async () => asArray(await valueOf(dependencies.skills)).map((skill) => serializeSkill({
        ...skill, source: "catalog", scope: "public-api-key",
      }))),
    ]);
    return { items: [...a2a.items, ...mcp.items, ...catalog.items], sources: [a2a.source, mcp.source, catalog.source] };
  }

  async function listApiEndpoints() {
    const catalog = await collect("endpoint-catalog", async () => asArray(await valueOf(dependencies.endpoints)).map(serializeEndpoint));
    return { items: catalog.items, sources: [catalog.source] };
  }

  async function getDiscoverySnapshot({ query = "", types = [], statuses = [] } = {}) {
    const [skills, endpoints, providers, models, agents] = await Promise.all([
      listAgentSkills(),
      listApiEndpoints(),
      collect("providers", async () => {
        const source = await valueOf(dependencies.providers);
        return Array.isArray(source)
          ? source.map((provider) => serializeProvider(provider))
          : Object.entries(source || {}).map(([id, provider]) => serializeProvider(provider, id));
      }),
      collect("models", async () => asArray(await valueOf(dependencies.models)).map(serializeModel)),
      collect("agents", async () => {
        const registry = await valueOf(dependencies.agentRegistry);
        return asArray(await registry.list()).map(serializeAgent);
      }),
    ]);

    const allItems = [
      ...providers.items,
      ...models.items,
      ...agents.items,
      ...skills.items.map((item) => ({ type: "skill", ...item })),
      ...endpoints.items.map((item) => ({ type: "endpoint", name: item.capability, ...item })),
    ];
    const normalizedTypes = new Set(asArray(types).map((item) => safeText(item).toLowerCase()).filter((item) => TYPES.has(item)));
    const normalizedStatuses = new Set(asArray(statuses).map((item) => safeText(item).toLowerCase()).filter(Boolean).slice(0, 20));
    const needle = safeText(query).slice(0, 100).trim().toLowerCase();
    const items = allItems.filter((item) => {
      if (normalizedTypes.size && !normalizedTypes.has(item.type)) return false;
      if (normalizedStatuses.size && !normalizedStatuses.has(safeText(item.status).toLowerCase())) return false;
      if (!needle) return true;
      return [item.id, item.name, item.description, item.path].some((value) => safeText(value).toLowerCase().includes(needle));
    });
    const byType = Object.fromEntries([...TYPES].map((type) => [type, items.filter((item) => item.type === type).length]));
    const byStatus = {};
    for (const item of items) byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    return {
      items,
      counts: { total: items.length, ...byType, byType, byStatus },
      sources: [...skills.sources, ...endpoints.sources, providers.source, models.source, agents.source],
    };
  }

  return { listAgentSkills, listApiEndpoints, getDiscoverySnapshot };
}

const discoveryService = createDiscoveryService();
export const listAgentSkills = discoveryService.listAgentSkills;
export const listApiEndpoints = discoveryService.listApiEndpoints;
export const getDiscoverySnapshot = discoveryService.getDiscoverySnapshot;
