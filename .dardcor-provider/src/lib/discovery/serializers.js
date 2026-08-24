const FORBIDDEN_KEY = /token|secret|password|authorization|cookie|headers|payload|pathOnDisk/i;

function safeSchema(value, depth = 0) {
  if (depth > 12) return undefined;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeSchema(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !FORBIDDEN_KEY.test(key))
    .slice(0, 100)
    .map(([key, item]) => [key, safeSchema(item, depth + 1)])
    .filter(([, item]) => item !== undefined));
}

export function serializeSkill(skill = {}) {
  return {
    id: String(skill.id ?? skill.name ?? ""),
    name: String(skill.name ?? skill.id ?? ""),
    description: String(skill.description ?? ""),
    source: String(skill.source ?? "unknown"),
    scope: skill.scope == null ? null : String(skill.scope),
    inputSchema: safeSchema(skill.inputSchema ?? skill.schema ?? null),
    endpoint: skill.endpoint == null ? null : String(skill.endpoint),
    status: String(skill.status ?? "available"),
  };
}

function curlExample(endpoint) {
  const base = `$DARDCOR CODE_BASE_URL${endpoint.path}`;
  const method = endpoint.method === "GET" ? "" : ` -X ${endpoint.method}`;
  const apiKey = endpoint.auth === "public-api-key"
    ? ' -H "Authorization: Bearer $DARDCOR CODE_API_KEY"'
    : "";
  return `curl${method}${apiKey} "${base}"`;
}

export function serializeEndpoint(endpoint = {}) {
  return {
    id: String(endpoint.id ?? ""),
    method: String(endpoint.method ?? "GET"),
    path: String(endpoint.path ?? ""),
    category: String(endpoint.category ?? ""),
    auth: String(endpoint.auth ?? "dashboard"),
    capability: String(endpoint.capability ?? ""),
    status: String(endpoint.status ?? "available"),
    description: String(endpoint.description ?? ""),
    curl: curlExample(endpoint),
  };
}
