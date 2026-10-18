import { BaseExecutor } from "./base.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { normalizeResponsesInput } from "../translator/formats/responsesApi.js";
import { fetchImageAsBase64 } from "../translator/concerns/image.js";
import { getModelUpstreamId, getProviderModels } from "../config/providerModels.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { DEFAULT_RETRY_CONFIG, HTTP_STATUS, resolveRetryEntry } from "../config/runtimeConfig.js";
import { dbg } from "../utils/debugLog.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { stripCodexUnsupportedPatterns } from "../utils/codexToolSchema.js";

const CODEX_SSE_RETRY_PATTERNS = ["server_is_overloaded", "service_unavailable_error"];
const CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS = ["selected model is at capacity", "model_at_capacity"];
const CODEX_SSE_USER_OUTPUT_PATTERNS = [
  "event: response.output_text.delta",
  "event: response.function_call_arguments.delta",
  '"type":"response.output_text.delta"',
  '"type":"response.function_call_arguments.delta"',
];
const CODEX_SSE_PEEK_BYTES = 256 * 1024;
const CODEX_MODEL_CAPACITY_MESSAGE = "Selected model is at capacity. Please try a different model.";
function isCodexResponsesLiteModel(model) {
  const baseId = String(model || "").replace(/\([^()]+\)\s*$/, "");
  return getProviderModels("cx").some((entry) => entry.id === baseId && entry.responsesLite === true);
}

const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

const CODEX_HOSTED_TOOL_TYPES = new Set([
  "image_generation", "web_search", "web_search_preview", "file_search",
  "computer", "computer_use_preview", "code_interpreter", "mcp", "local_shell",
  "tool_search"
]);

const CODEX_PASSTHROUGH_TOOL_TYPES = new Set(["custom"]);

const RESPONSES_API_ALLOWLIST = new Set([
  "model", "input", "instructions", "tools", "tool_choice", "stream", "store",
  "reasoning", "service_tier", "include", "prompt_cache_key", "client_metadata",
  "text", "parallel_tool_calls"
]);

function convertSystemToDeveloperRole(body) {
  if (!Array.isArray(body.input)) return;
  for (const item of body.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const isSystemMsg = item.role === "system" && (!item.type || item.type === "message");
    if (isSystemMsg) item.role = "developer";
  }
}

function stripStoredItemReferences(body, preserveLitePrefix = false) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (item.type === "item_reference") return false;
      if (typeof item.id === "string" && SERVER_ID_PATTERN.test(item.id)
        && !(preserveLitePrefix && item.role === "developer" && item.id.startsWith("msg_"))) delete item.id;
    }
    return true;
  });
}

function normalizeCodexTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  const patternStats = { removed: 0 };
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const type = typeof tool.type === "string" ? tool.type : "";
    if (type === "namespace") {
      if (Array.isArray(tool.tools)) {
        for (const st of tool.tools) {
          const n = typeof st?.name === "string" ? st.name.trim().slice(0, 128) : "";
          if (n) validNames.add(n);
          if (st?.parameters && typeof st.parameters === "object") {
            st.parameters = stripCodexUnsupportedPatterns(st.parameters, patternStats);
          }
        }
      }
      return true;
    }
    if (type !== "function") {
      if (CODEX_PASSTHROUGH_TOOL_TYPES.has(type)) return true;
      if (!type || tool.function || typeof tool.name === "string") return false;
      return CODEX_HOSTED_TOOL_TYPES.has(type);
    }
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    const parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, 128);
    if (description) tool.description = description;
    tool.parameters = stripCodexUnsupportedPatterns(parameters, patternStats);
    validNames.add(name);
    return true;
  });
  if (patternStats.removed > 0) {
    dbg("CODEX", `stripped ${patternStats.removed} unsupported tool schema pattern(s)`);
  }
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

function resolveCacheSessionId(body, credentials) {
  return resolveSessionId({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: "codex"
  });
}

function normalizeReasoningEffort(model, value) {
  const supportedLevels = getThinkingLevels("codex", model);
  if (supportedLevels?.includes(value)) return value;
  if (isCodexResponsesLiteModel(model) && (value === "none" || value === "minimal")) return "low";
  if (value === "ultra" && supportedLevels?.includes("max")) return "max";
  if (value === "max" || value === "ultra") return "xhigh";
  return value;
}

function findNestedMessage(value, depth = 0) {
  if (!value || depth > 6 || typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (typeof value.message === "string" && value.message.trim()) return value.message;
  if (typeof value.error?.message === "string" && value.error.message.trim()) return value.error.message;
  if (typeof value.response?.error?.message === "string" && value.response.error.message.trim()) return value.response.error.message;
  for (const child of Object.values(value)) {
    const found = findNestedMessage(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractSseErrorMessage(text, fallback) {
  const exact = text?.match(/Selected model is at capacity\. Please try a different model\./i)?.[0];
  if (exact) return exact;

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const message = findNestedMessage(JSON.parse(data));
      if (message) return message;
    } catch {
    }
  }

  return fallback || CODEX_MODEL_CAPACITY_MESSAGE;
}

function codexSseErrorResponse(status, message) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: status === HTTP_STATUS.SERVICE_UNAVAILABLE ? "service_unavailable" : "upstream_error",
    }
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class CodexExecutor extends BaseExecutor {
  constructor() {
    super("codex", PROVIDERS.codex);
    this._currentSessionId = null;
  }

  buildHeaders(credentials, stream = true, _url = null, model = null, body = null) {
    const headers = super.buildHeaders(credentials, stream);
    if (isCodexResponsesLiteModel(model && getModelUpstreamId("cx", model)) && !body?.tools?.some?.(tool => tool?.type === "web_search")) {
      headers["x-openai-internal-codex-responses-lite"] = "true";
    }
    headers["session_id"] = this._currentSessionId || credentials?.connectionId || "default";
    if (!headers["originator"]) headers["originator"] = "codex_cli_rs";
    const accountId =
      credentials?.providerSpecificData?.workspaceId ||
      credentials?.providerSpecificData?.chatgptAccountId ||
      credentials?.providerSpecificData?.accountId;
    if (typeof accountId === "string" && accountId && !headers["ChatGPT-Account-ID"]) {
      headers["ChatGPT-Account-ID"] = accountId;
    }
    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return this._isCompact ? `${base}/compact` : base;
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("codex", credentials, log);
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials("codex", credentials);
  }

  async prefetchImages(body) {
    if (!Array.isArray(body?.input)) return;
    for (const item of body.input) {
      if (!Array.isArray(item.content)) continue;
      const pending = item.content.map(async (c) => {
        if (c.type !== "image_url") return c;
        const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
        const detail = c.image_url?.detail || "auto";
        if (!url) return c;
        if (url.startsWith("data:")) return { type: "input_image", image_url: url, detail };
        const fetched = await fetchImageAsBase64(url, { timeoutMs: 15000 });
        return { type: "input_image", image_url: fetched?.url || url, detail };
      });
      item.content = await Promise.all(pending);
    }
  }

  async execute(args) {
    const imgCount = Array.isArray(args.body?.input) ? args.body.input.reduce((n, it) => n + (Array.isArray(it.content) ? it.content.filter(c => c.type === "image_url").length : 0), 0) : 0;
    const inputLen = Array.isArray(args.body?.input) ? args.body.input.length : 0;
    dbg("CODEX", `execute start | inputItems=${inputLen} | images=${imgCount} | sessionId=${this._currentSessionId || "pending"}`);
    if (imgCount > 0) {
      const t0 = Date.now();
      await this.prefetchImages(args.body);
      dbg("CODEX", `prefetchImages done | ${Date.now() - t0}ms`);
    } else {
      await this.prefetchImages(args.body);
    }

    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const { attempts, delayMs } = resolveRetryEntry(retryConfig[503]);
    let attempt = 0;
    while (true) {
      const result = await super.execute(args);
      const peek = await this._peekSseTransientError(result.response);
      if (!peek.matched) {
        if (peek.replacementBody) {
          result.response = new Response(peek.replacementBody, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          });
        }
        return result;
      }
      if (peek.accountFallback) {
        args.log?.warn?.("RETRY", `CODEX | SSE account fallback "${peek.message}"`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || CODEX_MODEL_CAPACITY_MESSAGE);
        return result;
      }
      if (attempt >= attempts) {
        args.log?.warn?.("RETRY", `CODEX | SSE overloaded "${peek.matched}" — retries exhausted (${attempt}/${attempts})`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || peek.matched);
        return result;
      }
      attempt++;
      args.log?.debug?.("RETRY", `CODEX | SSE "${peek.matched}" retry ${attempt}/${attempts} after ${delayMs / 1000}s`);
      dbg("CODEX", `SSE overloaded "${peek.matched}" → retry ${attempt}/${attempts} in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  async _peekSseTransientError(response) {
    if (!response || !response.ok || !response.body) return { matched: null, message: null, accountFallback: false, replacementBody: null };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let text = "";
    let matched = null;
    let accountFallback = false;
    try {
      while (text.length < CODEX_SSE_PEEK_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        text += decoder.decode(value, { stream: true });
        const lowerText = text.toLowerCase();
        const accountHit = CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS.find(p => lowerText.includes(p));
        if (accountHit) { matched = accountHit; accountFallback = true; break; }
        const retryHit = CODEX_SSE_RETRY_PATTERNS.find(p => lowerText.includes(p));
        if (retryHit) { matched = retryHit; break; }
        if (CODEX_SSE_USER_OUTPUT_PATTERNS.some(p => lowerText.includes(p))) break;
      }
    } catch (e) {
      dbg("CODEX", `peek read error: ${e.message}`);
    }

    if (matched) {
      try { await reader.cancel(); } catch { }
      try { reader.releaseLock(); } catch { }
      return { matched, message: extractSseErrorMessage(text, matched), accountFallback, replacementBody: null };
    }

    reader.releaseLock();

    const upstream = response.body;
    let upstreamReader = null;
    const replacementBody = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        upstreamReader = upstream.getReader();
      },
      async pull(controller) {
        try {
          const { done, value } = await upstreamReader.read();
          if (done) { controller.close(); return; }
          controller.enqueue(value);
        } catch (e) { controller.error(e); }
      },
      cancel(reason) {
        try { upstreamReader?.cancel(reason); } catch { }
      },
    });
    return { matched: null, message: null, accountFallback: false, replacementBody };
  }

  parseError(response, bodyText) {
    if (response.status === 429 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const err = json?.error;
        if (err?.type === "usage_limit_reached") {
          const now = Date.now();
          let resetsAtMs = null;
          if (typeof err.resets_at === "number" && err.resets_at > 0) {
            const ms = err.resets_at * 1000;
            if (ms > now) resetsAtMs = ms;
          }
          if (!resetsAtMs && typeof err.resets_in_seconds === "number" && err.resets_in_seconds > 0) {
            resetsAtMs = now + err.resets_in_seconds * 1000;
          }
          if (resetsAtMs) {
            return { status: 429, message: err.message || bodyText, resetsAtMs };
          }
        }
      } catch { }
    }
    return super.parseError(response, bodyText);
  }

  transformRequest(model, body, stream, credentials) {
    this._isCompact = !!body._compact;
    delete body._compact;
    this._currentSessionId = resolveCacheSessionId(body, credentials);
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;
    const upstreamModel = getModelUpstreamId("cx", body.model || model);
    const autoWebSearch = body._autoCodexWebSearch === true;
    delete body._autoCodexWebSearch;
    if (autoWebSearch && !body.tools?.some?.(tool => tool?.type === "web_search")) {
      body.tools = [...(Array.isArray(body.tools) ? body.tools : []), { type: "web_search" }];
    }
    let convertedLitePrefix = false;
    if (isCodexResponsesLiteModel(upstreamModel) && Array.isArray(body.input)
      && (body.tools?.some?.(tool => tool?.type === "web_search")
        || body.input.some(item => item?.type === "additional_tools" && item.tools?.some?.(tool => tool?.type === "web_search")))) {
      const tools = Array.isArray(body.tools) ? [...body.tools] : [];
      const seen = new Set(tools.map(tool => `${tool?.type}:${tool?.name || tool?.function?.name || ""}`));
      for (const item of body.input) {
        if (item?.type !== "additional_tools" || !Array.isArray(item.tools)) continue;
        for (const tool of item.tools) {
          const name = `${tool?.type}:${tool?.name || tool?.function?.name || ""}`;
          if (!seen.has(name)) { tools.push(tool); seen.add(name); }
        }
      }
      body.tools = tools;
      convertedLitePrefix = body.input.some(item => item?.type === "additional_tools");
      body.input = body.input.filter(item => item?.type !== "additional_tools");
    }
    const responsesLite = isCodexResponsesLiteModel(upstreamModel)
      && !body.tools?.some?.(tool => tool?.type === "web_search");

    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }

    convertSystemToDeveloperRole(body);
    stripStoredItemReferences(body, responsesLite);
    normalizeCodexTools(body);

    body.stream = true;

    if (!responsesLite && !convertedLitePrefix && (!body.instructions || body.instructions.trim() === "")) {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }

    body.store = false;

    if (!body.prompt_cache_key && this._currentSessionId) {
      body.prompt_cache_key = this._currentSessionId;
    }

    body.model = upstreamModel;

    if (responsesLite) {
      const input = Array.isArray(body.input) ? body.input : [body.input];
      const hasLitePrefix = input.some((item) => item?.type === "additional_tools");
      if (!hasLitePrefix) {
        const instructions = typeof body.instructions === "string" && body.instructions.trim()
          ? body.instructions : CODEX_DEFAULT_INSTRUCTIONS;
        const prefix = [{ type: "additional_tools", role: "developer", tools: Array.isArray(body.tools) ? body.tools : [] }];
        if (instructions) {
          prefix.push({ type: "message", role: "developer", content: [{ type: "input_text", text: instructions }] });
        }
        input.unshift(...prefix);
      }
      body.input = input;
      body.instructions = "";
      body.tools = null;
      body.tool_choice ||= "auto";
      body.parallel_tool_calls = false;
    } else {
      delete body.parallel_tool_calls;
    }

    const effortLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (body.model.endsWith(`-${level}`)) {
        modelEffort = level;
        body.model = body.model.replace(`-${level}`, '');
        break;
      }
    }

    if (!body.reasoning) {
      const effort = normalizeReasoningEffort(body.model, body.reasoning_effort || modelEffort || (responsesLite ? 'medium' : 'low'));
      body.reasoning = responsesLite ? { effort } : { effort, summary: "auto" };
    } else {
      body.reasoning.effort = normalizeReasoningEffort(body.model, body.reasoning.effort);
      if (!responsesLite && !body.reasoning.summary) body.reasoning.summary = "auto";
    }
    if (responsesLite) body.reasoning.context = "all_turns";
    delete body.reasoning_effort;

    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== 'none') {
      body.include = ["reasoning.encrypted_content"];
    }

    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;
    delete body.seed;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.max_output_tokens;
    delete body.user;
    delete body.prompt_cache_retention;
    delete body.metadata;
    delete body.stream_options;
    delete body.safety_identifier;
    delete body.previous_response_id;

    if (body.service_tier === "fast") body.service_tier = "priority";
    if (body.service_tier && body.service_tier !== "priority") delete body.service_tier;

    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    return body;
  }
}
