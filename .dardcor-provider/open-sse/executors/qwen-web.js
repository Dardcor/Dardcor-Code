/**
 * QwenWebExecutor — Alibaba Tongyi Qwen Chat via chat.qwen.ai (v2 API)
 *
 * Routes requests through Qwen's consumer chat API. The legacy v1 endpoint
 * (`/api/chat/completions`) was retired upstream and now answers 504 HTML from
 * Alibaba's gateway. The current contract is a two-step v2 flow:
 *
 *   1. POST /api/v2/chats/new                  → create a chat, returns chat_id
 *   2. POST /api/v2/chat/completions?chat_id=  → phase-based SSE stream
 *
 * The v2 endpoints sit behind Alibaba's "baxia" WAF, which requires the full
 * browser cookie jar from a real logged-in session (cna, ssxmod_itna,
 * ssxmod_itna2, token, ...). We therefore replay the captured/pasted Cookie
 * header verbatim plus the bearer token, mirroring how grok-web replays its
 * anti-bot cookies. A bare bearer token alone is rejected — an honest error is
 * returned instead of a confusing WAF page.
 *
 * SSE chunks carry `choices[0].delta` with a `phase` field: `think` /
 * `thinking_summary` map to reasoning, `answer` (or a null phase) carries the
 * assistant content. Output is OpenAI-compatible for both streaming and
 * non-streaming clients (`responseFormat: "openai"`), so chatCore skips
 * translation. Text chat only — tool and image requests are rejected clearly.
 *
 * Reference implementations: gpt4free `g4f/Provider/Qwen.py`,
 * Chat2API `proxy/adapters/qwen-ai.ts`.
 */
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { buildQwenCookieHeader, extractQwenToken } from "../services/webCookieAuth.js";

const BASE_URL = "https://chat.qwen.ai";
const CHATS_NEW_URL = `${BASE_URL}/api/v2/chats/new`;
const CHAT_COMPLETIONS_URL = `${BASE_URL}/api/v2/chat/completions`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Anti-bot headers the v2 endpoint expects. `bx-umidtoken` is normally minted
// per-session from sg-wum.alibaba.com; a captured value travels with the cookie
// jar, but we also send a static fallback so the header is always present.
const BX_VERSION = "2.5.36";
const BX_UMIDTOKEN_FALLBACK = "T2gA0000000000000000000000000000000000000000";

// Qwen SPA version — required by the v2 chat completion endpoint. Without this
// header the upstream returns HTTP 200 with `{"success":false,"data":{"code":"Bad_Request"}}`
// for every completion request, even with a valid session.
const QWEN_SPA_VERSION = "0.2.81";

const MODEL_ALIASES = {
  // Legacy OmniRoute ids → current upstream catalog (GET /api/models).
  "qwen-plus": "qwen3.7-plus",
  "qwen-max": "qwen3.7-max",
  "qwen-turbo": "qwen3.6-plus",
  "qwen3-plus": "qwen3.7-plus",
  "qwen3-max": "qwen3.7-max",
  "qwen3-flash": "qwen3.6-plus",
  // Note: `qwen3-coder-plus` is a real upstream model id (Qwen3-Coder) and
  // must NOT be aliased — the previous `"qwen3-coder-plus": "qwen3.7-max"`
  // entry silently rewrote valid coder requests to the wrong model.
  "qwen3-coder-flash": "qwen3.6-plus",
  qwen: "qwen3.7-max",
  qwen3: "qwen3.7-max",
};

const DEFAULT_MODEL = "qwen3.7-max";
const REQUIRED_THINKING_MODELS = new Set(["qwen3.8-max-preview"]);

const WAF_ERROR_MESSAGE =
  "Qwen session expired or blocked by Alibaba's WAF. Re-login at https://chat.qwen.ai and " +
  "paste a fresh full Cookie header (must include cna, ssxmod_itna and token) — a bearer token " +
  "alone is no longer accepted by the v2 endpoint.";

const COOKIE_JAR_ERROR_MESSAGE =
  "Qwen Web requires a full Cookie header from a logged-in chat.qwen.ai session — it must include " +
  "the cna, ssxmod_itna and token cookies. A bare bearer token alone is rejected by Qwen's WAF. " +
  "Log in at https://chat.qwen.ai, open DevTools → Network, and paste the full Cookie header as the API key.";

function mapModel(modelId) {
  return MODEL_ALIASES[modelId] || modelId;
}

function uuid() {
  return crypto.randomUUID();
}

/** True when the Cookie header carries a real `name=value` pair. */
function hasCookie(header, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?:^|;\\s*)" + escaped + "=").test(header);
}

/** Detect Alibaba's WAF / retired-v1 gateway page so we never surface raw HTML. */
function isWafResponse(status, contentType, bodyText) {
  if (contentType.includes("text/html")) return true;
  if (status === 504) return true;
  return /aliyun_waf|baxia|<html/i.test(bodyText);
}

function makeErrorResult(status, message, body, url = BASE_URL) {
  return {
    response: new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    url,
    headers: {},
    transformedBody: body,
  };
}

/** Flatten OpenAI-style content (string | Array<{type,text}>) into plain text,
 *  rejecting anything that is not text (images, audio, files). */
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error("Qwen Web only supports text message content");
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new Error("Qwen Web only supports text message content");
      }
      if ((part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
        return part.text;
      }
      throw new Error("Qwen Web does not support image, audio, file or tool content");
    })
    .join("\n");
}

/** Qwen Web is single-turn: fold the conversation into one user prompt.
 *  Tools and non-text content throw so the caller can reject them clearly. */
function foldMessages(messages) {
  let systemContent = "";
  let userContent = "";
  for (const message of messages) {
    if (message.role === "tool" || message.role === "function") {
      throw new Error("Qwen Web does not support tool messages");
    }
    if (message.tool_calls !== undefined) {
      throw new Error("Qwen Web does not support tool calls");
    }
    const text = textFromContent(message.content);
    if (message.role === "system" || message.role === "developer") {
      systemContent += (systemContent ? "\n\n" : "") + text;
    } else if (message.role === "user") {
      userContent = text;
    }
  }
  return systemContent ? `${systemContent}\n\nUser: ${userContent}` : userContent;
}

/** Parse one SSE line into a typed delta, or null if it carries no content. */
function parseSseDelta(line) {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const delta = parsed?.choices?.[0]?.delta;
  if (!delta) return null;
  const phase = delta.phase;
  const content = typeof delta.content === "string" ? delta.content : "";
  if (phase === "think" || phase === "thinking_summary") {
    return { kind: "think", text: content };
  }
  // `answer` phase or a null/absent phase both carry assistant content.
  if (phase === "answer" || phase === null || phase === undefined) {
    return { kind: "answer", text: content };
  }
  return null;
}

/** Transform the Qwen phase SSE into OpenAI chat.completion.chunk SSE. */
function buildStreamingResponse(upstreamBody, modelId, signal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-qwen-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const emit = (delta, finishReason = null) =>
    encoder.encode(sseChunk({
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }));

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody?.getReader();
      if (!reader) {
        controller.enqueue(encoder.encode(SSE_DONE));
        controller.close();
        return;
      }
      let buffer = "";
      controller.enqueue(emit({ role: "assistant", content: "" }));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const delta = parseSseDelta(line);
            if (!delta || !delta.text) continue;
            if (delta.kind === "answer") {
              controller.enqueue(emit({ content: delta.text }));
            } else if (delta.kind === "think") {
              controller.enqueue(emit({ reasoning_content: delta.text }));
            }
          }
        }
      } catch (err) {
        try {
          if (signal?.aborted) controller.close();
          else controller.error(err);
        } catch { /* controller already closed */ }
        return;
      }
      controller.enqueue(emit({}, "stop"));
      controller.enqueue(encoder.encode(SSE_DONE));
      try { controller.close(); } catch { /* already closed */ }
    },
  });
}

/** Read the whole upstream SSE stream, returning the joined answer + reasoning. */
async function buildNonStreamingResponse(upstreamBody) {
  const reader = upstreamBody?.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  if (!reader) return { content, reasoning };

  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const delta = parseSseDelta(line);
        if (!delta) continue;
        if (delta.kind === "answer") content += delta.text;
        else if (delta.kind === "think") reasoning += delta.text;
      }
    }
  } catch {
    /* upstream closed mid-stream — return what we have */
  }
  return { content, reasoning };
}

export class QwenWebExecutor extends BaseExecutor {
  constructor() {
    super("qwen-web", { id: "qwen-web", baseUrl: BASE_URL });
  }

  buildApiHeaders(token, cookieHeader, chatId) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": USER_AGENT,
      Origin: BASE_URL,
      Referer: chatId ? `${BASE_URL}/c/${chatId}` : `${BASE_URL}/`,
      source: "web",
      version: QWEN_SPA_VERSION,
      "x-request-id": uuid(),
      "bx-v": BX_VERSION,
      "bx-umidtoken": BX_UMIDTOKEN_FALLBACK,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    return headers;
  }

  buildMessagePayload(chatId, modelId, prompt, requestedModel) {
    const fid = uuid();
    const enableThinking =
      REQUIRED_THINKING_MODELS.has(modelId) || /think|reason|r1/i.test(requestedModel);
    return {
      stream: true,
      incremental_output: true,
      chat_id: chatId,
      chat_mode: "normal",
      model: modelId,
      parent_id: null,
      messages: [
        {
          fid,
          parentId: null,
          childrenIds: [],
          role: "user",
          content: prompt,
          user_action: "chat",
          files: [],
          timestamp: Math.floor(Date.now() / 1000),
          models: [modelId],
          chat_type: "t2t",
          feature_config: {
            thinking_enabled: enableThinking,
            output_schema: "phase",
            auto_thinking: enableThinking,
            research_mode: "normal",
            auto_search: false,
          },
          sub_chat_type: "t2t",
          parent_id: null,
        },
      ],
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];

    const tools = bodyObj.tools;
    const functions = bodyObj.functions;
    if (tools != null && (!Array.isArray(tools) || tools.length > 0)) {
      return makeErrorResult(400, "Qwen Web does not support OpenAI function tools", body);
    }
    if (functions != null && (!Array.isArray(functions) || functions.length > 0)) {
      return makeErrorResult(400, "Qwen Web does not support legacy function tools", body);
    }

    const rawCred = String(credentials?.apiKey ?? "").trim();
    const cookieHeader = buildQwenCookieHeader(rawCred);
    let token = extractQwenToken(rawCred);
    if (!token && credentials?.accessToken) token = String(credentials.accessToken).trim();

    // The v2 endpoint requires the full cookie jar (cna, ssxmod_itna, token).
    // A bare bearer token alone cannot satisfy the WAF — fail fast honestly.
    if (!cookieHeader || !hasCookie(cookieHeader, "cna") || !hasCookie(cookieHeader, "ssxmod_itna") || !token) {
      return makeErrorResult(400, COOKIE_JAR_ERROR_MESSAGE, body);
    }

    const requestedModel = String(model || bodyObj.model || DEFAULT_MODEL);
    const modelId = mapModel(requestedModel);

    let prompt;
    try {
      prompt = foldMessages(messages);
    } catch (err) {
      return makeErrorResult(400, err instanceof Error ? err.message : "Unsupported Qwen Web request", body);
    }
    if (!prompt.trim()) {
      return makeErrorResult(400, "Qwen Web requires a non-empty user message", body);
    }

    // ── Step 1: create a chat ────────────────────────────────────────────────
    let chatId;
    try {
      const newChatRes = await proxyAwareFetch(CHATS_NEW_URL, {
        method: "POST",
        headers: this.buildApiHeaders(token, cookieHeader),
        body: JSON.stringify({
          title: "New Chat",
          models: [modelId],
          chat_mode: "normal",
          chat_type: "t2t",
          timestamp: Date.now(),
        }),
        signal,
      }, proxyOptions);

      const ct = newChatRes.headers.get("content-type") || "";
      if (!newChatRes.ok || ct.includes("text/html")) {
        const text = await newChatRes.text().catch(() => "");
        if (isWafResponse(newChatRes.status, ct, text)) {
          return makeErrorResult(401, WAF_ERROR_MESSAGE, body, CHATS_NEW_URL);
        }
        return makeErrorResult(
          newChatRes.status || 502,
          `Qwen create-chat failed: ${text.slice(0, 300)}`,
          body,
          CHATS_NEW_URL
        );
      }

      const data = await newChatRes.json().catch(() => ({}));
      chatId = data?.data?.id ?? "";
      if (!chatId) {
        return makeErrorResult(502, "Qwen create-chat returned no chat id", body, CHATS_NEW_URL);
      }
    } catch (err) {
      log?.error?.("QWEN-WEB", `Create-chat failed: ${err.message || String(err)}`);
      return makeErrorResult(502, `Qwen create-chat error: ${err.message || "unknown"}`, body, CHATS_NEW_URL);
    }

    // ── Step 2: send the message ─────────────────────────────────────────────
    const completionUrl = `${CHAT_COMPLETIONS_URL}?chat_id=${chatId}`;
    const msgPayload = this.buildMessagePayload(chatId, modelId, prompt, requestedModel);

    let upstream;
    try {
      upstream = await proxyAwareFetch(completionUrl, {
        method: "POST",
        headers: this.buildApiHeaders(token, cookieHeader, chatId),
        body: JSON.stringify(msgPayload),
        signal,
      }, proxyOptions);
    } catch (err) {
      log?.error?.("QWEN-WEB", `Completion fetch failed: ${err.message || String(err)}`);
      return makeErrorResult(502, `Qwen completion fetch failed: ${err.message || "unknown"}`, body, completionUrl);
    }

    const ct = upstream.headers.get("content-type") || "";
    if (!upstream.ok || ct.includes("text/html")) {
      const errText = await upstream.text().catch(() => "");
      if (isWafResponse(upstream.status, ct, errText)) {
        return makeErrorResult(401, WAF_ERROR_MESSAGE, body, completionUrl);
      }
      return makeErrorResult(upstream.status || 502, `Qwen error: ${errText.slice(0, 300)}`, body, completionUrl);
    }

    const headers = this.buildApiHeaders(token, cookieHeader, chatId);
    if (stream) {
      const outStream = buildStreamingResponse(upstream.body, modelId, signal);
      return {
        response: new Response(outStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
        url: completionUrl,
        headers,
        transformedBody: msgPayload,
        responseFormat: "openai",
      };
    }

    const { content, reasoning } = await buildNonStreamingResponse(upstream.body);
    if (!content.trim() && !reasoning.trim()) {
      return makeErrorResult(
        502,
        "Qwen returned an empty response. Refresh your Qwen session/cookies and try again.",
        body,
        completionUrl
      );
    }
    const message = { role: "assistant", content };
    if (reasoning) message.reasoning_content = reasoning;
    const completion = {
      id: `chatcmpl-qwen-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, message, finish_reason: "stop" }],
    };
    return {
      response: new Response(JSON.stringify(completion), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: completionUrl,
      headers,
      transformedBody: msgPayload,
      responseFormat: "openai",
    };
  }
}

export default QwenWebExecutor;
