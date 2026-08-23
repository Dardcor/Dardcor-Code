import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { extractCookieValue, stripCookieInputPrefix } from "../services/webCookieAuth.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { chatChunkSse } from "../utils/sse.js";

export const MANUS_TASK_CREATE_URL = "https://api.manus.ai/v2/task.create";
export const MANUS_LIST_MESSAGES_URL = "https://api.manus.ai/v2/task.listMessages";
const POLL_INTERVAL_MS = 5000;
const TASK_TIMEOUT_MS = 30 * 60 * 1000;

function errorResult(status, message, body) {
  return {
    response: new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    url: MANUS_TASK_CREATE_URL,
    headers: {},
    transformedBody: body,
    responseFormat: "openai",
  };
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" || part?.type === "input_text")
    .map((part) => String(part.text || ""))
    .join("");
}

function buildPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("Manus Web requires messages");
  return messages.map((message) => `${message.role || "user"}: ${textContent(message.content)}`).join("\n\n");
}

function getSessionToken(credentials) {
  const raw = stripCookieInputPrefix(String(credentials?.apiKey || credentials?.cookie || ""));
  if (raw.includes("=") && !/(?:^|;\s*)session_id=/.test(raw)) return "";
  return extractCookieValue(raw, "session_id");
}

function headersFor(credentials) {
  const sessionToken = getSessionToken(credentials);
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: "https://manus.im",
    Referer: "https://manus.im/",
    "Connect-Protocol-Version": "1",
    ...(sessionToken ? {
      Authorization: `Bearer ${sessionToken}`,
      Cookie: `session_id=${sessionToken}`,
    } : {}),
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
  });
}

export class ManusWebExecutor extends BaseExecutor {
  constructor(options = {}) {
    super("manus-web", { id: "manus-web", baseUrl: MANUS_TASK_CREATE_URL });
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.taskTimeoutMs = options.taskTimeoutMs ?? TASK_TIMEOUT_MS;
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions }) {
    const headers = headersFor(credentials);
    if (!headers.Authorization) return errorResult(400, "Missing Manus session_id cookie", body);

    let prompt;
    try {
      prompt = buildPrompt(body?.messages);
    } catch (error) {
      return errorResult(400, error instanceof Error ? error.message : "Invalid Manus request", body);
    }

    const requestBody = {
      message: { content: [{ type: "text", text: prompt }] },
      agent_profile: model || "manus-1.6",
      interactive_mode: false,
    };

    let created;
    try {
      const response = await proxyAwareFetch(MANUS_TASK_CREATE_URL, {
        method: "POST", headers, body: JSON.stringify(requestBody), signal,
      }, proxyOptions);
      if (!response.ok) return errorResult(response.status, `Manus task.create failed: ${(await response.text()).slice(0, 300)}`, requestBody);
      created = await response.json();
    } catch (error) {
      if (signal?.aborted) return errorResult(499, "Manus request aborted", requestBody);
      return errorResult(502, `Manus task.create failed: ${error instanceof Error ? error.message : "unknown error"}`, requestBody);
    }

    const taskId = created?.task_id;
    if (!taskId) return errorResult(502, "Manus task.create returned no task_id", requestBody);
    const modelId = String(model || "manus-1.6");
    const id = `chatcmpl-manus-${Date.now()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const pollIntervalMs = this.pollIntervalMs;
    const taskTimeoutMs = this.taskTimeoutMs;
    const encoder = new TextEncoder();
    const emit = (delta, finishReason = null) => encoder.encode(chatChunkSse({ id, created: createdAt, model: modelId, delta, finishReason }));

    const responseStream = new ReadableStream({
      async start(controller) {
        let cursor;
        let finished = false;
        const seen = new Set();
        const startedAt = Date.now();
        controller.enqueue(emit({ role: "assistant", content: "" }));
        try {
          while (!finished && Date.now() - startedAt < taskTimeoutMs) {
            if (signal?.aborted) return controller.close();
            const query = new URLSearchParams({ task_id: taskId, order: "asc", limit: "200" });
            if (cursor) query.set("cursor", cursor);
            const pollSignal = signal
              ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
              : AbortSignal.timeout(30000);
            const poll = await proxyAwareFetch(`${MANUS_LIST_MESSAGES_URL}?${query}`, { headers, signal: pollSignal }, proxyOptions);
            if (!poll.ok) throw new Error(`Manus task.listMessages failed (${poll.status})`);
            const data = await poll.json();
            for (const [index, message] of (Array.isArray(data?.messages) ? data.messages : []).entries()) {
              const messageKey = message?.id || `${cursor || "initial"}:${index}`;
              if (seen.has(messageKey)) continue;
              seen.add(messageKey);
              const content = message.assistant_message?.content;
              if (typeof content === "string" && content) {
                controller.enqueue(emit({ content }));
              }
              const status = message.status_update?.agent_status;
              if (status === "stopped") finished = true;
              if (status === "error" || status === "waiting") {
                throw new Error(message.error_message?.content || message.status_update?.status_detail?.waiting_description || `Manus task ${status}`);
              }
            }
            cursor = data.next_cursor;
            if (data.has_more && cursor) continue;
            if (!finished) {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
              await sleep(pollIntervalMs, signal);
            }
          }
          if (!finished) throw new Error("Manus task timed out");
          controller.enqueue(emit({}, "stop"));
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") return controller.close();
          controller.enqueue(emit({ content: `Manus error: ${error instanceof Error ? error.message : "unknown error"}` }, "stop"));
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        }
      },
    });

    return {
      response: new Response(responseStream, { headers: SSE_HEADERS_NO_BUFFER }),
      url: MANUS_TASK_CREATE_URL,
      headers: { ...headers, Cookie: "[redacted]", Authorization: "Bearer [redacted]" },
      transformedBody: { ...requestBody, task_id: taskId },
      responseFormat: "openai",
      stream,
    };
  }
}

export default ManusWebExecutor;
