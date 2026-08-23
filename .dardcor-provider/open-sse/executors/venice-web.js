import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { stripCookieInputPrefix } from "../services/webCookieAuth.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

const BASE_URL = "https://venice.ai";
const CHAT_URL = `${BASE_URL}/api/chat`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function errorResult(status, message, body, headers = {}) {
  return {
    response: new Response(
      JSON.stringify({ error: { message, type: "upstream_error" } }),
      { status, headers: { "Content-Type": "application/json" } }
    ),
    url: CHAT_URL,
    headers,
    transformedBody: body,
  };
}

function loggedHeaders(headers) {
  return headers.Cookie ? { ...headers, Cookie: "[redacted]" } : headers;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Venice Web only supports text content");
  return content.map((part) => {
    if (part?.type === "text" || part?.type === "input_text") return String(part.text || "");
    throw new Error("Venice Web does not support image, audio, file, or tool content");
  }).join("");
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Venice Web requires a non-empty messages array");
  }
  return messages.map((message) => {
    if (message.role === "tool" || message.role === "function" || message.tool_calls) {
      throw new Error("Venice Web does not support tool calls");
    }
    if (!["system", "developer", "user", "assistant"].includes(message.role)) {
      throw new Error(`Venice Web does not support message role ${message.role}`);
    }
    return { role: message.role, content: textFromContent(message.content) };
  });
}

function streamingResponse(upstreamBody, modelId, signal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-ven-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const emit = (delta, finishReason = null) => encoder.encode(sseChunk({
    id,
    object: "chat.completion.chunk",
    created,
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }));

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody?.getReader();
      controller.enqueue(emit({ role: "assistant", content: "" }));
      if (!reader) {
        controller.enqueue(emit({}, "stop"));
        controller.enqueue(encoder.encode(SSE_DONE));
        controller.close();
        return;
      }

      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const content = JSON.parse(payload)?.choices?.[0]?.delta?.content;
              if (typeof content === "string" && content) controller.enqueue(emit({ content }));
            } catch {
              continue;
            }
          }
        }
      } catch (error) {
        if (!signal?.aborted) controller.error(error);
        else controller.close();
        return;
      } finally {
        reader.releaseLock();
      }

      controller.enqueue(emit({}, "stop"));
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  });
}

export class VeniceWebExecutor extends BaseExecutor {
  constructor() {
    super("venice-web", { id: "venice-web", baseUrl: BASE_URL });
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions }) {
    const bodyObj = body || {};
    const cookie = stripCookieInputPrefix(String(credentials?.apiKey || ""));
    if (!cookie) return errorResult(400, "Missing Venice Web session cookie", body);
    if (bodyObj.tools?.length || bodyObj.functions?.length || bodyObj.tool_choice) {
      return errorResult(400, "Venice Web does not support tool calls", body);
    }

    let messages;
    try {
      messages = normalizeMessages(bodyObj.messages);
    } catch (error) {
      return errorResult(400, error instanceof Error ? error.message : "Invalid Venice Web request", body);
    }

    const modelId = String(model || bodyObj.model || "venice-default");
    const reqBody = {
      messages,
      model: modelId,
      stream: !!stream,
      max_tokens: bodyObj.max_tokens || 4096,
    };
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: stream ? "text/event-stream" : "application/json",
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
      Cookie: cookie,
    };

    let upstream;
    try {
      upstream = await proxyAwareFetch(CHAT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
        signal,
      }, proxyOptions);
    } catch (error) {
      return errorResult(502, `Venice fetch failed: ${error instanceof Error ? error.message : "unknown"}`, reqBody, loggedHeaders(headers));
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return errorResult(upstream.status, `Venice error: ${text || upstream.statusText}`, reqBody, loggedHeaders(headers));
    }

    if (stream) {
      return {
        response: new Response(streamingResponse(upstream.body, modelId, signal), { headers: SSE_HEADERS_NO_BUFFER }),
        url: CHAT_URL,
        headers: loggedHeaders(headers),
        transformedBody: reqBody,
        responseFormat: "openai",
      };
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content || data?.content || "";
    return {
      response: new Response(JSON.stringify({
        id: `chatcmpl-ven-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      }), { headers: { "Content-Type": "application/json" } }),
      url: CHAT_URL,
      headers: loggedHeaders(headers),
      transformedBody: reqBody,
      responseFormat: "openai",
    };
  }
}

export default VeniceWebExecutor;
