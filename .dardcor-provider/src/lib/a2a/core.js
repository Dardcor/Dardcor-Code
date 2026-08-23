import crypto from "node:crypto";
import { recordA2ATask } from "./task-history.js";

export const A2A_SCOPE = "a2a:read";

const TERMINAL = new Set(["completed", "failed", "canceled"]);
const SECRET_FIELDS = /^(apiKey|accessToken|refreshToken|idToken|password|token|cookie|cookies|clientSecret|authorization|providerSpecificData)$/i;

function sanitize(value, depth = 0) {
  if (depth > 12) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_FIELDS.test(key))
    .slice(0, 1000)
    .map(([key, item]) => [key, sanitize(item, depth + 1)]));
}

const now = () => new Date().toISOString();
const rpcError = (id, code, message, data) => ({
  jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) },
});

function taskSnapshot(task) {
  return sanitize({
    id: task.id,
    contextId: task.contextId,
    status: { state: task.state, timestamp: task.updatedAt, ...(task.message ? { message: task.message } : {}) },
    ...(task.result !== undefined ? { artifacts: [{ artifactId: `${task.id}:result`, name: "result", parts: [{ kind: "data", data: task.result }] }] } : {}),
  });
}

export function createTaskManager({ maxTasks = 100, timeoutMs = 10_000, retentionMs = 5 * 60_000, audit = () => {}, recordTask = recordA2ATask } = {}) {
  const tasks = new Map();
  const listeners = new Map();

  function emit(task) {
    recordTask({
      id: task.id,
      name: task.name,
      skillId: task.skill,
      status: task.state,
      createdAt: task.createdAtMs,
      completedAt: TERMINAL.has(task.state) ? task.updatedAtMs : null,
      error: task.state === "failed" ? task.message : null,
    });
    const snapshot = taskSnapshot(task);
    for (const listener of listeners.get(task.id) || []) listener(snapshot);
  }

  function prune() {
    const cutoff = Date.now() - retentionMs;
    for (const [id, task] of tasks) if (TERMINAL.has(task.state) && task.updatedAtMs < cutoff) tasks.delete(id);
    while (tasks.size >= maxTasks) {
      const oldest = [...tasks.values()].find((task) => TERMINAL.has(task.state));
      if (!oldest) break;
      tasks.delete(oldest.id);
    }
  }

  function submit({ skill, name, args, actor, contextId }, operation) {
    prune();
    if (tasks.size >= maxTasks) return null;
    const id = crypto.randomUUID();
    const createdAtMs = Date.now();
    const task = { id, contextId: contextId || crypto.randomUUID(), skill, name: name || skill, state: "submitted", createdAtMs, updatedAt: now(), updatedAtMs: createdAtMs };
    tasks.set(id, task);
    emit(task);

    Promise.resolve().then(async () => {
      if (task.state === "canceled") return;
      task.state = "working";
      task.updatedAt = now(); task.updatedAtMs = Date.now(); emit(task);
      const started = Date.now();
      let timer;
      const work = Promise.resolve().then(() => operation(args));
      work.catch(() => {});
      try {
        const result = await Promise.race([
          work,
          new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "A2A_TIMEOUT" })), timeoutMs); }),
        ]);
        if (task.state !== "canceled") { task.state = "completed"; task.result = sanitize(result); }
      } catch (cause) {
        if (task.state !== "canceled") {
          task.state = "failed";
          task.message = cause?.code === "A2A_TIMEOUT" ? "Skill invocation timed out" : "Skill invocation failed";
        }
      } finally {
        clearTimeout(timer);
        task.updatedAt = now(); task.updatedAtMs = Date.now(); emit(task);
        audit({ taskId: task.id, skill, actor: actor || "unknown", outcome: task.state, durationMs: Date.now() - started });
      }
    });
    return taskSnapshot(task);
  }

  function get(id) { return tasks.has(id) ? taskSnapshot(tasks.get(id)) : null; }
  function cancel(id) {
    const task = tasks.get(id);
    if (!task || TERMINAL.has(task.state)) return task ? taskSnapshot(task) : null;
    task.state = "canceled"; task.message = "Canceled"; task.updatedAt = now(); task.updatedAtMs = Date.now(); emit(task);
    return taskSnapshot(task);
  }
  function subscribe(id, listener) {
    if (!tasks.has(id)) return () => {};
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(listener);
    listener(taskSnapshot(tasks.get(id)));
    return () => { listeners.get(id)?.delete(listener); if (!listeners.get(id)?.size) listeners.delete(id); };
  }

  return { submit, get, cancel, subscribe };
}

const emptySchema = { properties: {} };
const string = (options = {}) => ({ type: "string", ...options });
const object = (properties = {}, required = []) => ({ properties, required });

function validate(schema, value, path = "arguments") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
  for (const key of schema.required || []) if (!(key in value)) return `${path}.${key} is required`;
  const unknown = Object.keys(value).find((key) => !(key in schema.properties));
  if (unknown) return `${path}.${unknown} is not allowed`;
  for (const [key, item] of Object.entries(value)) {
    const rule = schema.properties[key];
    if (rule?.type === "string" && (typeof item !== "string" || item.length < (rule.minLength || 0) || item.length > (rule.maxLength || Infinity))) return `${path}.${key} is invalid`;
    if (rule?.enum && !rule.enum.includes(item)) return `${path}.${key} is invalid`;
  }
  return null;
}

export function createA2ASkillRegistry(deps) {
  return [
    { id: "providers.list", name: "Provider discovery", description: "List configured providers without credentials.", schema: emptySchema, run: () => deps.listProviders() },
    { id: "models.list", name: "Model discovery", description: "List routed models.", schema: object({ provider: string({ maxLength: 100 }) }), run: (args) => deps.listModels(args) },
    { id: "quota.snapshot", name: "Quota snapshot", description: "Read quota for a configured connection.", schema: object({ connectionId: string({ minLength: 1, maxLength: 128 }) }, ["connectionId"]), run: (args) => deps.getQuotaSnapshot(args) },
    { id: "status.current", name: "Provider status", description: "Read provider connection status.", schema: emptySchema, run: () => deps.getCurrentStatus() },
    { id: "health.current", name: "Router health", description: "Read local router health.", schema: emptySchema, run: () => deps.getHealth() },
    { id: "cost.summary", name: "Cost summary", description: "Read aggregate usage and cost data.", schema: object({ period: { type: "string", enum: ["today", "24h", "7d", "30d", "60d", "all"] } }), run: ({ period = "7d" }) => deps.getCostSummary({ period }) },
  ];
}

function invocationFromParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const dataPart = params.message?.parts?.find((part) => part?.kind === "data" && part.data && typeof part.data === "object");
  const source = dataPart?.data || params;
  return typeof source.skill === "string" ? { skill: source.skill, args: source.arguments ?? {}, contextId: params.contextId } : null;
}

export function createA2ACore({ registry, taskManager = createTaskManager(), audit = () => {} }) {
  const skills = new Map(registry.map((skill) => [skill.id, skill]));
  async function handle(request, auth = {}) {
    const id = request?.id;
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string" || Array.isArray(request)) return rpcError(id, -32600, "Invalid Request");
    const notification = !Object.prototype.hasOwnProperty.call(request, "id");
    const respond = (value) => notification ? null : value;
    if (!auth.authenticated || !auth.scopes?.includes(A2A_SCOPE)) return respond(rpcError(id, -32001, "Authentication required"));
    if (request.method === "skills/list") return respond({ jsonrpc: "2.0", id, result: { skills: registry.map(({ id: skillId, name, description, schema }) => ({ id: skillId, name, description, inputSchema: { type: "object", additionalProperties: false, ...schema } })) } });
    if (request.method === "tasks/get" || request.method === "tasks/cancel") {
      const taskId = request.params?.id;
      if (typeof taskId !== "string" || taskId.length > 128) return respond(rpcError(id, -32602, "Invalid task id"));
      const task = request.method === "tasks/get" ? taskManager.get(taskId) : taskManager.cancel(taskId);
      return respond(task ? { jsonrpc: "2.0", id, result: task } : rpcError(id, -32004, "Task not found"));
    }
    if (request.method !== "message/send" && request.method !== "message/stream") return respond(rpcError(id, -32601, "Method not found"));
    const invocation = invocationFromParams(request.params);
    const skill = invocation && skills.get(invocation.skill);
    if (!skill) return respond(rpcError(id, -32602, "Unknown or missing skill"));
    const issue = validate(skill.schema, invocation.args);
    if (issue) return respond(rpcError(id, -32602, "Invalid skill arguments", { issue }));
    const task = taskManager.submit({ skill: skill.id, name: skill.name, args: invocation.args, actor: auth.actor, contextId: invocation.contextId }, skill.run);
    if (!task) return respond(rpcError(id, -32009, "Task capacity reached"));
    audit({ action: "submitted", taskId: task.id, skill: skill.id, actor: auth.actor || "unknown" });
    return respond({ jsonrpc: "2.0", id, result: task });
  }
  return { handle, subscribe: taskManager.subscribe, skills: registry.map(({ id, name, description }) => ({ id, name, description })) };
}
