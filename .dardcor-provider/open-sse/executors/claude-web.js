/**
 * ClaudeWebExecutor — claude.ai consumer web chat via the shared TLS transport.
 *
 * Routes OpenAI chat requests to Claude's web API (https://claude.ai/api).
 * The session cookie (`sessionKey`, bare value or full Cookie header) is
 * replayed through `webTlsFetch`, which presents a Chrome TLS fingerprint so
 * the `cf_clearance` cookie minted in the browser is accepted. The provider
 * is discovered from the `/organizations` endpoint, then each request creates
 * a fresh conversation and posts one turn to
 * `/organizations/<org>/chat_conversations/<conv>/completion`.
 *
 * Output is OpenAI-compatible for both streaming and non-streaming clients
 * (`responseFormat: "openai"`), so chatCore skips translation. Text-only:
 * tool and non-text (image/audio/file) content is rejected clearly.
 *
 * The TLS transport is optional; when `tls-client-node` is not installed
 * `webTlsFetch` rejects with `WebTlsClientUnavailableError`, which is
 * surfaced as a clear 503 instead of a confusing stack trace.
 *
 * Reference: OmniRoute `open-sse/executors/claude-web.ts` (+ payload/stream).
 */
import { randomUUID } from "node:crypto";

import { BaseExecutor } from "./base.js";
import { webTlsFetch, WebTlsClientUnavailableError } from "../services/webTlsClient.js";
import { normalizeSessionCookieHeader } from "../services/webCookieAuth.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

const API_BASE = "https://claude.ai/api";
const ORGS_URL = `${API_BASE}/organizations`;
const SESSION_COOKIE_NAME = "sessionKey";
const TLS_PROFILE = "chrome_146"; // matches the browser pool / cf_clearance fingerprint

// Exact reference fingerprint (OmniRoute claudeWebFingerprint.ts): Linux UA
// paired with the chrome_146 TLS profile so the browser's cf_clearance sticks.
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const SEC_CH_UA = '"Chromium";v="149", "Not-A.Brand";v="24", "Google Chrome";v="149"';
const SEC_CH_UA_PLATFORM = '"Linux"';

const DEFAULT_STYLE = {
  type: "default",
  key: "Default",
  name: "Normal",
  nameKey: "normal_style_name",
  prompt: "Normal\n",
  summary: "Default responses from Claude",
  summaryKey: "normal_style_summary",
  isDefault: true,
};

class ClaudeWebProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClaudeWebProtocolError";
  }
}

function makeBrowserHeaders() {
  return {
    Accept: "text/event-stream",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    Origin: "https://claude.ai",
    Pragma: "no-cache",
    Priority: "u=1, i",
    Referer: "https://claude.ai/new",
    "Sec-Ch-Ua": SEC_CH_UA,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": SEC_CH_UA_PLATFORM,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": USER_AGENT,
    "anthropic-client-platform": "web_claude_ai",
  };
}

function isChallenge(status, bodyText) {
  if (status !== 403) return false;
  const body = bodyText || "";
  return (
    /<title>\s*Just a moment/i.test(body) ||
    /<title>\s*Attention Required/i.test(body) ||
    /\b(?:cf-chl|challenge-platform)\b/i.test(body)
  );
}

function makeErrorResult(status, message, body, url = ORGS_URL) {
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

function makeTlsUnavailableResult(body) {
  return makeErrorResult(
    503,
    "Claude Web requires the optional tls-client-node dependency for its browser TLS " +
      "fingerprint, but it is not installed. Install tls-client-node and let its native " +
      "binary download (see ~/.miawrouter/tls-client), then retry.",
    body
  );
}

/** Normalize the sessionKey credential: bare JWT or full Cookie header. */
function readSessionCookie(credentials) {
  const raw = String(credentials?.apiKey ?? "").trim();
  return normalizeSessionCookieHeader(raw, SESSION_COOKIE_NAME);
}

/** Flatten OpenAI content to plain text; reject anything non-text (images, audio, files). */
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error("Claude Web only supports text message content");
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new Error("Claude Web only supports text message content");
      }
      if ((part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
        return part.text;
      }
      throw new Error("Claude Web does not support image, audio, file or tool content");
    })
    .join("\n");
}

/** Fold the transcript into a single prompt: system text + latest user message. */
function foldMessages(messages) {
  let systemContent = "";
  let userContent = "";
  for (const message of messages) {
    if (message.role === "tool" || message.role === "function") {
      throw new Error("Claude Web does not support tool messages");
    }
    if (message.tool_calls !== undefined) {
      throw new Error("Claude Web does not support tool calls");
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

function buildPayload({ model, prompt, timezone, locale, humanUuid, assistantUuid, isNew }) {
  return {
    prompt,
    model,
    timezone,
    personalized_styles: [DEFAULT_STYLE],
    locale,
    tools: [], // text-only: caller already rejected tool requests
    turn_message_uuids: {
      human_message_uuid: humanUuid,
      assistant_message_uuid: assistantUuid,
    },
    attachments: [],
    files: [],
    sync_sources: [],
    rendering_mode: "messages",
    thinking_mode: "off",
    effort: "low",
    ...(isNew
      ? {
          create_conversation_params: {
            name: "",
            model,
            include_conversation_preferences: true,
            paprika_mode: null,
            compass_mode: null,
            is_temporary: false,
            enabled_imagine: true,
            tool_search_mode: "auto",
          },
        }
      : {}),
  };
}

/** Resolve the authenticated organization id from /organizations. */
async function getOrganizationId(cookieHeader, signal, proxyOptions) {
  const result = await webTlsFetch(ORGS_URL, {
    method: "GET",
    headers: { ...makeBrowserHeaders(), Cookie: cookieHeader },
    profile: TLS_PROFILE,
    signal,
    proxyOptions,
  });
  if (result.status === 401) return { organizationId: null, failure: "authentication" };
  if (result.status === 403) {
    return isChallenge(result.status, result.text)
      ? { organizationId: null, failure: "challenge" }
      : { organizationId: null, failure: "authentication" };
  }
  if (result.status !== 200) return { organizationId: null, failure: "unavailable" };

  let parsed;
  try {
    parsed = JSON.parse(result.text || "[]");
  } catch {
    return { organizationId: null, failure: "unavailable" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { organizationId: null, failure: "unavailable" };
  }
  const organization = parsed[0];
  const identifier =
    organization && typeof organization === "object" ? (organization.uuid ?? organization.id) : null;
  return typeof identifier === "string" && identifier.trim()
    ? { organizationId: identifier.trim(), failure: null }
    : { organizationId: null, failure: "unavailable" };
}

// ─── Claude Web SSE → semantic events ──────────────────────────────────────

const METADATA_EVENTS = new Set([
  "ping",
  "completion",
  "message_limit",
  "content_block_retract",
  "model_fallback",
  "model_update",
  "compaction_status",
  "conversation_ready",
  "cache_performance",
  "tool_approval",
]);

function decodeSseFrames(text) {
  const frames = [];
  let dataLines = [];
  for (let rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      if (dataLines.length) {
        frames.push(dataLines.join("\n"));
        dataLines = [];
      }
      continue;
    }
    if (line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length) frames.push(dataLines.join("\n"));
  return frames;
}

function blockKind(block) {
  if (block?.type === "thinking") return "thinking";
  if (block?.type === "text") return "text";
  return "other";
}

/**
 * Parse the upstream SSE body into semantic output events. Throws
 * ClaudeWebProtocolError when the stream is malformed or ends before
 * message_stop. Metadata events (ping, message_limit, ...) are skipped.
 */
function parseClaudeWebStream(text) {
  const events = [];
  let phase = "awaiting_message";
  const openBlocks = new Map();
  let stopReason = "end_turn";

  for (const data of decodeSseFrames(text)) {
    if (data === "[DONE]") throw new ClaudeWebProtocolError("DONE arrived before message_stop");
    let event;
    let type;
    try {
      event = JSON.parse(data);
    } catch {
      throw new ClaudeWebProtocolError("SSE event contains malformed JSON");
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new ClaudeWebProtocolError("SSE event must be an object");
    }
    type = event.type;
    if (typeof type !== "string" || !type) {
      throw new ClaudeWebProtocolError("SSE event type is missing");
    }

    if (METADATA_EVENTS.has(type)) continue;

    switch (type) {
      case "message_start":
        if (phase !== "awaiting_message") throw new ClaudeWebProtocolError("message_start is out of order");
        phase = "in_message";
        break;
      case "content_block_start": {
        if (phase !== "in_message") throw new ClaudeWebProtocolError("content_block_start is out of order");
        if (!Number.isInteger(event.index) || event.index < 0) {
          throw new ClaudeWebProtocolError("Content block index is invalid");
        }
        if (openBlocks.has(event.index)) throw new ClaudeWebProtocolError("Content block was opened twice");
        openBlocks.set(event.index, blockKind(event.content_block));
        break;
      }
      case "content_block_delta": {
        if (phase !== "in_message") throw new ClaudeWebProtocolError("content_block_delta is out of order");
        const block = openBlocks.get(event.index);
        if (!block) throw new ClaudeWebProtocolError("Content delta has no open block");
        const delta = event.delta;
        if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
          throw new ClaudeWebProtocolError("Content delta is invalid");
        }
        if (delta.type === "text_delta" && block === "text" && typeof delta.text === "string") {
          events.push({ kind: "content", text: delta.text });
        } else if (delta.type === "thinking_delta" && block === "thinking") {
          const text = typeof delta.thinking === "string" ? delta.thinking : delta.text;
          if (typeof text === "string") events.push({ kind: "reasoning", text });
        } else {
          throw new ClaudeWebProtocolError("Content delta type does not match its block");
        }
        break;
      }
      case "content_block_stop":
        if (phase !== "in_message") throw new ClaudeWebProtocolError("content_block_stop is out of order");
        if (!openBlocks.delete(event.index)) {
          throw new ClaudeWebProtocolError("Content block stop has no open block");
        }
        break;
      case "message_delta": {
        if (phase !== "in_message" || openBlocks.size > 0) {
          throw new ClaudeWebProtocolError("message_delta is out of order");
        }
        const stop = event.delta?.stop_reason;
        if (stop !== null && stop !== undefined) {
          if (typeof stop !== "string" || !stop) {
            throw new ClaudeWebProtocolError("Stop reason is invalid");
          }
          stopReason = stop;
        }
        break;
      }
      case "message_stop":
        if (phase !== "in_message" || openBlocks.size > 0) {
          throw new ClaudeWebProtocolError("message_stop is out of order");
        }
        phase = "stopped";
        events.push({ kind: "finish", stopReason });
        break;
      case "error":
        throw new ClaudeWebProtocolError("Upstream reported a stream error");
      default:
        // Unknown event types (new upstream additions) are ignored so the
        // stream stays forward-compatible.
        break;
    }
  }

  if (phase !== "stopped") {
    throw new ClaudeWebProtocolError("Claude Web stream ended before message_stop");
  }
  return events;
}

function openAiFinishReason(stopReason) {
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "tool_use") return "tool_calls";
  return "stop";
}

function completionId() {
  return `chatcmpl-${randomUUID()}`;
}

export class ClaudeWebExecutor extends BaseExecutor {
  constructor() {
    super("claude-web", { id: "claude-web", baseUrl: ORGS_URL });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];

    // Text-only: reject tool/image/file requests up front.
    const tools = bodyObj.tools;
    const functions = bodyObj.functions;
    if (tools != null && (!Array.isArray(tools) || tools.length > 0)) {
      return makeErrorResult(400, "Claude Web does not support OpenAI function tools", body);
    }
    if (functions != null && (!Array.isArray(functions) || functions.length > 0)) {
      return makeErrorResult(400, "Claude Web does not support legacy function tools", body);
    }

    const cookieHeader = readSessionCookie(credentials);
    if (!cookieHeader) {
      return makeErrorResult(
        401,
        "Missing Claude Web session cookie. Paste the sessionKey cookie (or full Cookie header) from claude.ai as the API key.",
        body
      );
    }

    let prompt;
    try {
      prompt = foldMessages(messages);
    } catch (err) {
      return makeErrorResult(400, err instanceof Error ? err.message : "Unsupported Claude Web request", body);
    }
    if (!prompt.trim()) {
      return makeErrorResult(400, "Claude Web requires a non-empty user message", body);
    }

    const requestedModel = String(model || bodyObj.model || "claude-sonnet-5");

    // ── Organization resolution ────────────────────────────────────────────
    let organizationId;
    try {
      const resolution = await getOrganizationId(cookieHeader, signal, proxyOptions);
      if (resolution.failure === "authentication") {
        return makeErrorResult(401, "Session expired or invalid. Re-login at https://claude.ai and paste a fresh sessionKey cookie.", body);
      }
      if (resolution.failure === "challenge") {
        return makeErrorResult(403, "Claude Web returned a Cloudflare browser challenge. The session's TLS fingerprint must match the browser.", body);
      }
      organizationId = resolution.organizationId;
    } catch (err) {
      if (err instanceof WebTlsClientUnavailableError) return makeTlsUnavailableResult(body);
      log?.error?.("CLAUDE-WEB", `Organization discovery failed: ${err?.name || "unknown"}`);
      return makeErrorResult(502, "Unable to determine the authenticated Claude Web organization", body);
    }
    if (!organizationId) {
      return makeErrorResult(502, "Unable to determine the authenticated Claude Web organization", body);
    }

    // ── Build a fresh conversation + turn ──────────────────────────────────
    const conversationId = randomUUID();
    const humanMessageUuid = randomUUID();
    const assistantMessageUuid = randomUUID();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
    const payload = buildPayload({
      model: requestedModel,
      prompt,
      timezone,
      locale,
      humanUuid: humanMessageUuid,
      assistantUuid: assistantMessageUuid,
      isNew: true,
    });

    const completionUrl =
      `${API_BASE}/organizations/${encodeURIComponent(organizationId)}` +
      `/chat_conversations/${encodeURIComponent(conversationId)}/completion`;

    // ── Send the turn through the shared TLS transport ────────────────────
    let upstream;
    try {
      upstream = await webTlsFetch(completionUrl, {
        method: "POST",
        headers: { ...makeBrowserHeaders(), Cookie: cookieHeader },
        body: JSON.stringify(payload),
        profile: TLS_PROFILE,
        signal,
        proxyOptions,
      });
    } catch (err) {
      if (err instanceof WebTlsClientUnavailableError) return makeTlsUnavailableResult(body);
      log?.error?.("CLAUDE-WEB", "Completion request failed");
      return makeErrorResult(502, "Claude Web connection failed", body, completionUrl);
    }

    const upstreamText = upstream.text || "";
    if (upstream.status < 200 || upstream.status >= 300) {
      if (upstream.status === 401) {
        return makeErrorResult(401, "Session expired or invalid. Re-login at https://claude.ai and paste a fresh sessionKey cookie.", body, completionUrl);
      }
      if (upstream.status === 429) {
        return makeErrorResult(429, "Rate limited by Claude Web API", body, completionUrl);
      }
      if (isChallenge(upstream.status, upstreamText)) {
        return makeErrorResult(403, "Claude Web returned a Cloudflare browser challenge. The session's TLS fingerprint must match the browser.", body, completionUrl);
      }
      return makeErrorResult(upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502, "Claude Web API error", body, completionUrl);
    }

    // ── Parse Claude Web SSE → OpenAI output ───────────────────────────────
    let events;
    try {
      events = parseClaudeWebStream(upstreamText);
    } catch (err) {
      log?.error?.("CLAUDE-WEB", "Claude Web stream protocol validation failed");
      return makeErrorResult(502, "Claude Web stream protocol error", body, completionUrl);
    }

    const headers = makeBrowserHeaders();
    const base = { url: completionUrl, headers, transformedBody: payload, responseFormat: "openai" };
    const id = completionId();
    const created = Math.floor(Date.now() / 1000);

    if (!stream) {
      let content = "";
      let reasoning = "";
      let stopReason = "end_turn";
      for (const event of events) {
        if (event.kind === "content") content += event.text;
        else if (event.kind === "reasoning") reasoning += event.text;
        else if (event.kind === "finish") stopReason = event.stopReason;
      }
      const message = { role: "assistant", content };
      if (reasoning) message.reasoning_content = reasoning;
      const completion = {
        id,
        object: "chat.completion",
        created,
        model: requestedModel,
        choices: [{ index: 0, message, finish_reason: openAiFinishReason(stopReason) }],
      };
      return {
        ...base,
        response: new Response(JSON.stringify(completion), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }

    const encoder = new TextEncoder();
    const emit = (delta, finishReason = null) =>
      encoder.encode(
        sseChunk({
          id,
          object: "chat.completion.chunk",
          created,
          model: requestedModel,
          choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
        })
      );

    const outStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(emit({ role: "assistant", content: "" }));
          for (const event of events) {
            if (event.kind === "content") controller.enqueue(emit({ content: event.text }));
            else if (event.kind === "reasoning") {
              controller.enqueue(emit({ reasoning_content: event.text }));
            } else if (event.kind === "finish") {
              controller.enqueue(emit({}, openAiFinishReason(event.stopReason)));
              break;
            }
          }
          controller.enqueue(encoder.encode(SSE_DONE));
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        } catch {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    return { ...base, response: new Response(outStream, { status: 200, headers: SSE_HEADERS_NO_BUFFER }) };
  }
}

export default ClaudeWebExecutor;
