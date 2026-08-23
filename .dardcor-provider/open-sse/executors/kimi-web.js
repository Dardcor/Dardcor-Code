/**
 * KimiWebExecutor — Moonshot AI consumer chat via www.kimi.com (Connect-RPC).
 *
 * Routes text-only requests through Kimi's international consumer chat API
 * (www.kimi.com, which replaced the kimi.moonshot.cn surface):
 *
 *   - Endpoint:  POST /apiv2/kimi.gateway.chat.v1.ChatService/Chat
 *   - Protocol:  Connect-RPC (5-byte frame envelope + JSON payload)
 *   - Auth:      `Authorization: Bearer <access_token>`
 *   - Request:   Connect-framed ChatRequest JSON (protobuf field names)
 *   - Response:  Connect-framed event stream carrying deltas keyed by
 *                `mask: "block.text.content"` (answer) or
 *                `mask: "block.think.content"` (reasoning) via
 *                `op: "set"` (first chunk) and `op: "append"` (incremental).
 *
 * The SPA keeps `access_token` in localStorage. Only the extracted token is
 * forwarded as a Bearer token — browser cookies are never replayed. The
 * `x-msh-*` / `x-traffic-id` headers the SPA sends are not required.
 *
 * The executor converts the upstream Connect stream straight into
 * OpenAI-compatible output (SSE chunks or chat.completion JSON), so the
 * provider stays `format: "openai"` and returns `responseFormat: "openai"`.
 */
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

const CHAT_URL = PROVIDERS["kimi-web"].baseUrl;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const REASONING_EFFORT_PREFIX = "REASONING_EFFORT_";
const CONTEXT_LENGTH_PREFIX = "CONTEXT_LENGTH_";

// Curated-only catalog: k3 + k2d6 both ride the K2D5 route.
// ponytail: upstream OmniRoute ships an empty context-length list (context_length
// never sent). The task pins 128K for these models, so the enum is sent by default.
const MODEL_CONFIGS = {
  k3: {
    scenario: "SCENARIO_K2D5",
    supportedReasoningEfforts: ["REASONING_EFFORT_NONE", "REASONING_EFFORT_LOW"],
    defaultReasoningEffort: "REASONING_EFFORT_NONE",
    supportedContextLengths: ["CONTEXT_LENGTH_128K"],
    defaultContextLength: "CONTEXT_LENGTH_128K",
  },
  k2d6: {
    scenario: "SCENARIO_K2D5",
    supportedReasoningEfforts: ["REASONING_EFFORT_NONE", "REASONING_EFFORT_LOW"],
    defaultReasoningEffort: "REASONING_EFFORT_NONE",
    supportedContextLengths: ["CONTEXT_LENGTH_128K"],
    defaultContextLength: "CONTEXT_LENGTH_128K",
  },
};

/**
 * ponytail: cap a single Connect frame at 8 MiB. Kimi's largest legitimate
 * event is well under 1 KiB (a delta or stage transition); anything bigger
 * means the upstream is misbehaving or an attacker controls the response and
 * is trying to OOM the proxy by claiming a huge length. The non-streaming
 * accumulator would otherwise grow unbounded. Never remove; raise the ceiling
 * (with a regression test) only if a legitimate payload trips it.
 */
const MAX_FRAME_LEN = 8 * 1024 * 1024;

// ─── Credential normalization ────────────────────────────────────────────────
// Accept a bare opaque access_token, a leading "Authorization: Bearer …"
// label, a "Bearer …" prefix, or storage/cookie-style "access_token=…" /
// "kimi-auth=…" input. Returns "" when nothing Kimi-shaped is present.
export function extractKimiAccessToken(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";

  const bearer = raw.match(/^(?:authorization:\s*)?bearer\s+([^;\s]+)/i);
  if (bearer) return bearer[1];

  let trimmed = raw.replace(/^bearer\s+/i, "").replace(/^cookie:/i, "").trim();
  for (const key of ["access_token", "kimi-auth"]) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp(`(?:^|[\\s;])${escaped}=([^;\\s]+)`));
    if (match) return match[1];
  }

  return !trimmed.includes("=") && !trimmed.includes(";") ? trimmed : "";
}

// ─── Connect envelope framing ────────────────────────────────────────────────
/** Wrap a JSON message in the 5-byte Connect frame envelope (flags + big-endian length). */
export function frameConnectMessage(json) {
  const payload = new TextEncoder().encode(json);
  const framed = new Uint8Array(5 + payload.length);
  framed[0] = 0; // flags: 0 = uncompressed
  const len = payload.length;
  framed[1] = (len >>> 24) & 0xff;
  framed[2] = (len >>> 16) & 0xff;
  framed[3] = (len >>> 8) & 0xff;
  framed[4] = len & 0xff;
  framed.set(payload, 5);
  return framed;
}

/**
 * Decode one Connect frame from a stream buffer at byteOffset.
 *  - consumed 0  → need more bytes
 *  - consumed -1 → frame header claims a length above MAX_FRAME_LEN (fatal)
 *  - consumed N  → frame parsed
 */
export function decodeConnectFrame(buf, byteOffset) {
  if (byteOffset + 5 > buf.length) return { consumed: 0, frame: null };
  const flags = buf[byteOffset];
  const len =
    (buf[byteOffset + 1] << 24) |
    (buf[byteOffset + 2] << 16) |
    (buf[byteOffset + 3] << 8) |
    buf[byteOffset + 4];
  // Sign-extend the high bit back to positive when len was read as signed.
  const msgLen = len < 0 ? len + 0x100000000 : len;
  if (msgLen > MAX_FRAME_LEN) return { consumed: -1, frame: null };
  if (byteOffset + 5 + msgLen > buf.length) return { consumed: 0, frame: null };
  if ((flags & ~0x03) !== 0) {
    throw new Error(`Kimi Connect frame used unsupported flags: ${flags}`);
  }
  if ((flags & 0x01) !== 0) {
    throw new Error("Kimi Connect compressed frames are not supported");
  }

  let message = null;
  if (msgLen > 0) {
    const payload = buf.subarray(byteOffset + 5, byteOffset + 5 + msgLen);
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch (error) {
      throw new Error(
        `Kimi Connect frame contained invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`
      );
    }
  }
  return { consumed: 5 + msgLen, frame: { flags, message } };
}

/** Extract an EndStream error description, or null when the frame is not an error EndStream. */
export function getConnectEndStreamError(frame) {
  if ((frame.flags & 0x02) === 0) return null;
  const error = frame.message?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const code = typeof error.code === "string" ? error.code : "unknown";
  const message = typeof error.message === "string" ? error.message : "upstream error";
  return `${code}: ${message}`;
}

/**
 * Extract a content delta + kind from a Connect frame message.
 *   - `op: "set"`    on `block.text` / `block.think`     → first chunk
 *   - `op: "append"` on `block.text.content` / `block.think.content` → later chunks
 * Everything else (heartbeats, metadata, stage transitions) is suppressed.
 */
export function extractDelta(msg) {
  if (!msg) return null;
  const op = String(msg.op ?? "");
  const mask = String(msg.mask ?? "");
  const block = msg.block ?? {};

  if (op === "append") {
    if (mask === "block.text.content") {
      const text = String(block.text?.content ?? "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think.content") {
      const text = String(block.think?.content ?? "");
      return text ? { kind: "think", text } : null;
    }
    return null;
  }

  if (op === "set") {
    if (mask === "block.text") {
      const text = String(block.text?.content ?? "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think") {
      const text = String(block.think?.content ?? "");
      return text ? { kind: "think", text } : null;
    }
  }
  return null;
}

// ─── Message folding (multi-turn text → single prompt) ───────────────────────
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error("Kimi Web only supports text message content");
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new Error("Kimi Web only supports text message content");
      }
      if (
        (part.type === "text" || part.type === "input_text") &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      throw new Error("Kimi Web does not support image, audio, file, or tool content");
    })
    .join("");
}

/** Fold text-only OpenAI history into the single user turn accepted by Kimi Web. */
export function foldMessages(messages) {
  const systemParts = [];
  const conversationParts = [];

  for (const message of messages) {
    if (message.role === "tool" || message.role === "function") {
      throw new Error("Kimi Web does not support tool result messages");
    }
    if (message.tool_calls !== undefined) {
      throw new Error("Kimi Web does not support assistant tool calls");
    }

    const text = textFromContent(message.content);
    if (message.role === "system" || message.role === "developer") {
      if (text) systemParts.push(text);
    } else if (message.role === "user") {
      if (text) conversationParts.push(conversationParts.length > 0 ? `User: ${text}` : text);
    } else if (message.role === "assistant") {
      if (text) conversationParts.push(`Assistant: ${text}`);
    } else {
      throw new Error(`Kimi Web does not support message role ${message.role}`);
    }
  }

  return {
    prompt: conversationParts.join("\n\n").trim(),
    systemPrompt: systemParts.join("\n\n").trim(),
  };
}

// ─── Option resolvers (enum normalization + validation) ──────────────────────
function toNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveReasoningEffort(value, config) {
  const requested = toNonEmptyString(value);
  const normalized = requested
    ? requested.startsWith(REASONING_EFFORT_PREFIX)
      ? requested.toUpperCase()
      : `${REASONING_EFFORT_PREFIX}${requested.toUpperCase()}`
    : config.defaultReasoningEffort;

  if (!normalized) return undefined;
  if (!config.supportedReasoningEfforts.includes(normalized)) {
    throw new Error(`Kimi Web model does not support reasoning_effort=${requested || normalized}`);
  }
  return normalized;
}

function resolveContextLength(value, config) {
  const requested = toNonEmptyString(value);
  const normalized = requested
    ? requested.startsWith(CONTEXT_LENGTH_PREFIX)
      ? requested.toUpperCase()
      : `${CONTEXT_LENGTH_PREFIX}${requested.toUpperCase()}`
    : config.defaultContextLength;

  if (!normalized) return undefined;
  if (!config.supportedContextLengths.includes(normalized)) {
    throw new Error(`Kimi Web model does not support context_length=${requested || normalized}`);
  }
  return normalized;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function kimiErrorResult(status, message, body) {
  return {
    response: new Response(JSON.stringify({ error: { message, type: "invalid_request" } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    url: CHAT_URL,
    headers: {},
    transformedBody: body,
  };
}

function buildKimiHeaders(accessToken) {
  return {
    "Content-Type": "application/connect+json",
    Accept: "*/*",
    "User-Agent": USER_AGENT,
    Origin: "https://www.kimi.com",
    Referer: "https://www.kimi.com/",
    "connect-protocol-version": "1",
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Auth-only probe for the Add-provider "Check token" and saved-connection test
 * flows. Sends a Connect-framed request with an empty message so the upstream
 * rejects it at the protocol layer — no completion is generated. A valid
 * access_token yields a non-401/403 protocol error; an invalid one yields 401.
 * `fetchImpl` lets callers route through a connection proxy.
 */
export async function probeKimiWebToken(rawCredential, fetchImpl = fetch) {
  const accessToken = extractKimiAccessToken(String(rawCredential ?? "").trim());
  if (!accessToken) {
    return { status: 0, valid: false, error: "Missing Kimi access_token — capture access_token from www.kimi.com localStorage." };
  }
  const reqBody = JSON.stringify({
    chat_id: "",
    scenario: "SCENARIO_K2D5",
    tools: [],
    message: {
      id: "",
      parent_id: "",
      children_message_ids: [],
      role: "user",
      blocks: [],
      scenario: "SCENARIO_K2D5",
      labels: [],
      references: [],
      is_goal: false,
    },
    options: { thinking: true, enable_plugin: false },
    project_id: "",
  });

  let res;
  try {
    res = await fetchImpl(CHAT_URL, {
      method: "POST",
      headers: buildKimiHeaders(accessToken),
      body: frameConnectMessage(reqBody),
    });
  } catch (err) {
    return { status: 0, valid: false, error: `Kimi probe failed: ${err.message || String(err)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { status: res.status, valid: false, error: "Invalid access_token — re-capture from www.kimi.com localStorage." };
  }
  return { status: res.status, valid: true, error: null };
}

/** Read Connect frames off the upstream stream, re-chunking across TCP segments. */
async function* readConnectFrames(body, signal) {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer, 0);
      merged.set(value, buffer.length);
      buffer = merged;

      let offset = 0;
      while (offset < buffer.length) {
        const { consumed, frame } = decodeConnectFrame(buffer, offset);
        if (consumed === -1) throw new Error("Kimi Connect frame exceeded MAX_FRAME_LEN");
        if (consumed === 0) break; // need more bytes
        offset += consumed;
        if (!frame) continue;
        yield frame;
      }
      buffer = buffer.subarray(offset);
    }
  } finally {
    reader.releaseLock();
  }
}

function buildStreamingResponse(sourceStream, model, cid, created, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const emit = (delta, finish = null) => {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })));
      };
      let emittedRole = false;
      try {
        for await (const frame of readConnectFrames(sourceStream, signal)) {
          if ((frame.flags & 0x02) !== 0) {
            const endStreamError = getConnectEndStreamError(frame);
            if (endStreamError) throw new Error(`Kimi Connect EndStream error: ${endStreamError}`);
            if (!emittedRole) emit({ role: "assistant", content: "" });
            emit({}, "stop");
            controller.enqueue(encoder.encode(SSE_DONE));
            return;
          }
          if (!frame.message) continue;
          const delta = extractDelta(frame.message);
          if (!delta) continue;
          if (!emittedRole) {
            emittedRole = true;
            emit({ role: "assistant", content: "" });
          }
          emit(delta.kind === "think" ? { reasoning_content: delta.text } : { content: delta.text });
        }
        throw new Error("Kimi Connect stream ended without a successful EndStream frame");
      } catch (err) {
        try {
          if (signal?.aborted) controller.close();
          else controller.error(err);
        } catch { /* controller already closed */ }
        return;
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });
}

async function buildNonStreamingResponse(sourceStream, model, cid, created, signal, promptChars) {
  let answer = "";
  let reasoning = "";
  let sawEndStream = false;
  try {
    for await (const frame of readConnectFrames(sourceStream, signal)) {
      if ((frame.flags & 0x02) !== 0) {
        const endStreamError = getConnectEndStreamError(frame);
        if (endStreamError) throw new Error(`Kimi Connect EndStream error: ${endStreamError}`);
        sawEndStream = true;
        break;
      }
      if (!frame.message) continue;
      const delta = extractDelta(frame.message);
      if (!delta) continue;
      if (delta.kind === "think") reasoning += delta.text;
      else answer += delta.text;
    }
    if (!sawEndStream) {
      throw new Error("Kimi Connect stream ended without a successful EndStream frame");
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const message = { role: "assistant", content: answer };
  if (reasoning) message.reasoning_content = reasoning;

  // Prompt-side estimate comes from the folded request text (user + system),
  // not the answer — mirrors what was actually sent upstream.
  const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
  const completionTokens = Math.ceil(answer.length / 4);

  return {
    id: cid,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

export class KimiWebExecutor extends BaseExecutor {
  constructor() {
    super("kimi-web", PROVIDERS["kimi-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};

    const rawCredential = String(credentials?.accessToken || credentials?.apiKey || "").trim();
    const accessToken = extractKimiAccessToken(rawCredential);
    if (!accessToken) {
      return kimiErrorResult(
        400,
        "Missing Kimi access_token — log in at www.kimi.com and capture access_token from localStorage.",
        body
      );
    }

    const modelId = String(model || bodyObj.model || "");
    const config = MODEL_CONFIGS[modelId];
    if (!config) {
      return kimiErrorResult(400, `Unsupported Kimi Web model: ${modelId}`, body);
    }

    const tools = bodyObj.tools;
    const functions = bodyObj.functions;
    if (tools != null && (!Array.isArray(tools) || tools.length > 0)) {
      return kimiErrorResult(400, "Kimi Web does not support OpenAI function tools", body);
    }
    if (functions != null && (!Array.isArray(functions) || functions.length > 0)) {
      return kimiErrorResult(400, "Kimi Web does not support legacy function tools", body);
    }

    let folded;
    let reasoningEffort;
    let contextLength;
    try {
      const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
      folded = foldMessages(messages);
      if (!folded.prompt) throw new Error("Kimi Web requires a non-empty user message");
      reasoningEffort = resolveReasoningEffort(bodyObj.reasoning_effort, config);
      contextLength = resolveContextLength(bodyObj.context_length, config);
    } catch (error) {
      return kimiErrorResult(400, error instanceof Error ? error.message : "Invalid Kimi Web request", body);
    }

    const reqBody = JSON.stringify({
      chat_id: "",
      scenario: config.scenario,
      tools: [],
      message: {
        id: "",
        parent_id: "",
        children_message_ids: [],
        role: "user",
        blocks: [{ id: "", message_id: "", text: { content: folded.prompt } }],
        scenario: config.scenario,
        labels: [],
        references: [],
        is_goal: false,
      },
      options: {
        thinking: true,
        enable_plugin: false,
        ...(folded.systemPrompt ? { system_prompt: folded.systemPrompt } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(contextLength ? { context_length: contextLength } : {}),
      },
      project_id: "",
    });
    const headers = buildKimiHeaders(accessToken);

    // Connect framing wraps the JSON body in a 5-byte envelope. Without it the
    // upstream returns `invalid_argument` for every request.
    const framedBody = frameConnectMessage(reqBody);

    let response;
    try {
      response = await proxyAwareFetch(CHAT_URL, {
        method: "POST",
        headers,
        body: framedBody,
        signal,
      }, proxyOptions);
    } catch (err) {
      log?.error?.("KIMI-WEB", `Fetch failed: ${err.message || String(err)}`);
      return kimiErrorResult(502, `Kimi connection failed: ${err.message || String(err)}`, body);
    }

    if (!response.ok) {
      const status = response.status;
      const errText = await response.text().catch(() => "");
      let msg = `Kimi returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        msg = "Kimi auth failed — access_token may be expired. Re-capture access_token from www.kimi.com localStorage.";
      } else if (status === 429) {
        msg = "Kimi rate limited. Wait a moment and retry.";
      }
      if (errText.trim()) msg += ` — ${errText.slice(0, 300)}`;
      log?.warn?.("KIMI-WEB", msg);
      return {
        response: new Response(JSON.stringify({ error: { message: msg, type: "upstream_error", code: `HTTP_${status}` } }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
        url: CHAT_URL,
        headers,
        transformedBody: JSON.parse(reqBody),
      };
    }

    // The upstream is a Connect-framed stream regardless of client preference —
    // Kimi always streams. Non-streaming clients buffer the full response.
    const sourceStream = response.body || new ReadableStream({ start: (c) => c.close() });
    const cid = `chatcmpl-kimi-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const transformedBody = JSON.parse(reqBody);
    const promptChars = folded.prompt.length + (folded.systemPrompt ? folded.systemPrompt.length : 0);

    if (stream) {
      const outStream = buildStreamingResponse(sourceStream, modelId, cid, created, signal);
      return {
        response: new Response(outStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: CHAT_URL,
        headers,
        transformedBody,
        responseFormat: "openai",
      };
    }

    const completion = await buildNonStreamingResponse(sourceStream, modelId, cid, created, signal, promptChars);
    if (completion.error) {
      return kimiErrorResult(502, `Kimi Connect protocol error: ${completion.error}`, body);
    }
    return {
      response: new Response(JSON.stringify(completion), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: CHAT_URL,
      headers,
      transformedBody,
      responseFormat: "openai",
    };
  }
}

export default KimiWebExecutor;
