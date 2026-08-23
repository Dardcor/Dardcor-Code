import crypto from "node:crypto";

export const MCP_SCOPES = Object.freeze({
  PROVIDERS_READ: "mcp:providers:read",
  MODELS_READ: "mcp:models:read",
  CACHE_READ: "mcp:cache:read",
  QUOTA_READ: "mcp:quota:read",
  STATUS_READ: "mcp:status:read",
  MEMORY_READ: "mcp:memory:read",
});

const OBJECT_SCHEMA = { type: "object", additionalProperties: false, properties: {} };
const SECRET_FIELDS = new Set([
  "apiKey", "accessToken", "refreshToken", "idToken", "password", "token",
  "cookie", "cookies", "clientSecret", "authorization", "providerSpecificData",
]);

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_FIELDS.has(key))
    .map(([key, item]) => [key, sanitize(item)]));
}

function validate(schema, value, path = "arguments") {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    const properties = schema.properties || {};
    for (const key of schema.required || []) if (!(key in value)) return `${path}.${key} is required`;
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !(key in properties));
      if (unknown) return `${path}.${unknown} is not allowed`;
    }
    for (const [key, item] of Object.entries(value)) {
      if (!properties[key]) continue;
      const issue = validate(properties[key], item, `${path}.${key}`);
      if (issue) return issue;
    }
    return null;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (schema.minLength && value.trim().length < schema.minLength) return `${path} is too short`;
    if (schema.maxLength && value.length > schema.maxLength) return `${path} is too long`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} is invalid`;
  }
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) return `${path} must be an integer`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} is too small`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} is too large`;
  }
  return null;
}

const objectSchema = (properties = {}, required = []) => ({
  type: "object", additionalProperties: false, properties, required,
});
const string = (options = {}) => ({ type: "string", ...options });
const integer = (options = {}) => ({ type: "integer", ...options });
const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", LATEST_PROTOCOL_VERSION]);

export function createMiawToolRegistry(deps) {
  return [
    {
      name: "providers.list", description: "List configured providers without credentials.",
      scope: MCP_SCOPES.PROVIDERS_READ, inputSchema: OBJECT_SCHEMA,
      run: async () => ({ providers: sanitize(await deps.listProviders()) }),
    },
    {
      name: "models.list", description: "List available routed models.", scope: MCP_SCOPES.MODELS_READ,
      inputSchema: objectSchema({ provider: string({ minLength: 1, maxLength: 100 }) }),
      run: async ({ provider }) => ({ models: sanitize(await deps.listModels({ provider })) }),
    },
    {
      name: "cache.stats", description: "Read aggregate cache statistics.", scope: MCP_SCOPES.CACHE_READ,
      inputSchema: objectSchema({ period: string({ enum: ["today", "24h", "7d", "30d", "60d", "all"] }) }),
      run: async ({ period = "7d" }) => ({ stats: sanitize(await deps.getCacheStats({ period })) }),
    },
    {
      name: "quota.snapshot", description: "Fetch current quota for one connection without refreshing or writing credentials.", scope: MCP_SCOPES.QUOTA_READ,
      inputSchema: objectSchema({ connectionId: string({ minLength: 1, maxLength: 128 }) }, ["connectionId"]),
      run: async ({ connectionId }) => ({ snapshot: sanitize(await deps.getQuotaSnapshot({ connectionId })) }),
    },
    {
      name: "status.current", description: "Read current provider connection status.", scope: MCP_SCOPES.STATUS_READ,
      inputSchema: OBJECT_SCHEMA, run: async () => sanitize(await deps.getCurrentStatus()),
    },
    {
      name: "memory.search", description: "Search memories within an explicit user/session scope.", scope: MCP_SCOPES.MEMORY_READ,
      inputSchema: objectSchema({
        query: string({ minLength: 1, maxLength: 1000 }), userId: string({ minLength: 1, maxLength: 128 }),
        sessionId: string({ maxLength: 128 }), limit: integer({ minimum: 1, maximum: 100 }),
      }, ["query"]),
      run: async ({ query, userId = "default", sessionId = "", limit = 20 }) => ({
        memories: sanitize(await deps.searchMemories({ query, userId, sessionId, limit })),
      }),
    },
    {
      name: "memory.list", description: "List memories within an explicit user/session scope.", scope: MCP_SCOPES.MEMORY_READ,
      inputSchema: objectSchema({
        userId: string({ minLength: 1, maxLength: 128 }), sessionId: string({ maxLength: 128 }),
        limit: integer({ minimum: 1, maximum: 100 }), offset: integer({ minimum: 0, maximum: 100000 }),
      }),
      run: async ({ userId = "default", sessionId = "", limit = 50, offset = 0 }) => ({
        memories: sanitize(await deps.listMemories({ userId, sessionId, limit, offset })),
      }),
    },
  ];
}

const error = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

export function createMcpCore({ registry, timeoutMs = 10_000, audit = () => {} }) {
  const tools = new Map(registry.map((tool) => [tool.name, tool]));

  async function runWithTimeout(operation) {
    const guardedOperation = Promise.resolve(operation);
    // A timed-out operation cannot be cancelled; consume any later rejection.
    guardedOperation.catch(() => {});
    let timer;
    try {
      return await Promise.race([
        guardedOperation,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const timeout = new Error("Tool invocation timed out");
            timeout.code = "MCP_TIMEOUT";
            reject(timeout);
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function handle(request, auth = {}) {
    const id = request?.id;
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return error(id, -32600, "Invalid Request");
    const notification = !Object.prototype.hasOwnProperty.call(request, "id");
    const respond = (response) => notification ? null : response;
    if (!auth.authenticated) return respond(error(id, -32001, "Authentication required"));
    if (request.method === "initialize") return respond({
      jsonrpc: "2.0", id, result: {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(request.params?.protocolVersion)
          ? request.params.protocolVersion
          : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "miawrouter", version: "1.0.0" },
      },
    });
    if (request.method === "notifications/initialized") return null;
    if (request.method === "ping") return respond({ jsonrpc: "2.0", id, result: {} });
    if (request.method === "tools/list") return respond({
      jsonrpc: "2.0", id, result: { tools: registry
        .filter((tool) => Array.isArray(auth.scopes) && auth.scopes.includes(tool.scope))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
    });
    if (request.method !== "tools/call") return respond(error(id, -32601, "Method not found"));

    const tool = tools.get(request.params?.name);
    if (!tool) return respond(error(id, -32602, "Unknown tool"));
    if (!Array.isArray(auth.scopes) || !auth.scopes.includes(tool.scope)) return respond(error(id, -32003, "Tool scope denied"));
    const args = request.params?.arguments ?? {};
    const issue = validate(tool.inputSchema, args);
    if (issue) return respond(error(id, -32602, "Invalid tool arguments", { issue }));

    const started = Date.now();
    const invocationId = crypto.randomUUID();
    let outcome = "success";
    try {
      const result = await runWithTimeout(tool.run(args));
      const safe = sanitize(result);
      return respond({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(safe) }], structuredContent: safe } });
    } catch (cause) {
      outcome = cause?.code === "MCP_TIMEOUT" ? "timeout" : "error";
      return respond(error(id, outcome === "timeout" ? -32008 : -32603, outcome === "timeout" ? "Tool invocation timed out" : "Tool invocation failed"));
    } finally {
      audit({ invocationId, tool: tool.name, scope: tool.scope, actor: auth.actor || "unknown", outcome, durationMs: Date.now() - started });
    }
  }

  return { handle, tools: registry.map(({ name, scope }) => ({ name, scope })) };
}

export function createStdioTransport(core, { input, output, auth }) {
  let buffer = "";
  const onData = async (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = await core.handle(JSON.parse(line), auth); }
      catch { response = error(null, -32700, "Parse error"); }
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  };
  input.on("data", onData);
  return { close: () => input.off("data", onData) };
}
