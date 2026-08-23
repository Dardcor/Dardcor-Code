/**
 * ZaiWebExecutor — Z.ai Web Chat (chat.z.ai, free web-session/cookie auth).
 *
 * Targets the consumer chat frontend at chat.z.ai (international Zhipu GLM
 * domain) — distinct from the API-key `glm`/`glm-cn` providers. Users without
 * an API key drive it for free via their browser session, modeled on the
 * `kimi-web` / `perplexity-web` cookie executors.
 *
 *   - Endpoint: POST https://chat.z.ai/api/v2/chat/completions
 *     (the older unversioned `/api/chat/completions` path 404s as of 2026-07).
 *   - Auth:     full Cookie header from chat.z.ai (must contain `token=<JWT>`).
 *               Sent BOTH as `Cookie` and as `Authorization: Bearer <token>` —
 *               the SPA's fetch client sets both and stripping either one 401s.
 *               A bare JWT is rejected: the upstream needs both headers.
 *   - Response: SSE. Frames are z.ai's internal envelope
 *               `{"type":"chat:completion","data":{"delta_content":"...","phase":"answer","done":false}}`
 *               or an already OpenAI-shaped `{choices:[{delta}]}` frame — the
 *               parser accepts both shapes defensively.
 *
 * Output is OpenAI-shaped (SSE chunks / chat.completion JSON), so the provider
 * stays `format: "openai"` and the executor returns `responseFormat: "openai"`.
 */
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

const BASE_URL = "https://chat.z.ai";
const CHAT_URL = `${BASE_URL}/api/v2/chat/completions`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// ─── Credential normalization ────────────────────────────────────────────────
/** Strip a leading "Cookie:" prefix (case-sensitive, per the header name). */
export function normalizeZaiCookie(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("Cookie:") ? trimmed.slice(7).trim() : trimmed;
}

/**
 * Extract the `token` cookie value (JWT) from a full Cookie header string.
 * Returns "" when the input is empty or has no `token=` entry. Deliberately
 * does NOT accept a bare JWT: the upstream needs the full cookie blob for the
 * `Cookie` header plus the extracted JWT for `Authorization: Bearer`.
 */
export function extractZaiToken(rawCookie) {
  const cookie = normalizeZaiCookie(rawCookie);
  if (!cookie) return "";
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? match[1].trim() : "";
}

// ─── Message folding (text-only, reject tools/images clearly) ────────────────
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error("Z.ai Web only supports text message content");
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new Error("Z.ai Web only supports text message content");
      }
      if (
        (part.type === "text" || part.type === "input_text") &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      if (part.type === "image_url" || part.type === "image" || part.type === "input_image") {
        throw new Error("Z.ai Web does not support image content");
      }
      throw new Error("Z.ai Web does not support image, audio, file, or tool content");
    })
    .join("");
}

/** Fold OpenAI history into z.ai's plain {role, content:string} messages shape. */
export function foldMessages(messages) {
  return messages.map((message) => {
    if (message.role === "tool" || message.role === "function") {
      throw new Error("Z.ai Web does not support tool result messages");
    }
    if (message.tool_calls !== undefined) {
      throw new Error("Z.ai Web does not support assistant tool calls");
    }
    if (!["user", "assistant", "system"].includes(message.role)) {
      throw new Error(`Z.ai Web does not support message role ${message.role}`);
    }
    return { role: message.role, content: textFromContent(message.content) };
  });
}

// ─── Z.ai SSE frame parsing ──────────────────────────────────────────────────
/** Parse an already OpenAI-shaped `{choices:[{delta}]}` pass-through frame. */
function parseOpenAiShapedFrame(choices) {
  const delta = choices[0]?.delta ?? {};
  const finishReason = choices[0]?.finish_reason;
  return {
    content: typeof delta.content === "string" ? delta.content : "",
    reasoning: typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
    done: finishReason != null,
  };
}

/** Parse the z.ai / chatglm internal `{data:{delta_content,phase,done}}` envelope. */
function parseInternalEnvelopeFrame(frame, data) {
  const phase = String(data.phase ?? "");
  const deltaContent = data.delta_content ?? data.edit_content ?? data.content;
  const done =
    data.done === true ||
    phase === "done" ||
    phase === "finish" ||
    String(frame.type ?? "") === "chat:completion:finish";

  if (typeof deltaContent === "string" && deltaContent) {
    const isThinking = phase === "thinking";
    return {
      content: isThinking ? "" : deltaContent,
      reasoning: isThinking ? deltaContent : "",
      done,
    };
  }
  if (done) return { content: "", reasoning: "", done: true };
  return null;
}

/**
 * Parse a single decoded z.ai SSE `data:` JSON payload into a normalized
 * delta, or null when the frame carries no usable content.
 */
export function parseZaiFrame(raw) {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw;

  if (Array.isArray(frame.choices) && frame.choices.length > 0) {
    return parseOpenAiShapedFrame(frame.choices);
  }

  const data = frame.data ?? frame;
  return parseInternalEnvelopeFrame(frame, data);
}

/** Split a chunk of decoded SSE text into complete `data:` payload strings. */
function extractSseDataPayloads(buffer, incoming) {
  buffer.text += incoming;
  const lines = buffer.text.split("\n");
  buffer.text = lines.pop() || "";
  const payloads = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    payloads.push(data);
  }
  return payloads;
}

/** Parse a raw SSE payload string into a normalized delta, or null if unusable. */
function parseSsePayload(data) {
  try {
    return parseZaiFrame(JSON.parse(data));
  } catch {
    return null;
  }
}

/**
 * Read the upstream SSE body to completion, invoking `onDelta` for every
 * parsed delta. Returns true when `onDelta` signalled the stream ended
 * (returned true), false when the body was exhausted without a done delta.
 */
async function drainSseDeltas(sourceBody, onDelta) {
  const decoder = new TextDecoder();
  const reader = sourceBody.getReader();
  const buffer = { text: "" };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      const payloads = extractSseDataPayloads(buffer, decoder.decode(value, { stream: true }));
      for (const raw of payloads) {
        const delta = parseSsePayload(raw);
        if (delta && onDelta(delta)) return true;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Output building ─────────────────────────────────────────────────────────
/** Emit role/reasoning/content/stop chunks for one delta. Returns true when the stream ended. */
function emitDeltaChunks(controller, delta, emitChunk, roleState) {
  if (!roleState.emitted && (delta.content || delta.reasoning)) {
    roleState.emitted = true;
    emitChunk(controller, { role: "assistant", content: "" });
  }
  if (delta.reasoning) emitChunk(controller, { reasoning_content: delta.reasoning });
  if (delta.content) emitChunk(controller, { content: delta.content });
  if (delta.done) {
    emitChunk(controller, {}, "stop");
    controller.enqueue(new TextEncoder().encode(SSE_DONE));
    controller.close();
    return true;
  }
  return false;
}

/** Drain the streaming response body into an OpenAI-shaped SSE ReadableStream. */
function buildStreamingBody(sourceBody, emitChunk, signal) {
  return new ReadableStream({
    async start(controller) {
      const roleState = { emitted: false };
      try {
        const ended = await drainSseDeltas(sourceBody, (delta) =>
          emitDeltaChunks(controller, delta, emitChunk, roleState)
        );
        if (ended) return; // emitDeltaChunks already sent [DONE] and closed
        if (!roleState.emitted) emitChunk(controller, { role: "assistant", content: "" });
        emitChunk(controller, {}, "stop");
        controller.enqueue(new TextEncoder().encode(SSE_DONE));
        controller.close();
      } catch (err) {
        if (!signal?.aborted) {
          try {
            controller.error(err);
          } catch {
            /* controller already closed */
          }
        }
      }
    },
  });
}

/** Drain the response body and aggregate all deltas into an answer/reasoning pair. */
async function collectNonStreaming(sourceBody) {
  let answer = "";
  let reasoning = "";
  try {
    await drainSseDeltas(sourceBody, (delta) => {
      if (delta.reasoning) reasoning += delta.reasoning;
      if (delta.content) answer += delta.content;
      return delta.done;
    });
  } catch {
    /* best-effort — return what we have */
  }
  return { answer, reasoning };
}

function zaiErrorResult(status, message, body) {
  return {
    response: new Response(
      JSON.stringify({ error: { message, type: "invalid_request" } }),
      { status, headers: { "Content-Type": "application/json" } }
    ),
    url: CHAT_URL,
    headers: {},
    transformedBody: body,
  };
}

export class ZaiWebExecutor extends BaseExecutor {
  constructor() {
    super("zai-web", { id: "zai-web", baseUrl: BASE_URL });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};

    // Credential is the FULL cookie blob (must contain token=). A bare JWT is
    // rejected — upstream needs both Cookie and Authorization headers.
    const rawCookie = normalizeZaiCookie(String(credentials?.apiKey ?? "").trim());
    const token = extractZaiToken(rawCookie);
    if (!rawCookie || !token) {
      return zaiErrorResult(
        400,
        "Missing Z.ai session — paste the full Cookie header from chat.z.ai (must contain token=<JWT>). The gateway needs both Cookie and Authorization: Bearer.",
        body
      );
    }

    const tools = bodyObj.tools;
    const functions = bodyObj.functions;
    if (tools != null && (!Array.isArray(tools) || tools.length > 0)) {
      return zaiErrorResult(400, "Z.ai Web does not support OpenAI function tools", body);
    }
    if (functions != null && (!Array.isArray(functions) || functions.length > 0)) {
      return zaiErrorResult(400, "Z.ai Web does not support legacy function tools", body);
    }

    let messages;
    try {
      messages = foldMessages(Array.isArray(bodyObj.messages) ? bodyObj.messages : []);
    } catch (err) {
      return zaiErrorResult(400, err instanceof Error ? err.message : "Invalid Z.ai Web request", body);
    }

    const modelId = String(model || bodyObj.model || "glm-4.6");
    const reqBody = {
      stream: true,
      model: modelId,
      messages,
      params: {},
      features: {
        image_generation: false,
        web_search: false,
        auto_web_search: false,
      },
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": USER_AGENT,
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      Cookie: rawCookie,
      Authorization: `Bearer ${token}`,
    };

    let response;
    try {
      response = await proxyAwareFetch(
        CHAT_URL,
        { method: "POST", headers, body: JSON.stringify(reqBody), signal },
        proxyOptions
      );
    } catch (err) {
      log?.error?.("ZAI-WEB", `Fetch failed: ${err.message || String(err)}`);
      return zaiErrorResult(502, `Z.ai connection failed: ${err.message || String(err)}`, body);
    }

    if (!response.ok) {
      const status = response.status;
      const errText = await response.text().catch(() => "");
      let msg = `Z.ai returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        msg = "Z.ai auth failed — the cookie may be expired. Re-paste the full Cookie header from chat.z.ai.";
      } else if (status === 429) {
        msg = "Z.ai rate limited. Wait a moment and retry.";
      }
      if (errText.trim()) msg += ` — ${errText.slice(0, 300)}`;
      log?.warn?.("ZAI-WEB", msg);
      return {
        response: new Response(
          JSON.stringify({ error: { message: msg, type: "upstream_error", code: `HTTP_${status}` } }),
          { status, headers: { "Content-Type": "application/json" } }
        ),
        url: CHAT_URL,
        headers,
        transformedBody: reqBody,
      };
    }

    const sourceBody = response.body || new ReadableStream({ start: (c) => c.close() });
    const id = `chatcmpl-zai-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const emitChunk = (controller, delta, finish = null) => {
      controller.enqueue(
        encoder.encode(
          sseChunk({
            id,
            object: "chat.completion.chunk",
            created,
            model: modelId,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })
        )
      );
    };

    if (stream) {
      const outStream = buildStreamingBody(sourceBody, emitChunk, signal);
      return {
        response: new Response(outStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: CHAT_URL,
        headers,
        transformedBody: reqBody,
        responseFormat: "openai",
      };
    }

    const { answer, reasoning } = await collectNonStreaming(sourceBody);
    const message = { role: "assistant", content: answer };
    if (reasoning) message.reasoning_content = reasoning;
    const completion = {
      id,
      object: "chat.completion",
      created,
      model: modelId,
      choices: [{ index: 0, message, finish_reason: "stop" }],
    };
    return {
      response: new Response(JSON.stringify(completion), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: CHAT_URL,
      headers,
      transformedBody: reqBody,
      responseFormat: "openai",
    };
  }
}

export default ZaiWebExecutor;
