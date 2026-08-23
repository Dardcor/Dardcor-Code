// deepseek-web.js — DeepSeek Web (chat.deepseek.com) executor.
//
// ESM port of OmniRoute's open-sse/executors/deepseek-web.ts, adapted to
// MiawRouter conventions (see kimi-web.js / grok-web.js for the local pattern):
//
//   - Auth:     `userToken` credential (raw token or JSON-wrapped {"value":...}),
//               exchanged for a short-lived access token via /v0/users/current.
//   - PoW:      every completion needs a DeepSeekHashV1 answer solved from
//               /v0/chat/create_pow_challenge and echoed back in X-Ds-Pow-Response.
//   - Sessions: fresh chat_session per request (persistSession reuses one per
//               userToken), created via /v0/chat_session/create, deleted after.
//   - Output:   upstream DeepSeek SSE is translated to OpenAI chat.completion
//               (streaming chunks with [DONE], or JSON for non-streaming), so the
//               provider stays `format: "openai"` and returns responseFormat "openai".
//
// Text-only by design: tools and image content are rejected with a clear 400,
// not silently dropped or emulated.
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { solveDeepSeekPowAsync } from "../lib/deepseek-pow.js";

const DEEPSEEK_WEB_BASE = "https://chat.deepseek.com";
const DEEPSEEK_API_BASE = `${DEEPSEEK_WEB_BASE}/api`;
const COMPLETION_URL = `${DEEPSEEK_API_BASE}/v0/chat/completion`;

// Fingerprint headers the chat.deepseek.com web client sends on every /api/v0/*
// request. Verbatim from OmniRoute (captured against web client v2.0.0). The live
// client also sends `x-hif-leim` (obfuscated JS attestation) — intentionally
// omitted; the completion endpoint does not enforce it.
const FAKE_HEADERS = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: DEEPSEEK_WEB_BASE,
  Referer: `${DEEPSEEK_WEB_BASE}/`,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "X-Client-Bundle-Id": "com.deepseek.chat",
  "X-Client-Locale": "en-US",
  "X-Client-Platform": "web",
  "X-Client-Version": "2.0.0",
};

// ── Token / session caches (keyed by userToken → short-lived values) ──────

const tokenCache = new Map();
const sessionCache = new Map();
const CACHE_MAX_SIZE = 100;

function evictOldest(cache) {
  if (cache.size >= CACHE_MAX_SIZE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

// ── Credential extraction ──────────────────────────────────────────────────

// Accept a raw userToken or a JSON-wrapped token (DeepSeek stores
// {"value":"..."}); falls back to accessToken for other storage shapes.
export function extractUserToken(credentials) {
  let raw = credentials?.apiKey || credentials?.accessToken;
  if (typeof raw !== "string" || raw.length === 0) return null;
  raw = raw.trim().replace(/^userToken=/i, "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.value === "string") return parsed.value;
  } catch {
    // not JSON, use raw
  }
  return raw;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function errorResponse(status, message, dsCode) {
  return new Response(
    JSON.stringify({
      error: { message, type: "upstream_error", code: dsCode ?? `HTTP_${status}` },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// Thrown when the userToken itself is rejected (vs a transient upstream error),
// so execute() can surface a clear 401 instead of a generic 502.
class DeepSeekAuthError extends Error {}

function resolveModelOptions(model, bodyObj) {
  const m = (model || "").toLowerCase();
  const modelType = m.includes("pro") || m.includes("expert") ? "expert" : "default";
  const thinkingEnabled =
    m.includes("r1") ||
    m.includes("think") ||
    m.includes("reason") ||
    bodyObj?.thinking_enabled === true ||
    bodyObj?.thinking === true ||
    !!bodyObj?.reasoning_effort;
  const searchEnabled =
    m.includes("search") ||
    bodyObj?.search_enabled === true ||
    bodyObj?.search === true ||
    bodyObj?.web_search === true;
  return { modelType, thinkingEnabled, searchEnabled };
}

function generateFakeCookie() {
  const ts = Date.now();
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const uid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  return `intercom-HWWAFSESTIME=${ts}; HWWAFSESID=${hex(18)}; Hm_lvt_${uid()}=${Math.floor(ts / 1000)}; _frid=${uid()}`;
}

// ── PoW (DeepSeekHashV1) ───────────────────────────────────────────────────

async function solvePow(challenge) {
  const answer = await solveDeepSeekPowAsync(
    challenge.algorithm,
    challenge.challenge,
    challenge.salt,
    challenge.difficulty,
    challenge.expire_at
  );
  if (answer < 0) throw new Error("PoW solver failed");
  return Buffer.from(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    })
  ).toString("base64");
}

// ── Stream content formatting (from OmniRoute stream-format.ts) ────────────

function isThinkingModel(model) {
  const m = model.toLowerCase();
  return m.includes("think") || m.includes("r1") || m.includes("reason");
}

function isSearchModel(model) {
  const m = model.toLowerCase();
  return m.includes("search") || m.includes("fold");
}

function cleanDeepSeekToken(text) {
  return text.replace(/FINISHED/g, "").replace(/^(SEARCH|WEB_SEARCH|SEARCHING)\s*/i, "");
}

function formatStreamContent(raw, model) {
  let text = cleanDeepSeekToken(raw);
  if (!isSearchModel(model)) return text;
  if (model.toLowerCase().includes("search-silent")) {
    return text.replace(/\[citation:(\d+)\]/g, "");
  }
  return text.replace(/\[citation:(\d+)\]/g, "[$1]");
}

function appendSearchCitations(searchResults, model) {
  if (searchResults.length === 0 || model.toLowerCase().includes("search-silent")) {
    return "";
  }
  return searchResults
    .filter((r) => r.cite_index)
    .sort((a, b) => (a.cite_index || 0) - (b.cite_index || 0))
    .map((r) => `[${r.cite_index}]: [${r.title}](${r.url})`)
    .join("\n");
}

// ── SSE "done terminator" state machine (from OmniRoute done-terminator.ts) ─

const DEEPSEEK_FINISHED_DRAIN_MS = 750;

function createFinishOnceGuard(finish) {
  let streamFinished = false;
  return {
    finishOnce: () => {
      if (streamFinished) return;
      streamFinished = true;
      try {
        finish();
      } catch {
        // Controller may already be closed if the client cancelled.
      }
    },
    hasFinished: () => streamFinished,
  };
}

function createFinishedDrainScheduler(finishStream, drainMs = DEEPSEEK_FINISHED_DRAIN_MS) {
  let finishedDrainTimer = null;
  const clearFinishedDrain = () => {
    if (finishedDrainTimer) {
      clearTimeout(finishedDrainTimer);
      finishedDrainTimer = null;
    }
  };
  const scheduleFinishAfterDrain = () => {
    clearFinishedDrain();
    finishedDrainTimer = setTimeout(() => {
      finishedDrainTimer = null;
      finishStream();
    }, drainMs);
  };
  return {
    scheduleFinishAfterDrain,
    clearFinishedDrain,
    isDrainPending: () => finishedDrainTimer !== null,
  };
}

// ── SSE transform (DeepSeek → OpenAI) ──────────────────────────────────────

function transformSSE(deepseekStream, model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const streamModel = model || "deepseek-web";
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let emittedRole = false;
  let currentPath = "";
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults = [];

  return new ReadableStream(
    {
      async start(controller) {
        const reader = deepseekStream.getReader();
        let buffer = "";

        const emit = (obj) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        const chunk = (delta, finish) => {
          emit({
            id,
            object: "chat.completion.chunk",
            created,
            model: streamModel,
            choices: [{ index: 0, delta, finish_reason: finish ?? null }],
          });
        };

        const ensureRole = () => {
          if (!emittedRole) {
            emittedRole = true;
            chunk({ role: "assistant", content: "" });
          }
        };

        const { finishOnce: finishStream, hasFinished } = createFinishOnceGuard(() => {
          const citations = appendSearchCitations(searchResults, streamModel);
          if (citations) {
            ensureRole();
            chunk({ content: `\n\n${citations}` });
          }
          ensureRole();
          chunk({}, "stop");
          // OpenAI-compatible clients (SDK, OpenCode) hang without this terminator.
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        });

        // Do not close immediately on FINISHED — DeepSeek may still send
        // search_results afterward. Drain briefly, then always emit stop + [DONE].
        const { scheduleFinishAfterDrain, clearFinishedDrain, isDrainPending } =
          createFinishedDrainScheduler(finishStream);

        const sendByPath = (raw) => {
          const text = formatStreamContent(raw, streamModel);
          if (!text) return;
          ensureRole();
          let path = currentPath;
          if (!path && thinkingModel) path = "thinking";
          else if (!path && isSearchModel(streamModel)) path = "content";
          if (path === "thinking") {
            chunk({ reasoning_content: text });
          } else {
            chunk({ content: text });
          }
        };

        const applyFragmentType = (frag) => {
          const type = String(frag?.type || "").toUpperCase();
          if (type === "THINK") currentPath = "thinking";
          else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
        };

        const handleFragment = (frag, setPathFromType = false) => {
          if (setPathFromType) applyFragmentType(frag);
          if (typeof frag?.content !== "string" || frag.content.length === 0) return;
          if (!setPathFromType) {
            const type = String(frag?.type || "").toUpperCase();
            if (type === "THINK") currentPath = "thinking";
            else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
          }
          sendByPath(frag.content);
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
              const payload = line.replace(/^data:\s*/, "").trim();

              if (payload === "[DONE]") {
                finishStream();
                return;
              }

              let data;
              try {
                data = JSON.parse(payload);
              } catch {
                continue;
              }

              const p = data?.p;
              const o = data?.o;
              const v = data?.v;

              if (v && typeof v === "object" && v.response) {
                if (v.response.thinking_enabled === true) currentPath = "thinking";
                else if (v.response.thinking_enabled === false) currentPath = "content";
                const fragments = v.response.fragments;
                if (Array.isArray(fragments)) {
                  for (const frag of fragments) handleFragment(frag, false);
                }
              }

              if (p === "response/fragments") {
                if (Array.isArray(v)) {
                  for (const frag of v) handleFragment(frag, true);
                } else if (v && typeof v === "object") {
                  handleFragment(v, true);
                }
              }

              if (p === "response" && Array.isArray(v)) {
                for (const entry of v) {
                  if (entry?.p === "response" && entry?.v?.thinking_enabled === true) {
                    currentPath = "thinking";
                  }
                }
              }

              if (p === "response/search_status") continue;

              if (p === "response/search_results" && Array.isArray(v)) {
                if (o !== "BATCH") {
                  searchResults.length = 0;
                  searchResults.push(...v);
                } else {
                  for (const op of v) {
                    const match = String(op?.p || "").match(/^(\d+)\/cite_index$/);
                    if (match) {
                      const index = parseInt(match[1], 10);
                      if (searchResults[index]) searchResults[index].cite_index = op.v;
                    }
                  }
                }
                continue;
              }

              if (typeof v === "string") {
                sendByPath(v);
              } else if (Array.isArray(v) && p === "response") {
                for (const entry of v) {
                  if (Array.isArray(entry?.v)) {
                    const joined = entry.v.map((item) => item?.content || "").join("");
                    if (joined) sendByPath(joined);
                  }
                }
              }

              if (p === "response/status" && v === "FINISHED") {
                scheduleFinishAfterDrain();
                continue;
              }

              // Any other post-FINISHED payload extends the drain window so we
              // still capture late search_results before closing.
              if (isDrainPending()) {
                scheduleFinishAfterDrain();
              }
            }
          }
        } catch (err) {
          clearFinishedDrain();
          if (!hasFinished()) {
            controller.error(err);
          }
          return;
        }

        finishStream();
      },
      cancel() {
        // Best-effort: upstream reader cancellation is handled by wrapStreamWithCleanup.
      },
    },
    { highWaterMark: 16384 }
  );
}

async function collectSSEContent(deepseekStream, model) {
  const decoder = new TextDecoder();
  const reader = deepseekStream.getReader();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let currentPath = "";
  const streamModel = model || "deepseek-web";
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults = [];

  const appendByPath = (raw) => {
    const text = formatStreamContent(raw, streamModel);
    if (!text) return;
    let path = currentPath;
    if (!path && thinkingModel) path = "thinking";
    else if (!path && isSearchModel(streamModel)) path = "content";
    if (path === "thinking") reasoningContent += text;
    else content += text;
  };

  const applyFragmentType = (frag) => {
    const type = String(frag?.type || "").toUpperCase();
    if (type === "THINK") currentPath = "thinking";
    else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
  };

  const handleFragment = (frag, setPathFromType = false) => {
    if (setPathFromType) applyFragmentType(frag);
    if (typeof frag?.content !== "string" || frag.content.length === 0) return;
    if (!setPathFromType) {
      const type = String(frag?.type || "").toUpperCase();
      if (type === "THINK") currentPath = "thinking";
      else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content";
    }
    appendByPath(frag.content);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
      const payload = line.replace(/^data:\s*/, "").trim();
      try {
        const data = JSON.parse(payload);
        const p = data?.p;
        const v = data?.v;

        if (v && typeof v === "object" && v.response) {
          if (v.response.thinking_enabled === true) currentPath = "thinking";
          else if (v.response.thinking_enabled === false) currentPath = "content";
          if (Array.isArray(v.response.fragments)) {
            for (const frag of v.response.fragments) handleFragment(frag, false);
          }
        }

        if (p === "response/fragments") {
          if (Array.isArray(v)) {
            for (const frag of v) handleFragment(frag, true);
          } else if (v && typeof v === "object") {
            handleFragment(v, true);
          }
        }

        if (p === "response" && Array.isArray(v)) {
          for (const entry of v) {
            if (entry?.p === "response" && entry?.v?.thinking_enabled === true) {
              currentPath = "thinking";
            }
          }
        }

        if (p === "response/search_status") continue;

        if (p === "response/search_results" && Array.isArray(v)) {
          if (data?.o !== "BATCH") {
            searchResults.length = 0;
            searchResults.push(...v);
          } else {
            for (const op of v) {
              const match = String(op?.p || "").match(/^(\d+)\/cite_index$/);
              if (match) {
                const index = parseInt(match[1], 10);
                if (searchResults[index]) searchResults[index].cite_index = op.v;
              }
            }
          }
          continue;
        }

        if (typeof v === "string") {
          appendByPath(v);
        } else if (Array.isArray(v) && p === "response") {
          for (const entry of v) {
            if (Array.isArray(entry?.v)) {
              const joined = entry.v.map((item) => item?.content || "").join("");
              if (joined) appendByPath(joined);
            }
          }
        }
      } catch {
        // skip malformed payloads
      }
    }
  }

  const citations = appendSearchCitations(searchResults, streamModel);
  if (citations) content += `\n\n${citations}`;

  return { content, reasoningContent };
}

// ── Prompt builder (DeepSeek native single-prompt format) ──────────────────

// Text-only: any non-text content part (image/audio/file/tool) is rejected
// explicitly rather than silently dropped.
function extractMessageText(content) {
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      const type = String(item?.type || "");
      if (type === "text" || type === "input_text") {
        if (typeof item.text === "string") parts.push(item.text);
      } else {
        throw new Error(`deepseek-web does not support ${type || "unknown"} message content`);
      }
    }
    return parts.join("\n");
  }
  return String(content || "");
}

/**
 * Build the single prompt string the DeepSeek web API accepts
 * (/api/v0/chat/completion takes `prompt`, not `messages`).
 *
 * With `historyWindow <= 0` (default) we keep system prompt(s) + the last user
 * message only. With `historyWindow > 0` we stitch the last N non-system
 * messages into a role-tagged transcript so agentic multi-turn clients keep
 * context across turns.
 */
export function messagesToPrompt(messages, historyWindow = 0) {
  if (messages.length === 0) return "";

  const systemParts = [];
  const conversation = [];
  let lastUserContent = "";
  for (const m of messages) {
    const text = extractMessageText(m.content).trim();
    if (m.role === "system") {
      if (text) systemParts.push(text);
    } else if (m.role === "user" || m.role === "assistant") {
      if (text) conversation.push({ role: m.role, text });
      if (m.role === "user") lastUserContent = text;
    } else if (m.role === "tool") {
      // No native slot in the single-prompt format — surface as plain text.
      if (text) conversation.push({ role: "tool", text: `(tool) ${text}` });
    } else {
      throw new Error(`deepseek-web does not support message role ${m.role}`);
    }
  }

  const parts = [];
  if (systemParts.length > 0) {
    parts.push(systemParts.join("\n\n"));
  }

  if (historyWindow > 0 && conversation.length > 1) {
    const recent = conversation.slice(-historyWindow);
    const transcript = recent
      .map((turn) =>
        turn.role === "assistant"
          ? `Assistant: ${turn.text}`
          : turn.role === "tool"
            ? `Tool result ${turn.text}`
            : `User: ${turn.text}`
      )
      .join("\n\n");
    parts.push(transcript);
  } else if (lastUserContent) {
    parts.push(lastUserContent);
  }

  return parts.join("\n\n").replace(/!\[.*?\]\(.*?\)/g, "");
}

// ── DeepSeek API calls (Bearer token auth) ─────────────────────────────────

async function acquireAccessToken(userToken, signal, log, proxyOptions) {
  const cached = tokenCache.get(userToken);
  if (cached && cached.expiresAt > Math.floor(Date.now() / 1000)) {
    return cached.accessToken;
  }

  log?.info?.("DEEPSEEK-WEB", "Acquiring access token from /users/current...");
  const resp = await proxyAwareFetch(
    `${DEEPSEEK_API_BASE}/v0/users/current`,
    {
      headers: {
        Authorization: `Bearer ${userToken}`,
        ...FAKE_HEADERS,
      },
      signal: signal ?? undefined,
    },
    proxyOptions
  );

  if (resp.status === 401 || resp.status === 403) {
    throw new DeepSeekAuthError(
      "DeepSeek userToken invalid or expired — get a new userToken from chat.deepseek.com localStorage"
    );
  }
  if (!resp.ok) {
    throw new Error(`users/current HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (json?.code && json.code !== 0) {
    const errMsg = json.msg || json?.data?.biz_msg || `error code ${json.code}`;
    tokenCache.delete(userToken);
    throw new Error(`DeepSeek rejected token: ${errMsg}`);
  }
  const bizData = json?.data?.biz_data || json?.biz_data;
  if (!bizData?.token) {
    const errMsg = json?.msg || json?.data?.biz_msg || "Unknown error";
    throw new Error(`Failed to acquire token: ${errMsg}`);
  }

  const accessToken = bizData.token;
  evictOldest(tokenCache);
  tokenCache.set(userToken, {
    accessToken,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  log?.info?.("DEEPSEEK-WEB", "Access token acquired");
  return accessToken;
}

function parseDeepSeekErrorPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const codeRaw = payload.code;
  const code = typeof codeRaw === "number" ? codeRaw : undefined;
  const data = payload.data;
  const messageRaw =
    typeof payload.msg === "string"
      ? payload.msg
      : typeof data?.biz_msg === "string"
        ? data.biz_msg
        : "";
  if (code !== undefined && code !== 0) {
    return { code, message: messageRaw || `DeepSeek error ${code}` };
  }
  return null;
}

async function createSession(accessToken, signal, proxyOptions) {
  const resp = await proxyAwareFetch(
    `${DEEPSEEK_API_BASE}/v0/chat_session/create`,
    {
      method: "POST",
      headers: {
        ...FAKE_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        Cookie: generateFakeCookie(),
      },
      body: JSON.stringify({}),
      signal: signal ?? undefined,
    },
    proxyOptions
  );

  if (!resp.ok) throw new Error(`chat_session/create HTTP ${resp.status}`);
  const json = await resp.json();
  const bizData = json?.data?.biz_data || json?.biz_data;
  const id = bizData?.chat_session?.id;
  if (!id) throw new Error(`No session id: code=${json?.code}`);
  return id;
}

async function deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions) {
  try {
    await proxyAwareFetch(
      `${DEEPSEEK_API_BASE}/v0/chat_session/delete`,
      {
        method: "POST",
        headers: {
          ...FAKE_HEADERS,
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ chat_session_id: sessionId }),
      },
      proxyOptions
    );
  } catch {
    // best-effort cleanup
  }
}

function wrapStreamWithCleanup(responseStream, cleanup) {
  const reader = responseStream.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        cleanup().catch(() => {});
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel();
      cleanup().catch(() => {});
    },
  });
}

async function getPowChallenge(accessToken, signal, proxyOptions) {
  const resp = await proxyAwareFetch(
    `${DEEPSEEK_API_BASE}/v0/chat/create_pow_challenge`,
    {
      method: "POST",
      headers: {
        ...FAKE_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
      signal: signal ?? undefined,
    },
    proxyOptions
  );
  if (!resp.ok) throw new Error(`create_pow_challenge HTTP ${resp.status}`);
  const json = await resp.json();
  const bizData = json?.data?.biz_data || json?.biz_data;
  if (!bizData?.challenge?.challenge) throw new Error(`No PoW challenge: code=${json?.code}`);
  return bizData.challenge;
}

// ── Executor ───────────────────────────────────────────────────────────────

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() {
    super("deepseek-web", { baseUrl: DEEPSEEK_WEB_BASE });
  }

  async testConnection(credentials, signal) {
    try {
      const userToken = extractUserToken(credentials);
      if (!userToken) return false;
      const accessToken = await acquireAccessToken(userToken, signal, undefined, null);
      return !!accessToken;
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const bodyObj = body || {};

    // Text-only: reject tools / functions explicitly (no tool emulation).
    const requestedTools = bodyObj.tools;
    const requestedFunctions = bodyObj.functions;
    if (
      (Array.isArray(requestedTools) && requestedTools.length > 0) ||
      (Array.isArray(requestedFunctions) && requestedFunctions.length > 0)
    ) {
      return {
        response: errorResponse(400, "deepseek-web does not support function tools"),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const userToken = extractUserToken(credentials);
    if (!userToken) {
      return {
        response: errorResponse(
          400,
          "Invalid credentials: paste your userToken from DeepSeek localStorage " +
            "(DevTools → Application → Local Storage → chat.deepseek.com → userToken)"
        ),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const { modelType, thinkingEnabled, searchEnabled } = resolveModelOptions(
      model,
      bodyObj
    );

    // Per-connection memory config. Defaults preserve the legacy
    // fresh-session-per-request, last-user-message-only behavior.
    const psd = credentials?.providerSpecificData ?? {};
    const persistSession = psd.persistSession === true;
    const historyWindow =
      typeof psd.historyWindow === "number" && psd.historyWindow > 0 ? psd.historyWindow : 0;

    try {
      let t0 = Date.now();
      const accessToken = await acquireAccessToken(userToken, signal, log, proxyOptions);
      log?.info?.("DEEPSEEK-WEB", `Token acquired in ${Date.now() - t0}ms`);

      let prompt;
      try {
        const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
        prompt = messagesToPrompt(messages, historyWindow);
      } catch (err) {
        // Reject images/unsupported content clearly.
        return {
          response: errorResponse(
            400,
            err instanceof Error ? err.message : String(err)
          ),
          url: COMPLETION_URL,
          headers: {},
          transformedBody: body,
        };
      }
      const refFileIds = Array.isArray(bodyObj.ref_file_ids) ? bodyObj.ref_file_ids : [];
      log?.info?.(
        "DEEPSEEK-WEB",
        `model_type=${modelType}, thinking=${thinkingEnabled}, search=${searchEnabled}, files=${refFileIds.length}, stream=${stream !== false}, persist=${persistSession}, window=${historyWindow}`
      );

      // One completion attempt against a given session id (fresh PoW per attempt).
      const performCompletion = async (sid) => {
        const powChallenge = await getPowChallenge(accessToken, signal, proxyOptions);
        const powAnswer = await solvePow(powChallenge);
        const reqHeaders = {
          ...FAKE_HEADERS,
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Ds-Pow-Response": powAnswer,
          "X-Client-Timezone-Offset": String(new Date().getTimezoneOffset() * -60),
          Cookie: generateFakeCookie(),
        };
        const requestPayload = {
          chat_session_id: sid,
          parent_message_id: null,
          model_type: modelType,
          prompt,
          ref_file_ids: refFileIds,
          thinking_enabled: thinkingEnabled,
          search_enabled: searchEnabled,
          preempt: false,
        };
        const resp = await proxyAwareFetch(
          COMPLETION_URL,
          {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify(requestPayload),
            signal: signal ?? undefined,
          },
          proxyOptions
        );
        return { resp, reqHeaders, requestPayload };
      };

      // Reuse one upstream session per userToken with persistSession (rolling-window
      // memory); otherwise create a fresh one per request (legacy behavior).
      const acquireSession = async () => {
        if (persistSession) {
          const cached = sessionCache.get(userToken);
          if (cached) return { sessionId: cached.sessionId, reused: true };
          const created = await createSession(accessToken, signal, proxyOptions);
          evictOldest(sessionCache);
          sessionCache.set(userToken, { sessionId: created, createdAt: Date.now() });
          return { sessionId: created, reused: false };
        }
        return { sessionId: await createSession(accessToken, signal, proxyOptions), reused: false };
      };

      t0 = Date.now();
      let { sessionId, reused: reusedSession } = await acquireSession();
      log?.info?.(
        "DEEPSEEK-WEB",
        `Session ${reusedSession ? "reused" : "created"} in ${Date.now() - t0}ms`
      );

      t0 = Date.now();
      log?.info?.("DEEPSEEK-WEB", `POST ${COMPLETION_URL}`);
      let { resp, reqHeaders, requestPayload } = await performCompletion(sessionId);
      log?.info?.(
        "DEEPSEEK-WEB",
        `Completion response in ${Date.now() - t0}ms, status=${resp.status}`
      );

      // A reused session that fails is likely stale (user deleted the chat in the
      // DeepSeek UI). Drop it, create a fresh session, and retry once.
      if (!resp.ok && persistSession && reusedSession) {
        log?.warn?.("DEEPSEEK-WEB", "Reused session failed — retrying with a fresh session");
        sessionCache.delete(userToken);
        sessionId = await createSession(accessToken, signal, proxyOptions);
        evictOldest(sessionCache);
        sessionCache.set(userToken, { sessionId, createdAt: Date.now() });
        reusedSession = false;
        ({ resp, reqHeaders, requestPayload } = await performCompletion(sessionId));
      }

      if (!resp.ok) {
        const status = resp.status;
        let errMsg = `DeepSeek API error (${status})`;
        if (status === 401 || status === 403) {
          tokenCache.delete(userToken);
          errMsg = "DeepSeek token expired — get a fresh userToken from chat.deepseek.com localStorage.";
        } else if (status === 429) {
          errMsg = "DeepSeek rate limited. Wait and retry.";
        }
        log?.warn?.("DEEPSEEK-WEB", errMsg);

        try {
          const errBody = await resp.json();
          if (errBody?.code && errBody.code !== 0) {
            errMsg = `DeepSeek error ${errBody.code}: ${errBody.msg}`;
          }
        } catch {
          /* ignore */
        }

        if (persistSession) sessionCache.delete(userToken);
        deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions).catch(() => {});
        return {
          response: errorResponse(status, errMsg),
          url: COMPLETION_URL,
          headers: reqHeaders,
          transformedBody: requestPayload,
        };
      }

      // Check for HTTP 200 with DeepSeek error JSON.
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        try {
          const json = await resp.json();
          const parsed = parseDeepSeekErrorPayload(json);
          if (parsed) {
            const errMsg = `DeepSeek error ${parsed.code}: ${parsed.message}`;
            log?.warn?.("DEEPSEEK-WEB", errMsg);
            const status = parsed.code === 40003 ? 401 : parsed.code === 40002 ? 429 : 502;
            if (parsed.code === 40003) {
              tokenCache.delete(userToken);
            }
            if (persistSession) sessionCache.delete(userToken);
            deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions).catch(() => {});
            return {
              response: errorResponse(status, errMsg, parsed.code),
              url: COMPLETION_URL,
              headers: reqHeaders,
              transformedBody: requestPayload,
            };
          }
          if (!persistSession) deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions).catch(() => {});
          return {
            response: new Response(JSON.stringify(json), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
            url: COMPLETION_URL,
            headers: reqHeaders,
            transformedBody: requestPayload,
            responseFormat: "openai",
          };
        } catch {
          /* not JSON, continue */
        }
      }

      // Persistent sessions are kept for reuse; only delete the upstream chat
      // session when persistence is off (legacy behavior).
      const cleanupFn = persistSession
        ? async () => {}
        : () => deleteSessionOnDeepSeek(accessToken, sessionId, proxyOptions);

      const clientModel = typeof model === "string" && model.trim() ? model.trim() : "deepseek-web";

      if (stream !== false) {
        const openaiStream = transformSSE(resp.body, clientModel);
        const wrappedStream = wrapStreamWithCleanup(openaiStream, cleanupFn);
        return {
          response: new Response(wrappedStream, {
            status: 200,
            headers: { ...SSE_HEADERS_NO_BUFFER },
          }),
          url: COMPLETION_URL,
          headers: reqHeaders,
          transformedBody: requestPayload,
          responseFormat: "openai",
        };
      }

      const { content, reasoningContent } = await collectSSEContent(resp.body, clientModel);
      await cleanupFn();
      const message = { role: "assistant", content };
      if (reasoningContent) message.reasoning_content = reasoningContent;
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || modelType,
        choices: [
          {
            index: 0,
            message,
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return {
        response: new Response(JSON.stringify(openaiResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: COMPLETION_URL,
        headers: reqHeaders,
        transformedBody: requestPayload,
        responseFormat: "openai",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("DEEPSEEK-WEB", `Execute failed: ${msg}`);

      if (err?.name === "AbortError") {
        return {
          response: errorResponse(499, "Request cancelled"),
          url: COMPLETION_URL,
          headers: {},
          transformedBody: body,
        };
      }

      // Surface userToken rejection as a clear 401, not a generic 502.
      if (err instanceof DeepSeekAuthError) {
        return {
          response: errorResponse(401, msg),
          url: COMPLETION_URL,
          headers: {},
          transformedBody: body,
        };
      }

      return {
        response: errorResponse(502, `DeepSeek error: ${msg}`),
        url: COMPLETION_URL,
        headers: {},
        transformedBody: body,
      };
    }
  }
}

export const deepseekWebExecutor = new DeepSeekWebExecutor();

export default DeepSeekWebExecutor;
