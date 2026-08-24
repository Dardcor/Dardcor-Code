/**
 * ChatGptWebExecutor — ChatGPT Web Session Provider (minimal text-chat port).
 *
 * ESM port of OmniRoute's open-sse/executors/chatgpt-web.ts, adapted to the
 * shared Dardcor Code webTlsClient transport and the local executor contract
 * (see kimi-web.js / deepseek-web.js for the pattern).
 *
 * Auth pipeline (per request):
 *   1. exchangeSession()          GET  /api/auth/session   cookie → JWT accessToken (cached ~5min)
 *   2. fetchDpl()                 GET  /                   scrape data-build + script src (cached 1h)
 *   3. prepareChatRequirements()  POST /backend-api/sentinel/chat-requirements[/prepare]
 *                                                                → { proofofwork.seed, difficulty, token }
 *   4. solveProofOfWork()         SHA3-512 hash loop       → "gAAAAAB…" sentinel proof token
 *   5. POST /backend-api/f/conversation                   with Bearer + sentinel tokens + browser UA
 *
 * Response is the standard ChatGPT SSE format (cumulative `parts[0]` strings,
 * not deltas) — diffed into OpenAI deltas downstream.
 *
 * Text-only by design: tools and image content are rejected with a clear 400.
 * Missing the optional tls-client-node dependency yields an actionable 503.
 * Cookies / access tokens are never logged.
 */
import { BaseExecutor } from "./base.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { webTlsFetch, WebTlsClientUnavailableError } from "../services/webTlsClient.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const CHATGPT_BASE = "https://chatgpt.com";
const SESSION_URL = `${CHATGPT_BASE}/api/auth/session`;
const SENTINEL_PREPARE_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements/prepare`;
const SENTINEL_CR_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;
const CONV_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;

// Matches the Firefox 148 UA sent below; webTlsClient uses this tls-client
// profile for the browser TLS fingerprint (same profile as OmniRoute).
const TLS_PROFILE = "firefox_148";
const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

// Captured from a real chatgpt.com browser session.
const OAI_CLIENT_VERSION = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
const OAI_CLIENT_BUILD_NUMBER = "6128297";

// OmniRoute model ID → ChatGPT internal dash-form slug.
const MODEL_MAP = {
  "gpt-5-6-pro": "gpt-5-6-pro",
  "gpt-5-6-thinking": "gpt-5-6-thinking",
  "gpt-5-5-pro": "gpt-5-5-pro",
  "gpt-5-5-pro-extended": "gpt-5-5-pro",
  "gpt-5-5-thinking": "gpt-5-5-thinking",
  "gpt-5-5": "gpt-5-5",
  o3: "o3",
  "gpt-5.6-pro": "gpt-5-6-pro",
  "gpt-5.6-thinking": "gpt-5-6-thinking",
  "gpt-5.5-pro": "gpt-5-5-pro",
  "gpt-5.5-pro-extended": "gpt-5-5-pro",
  "gpt-5.5-thinking": "gpt-5-5-thinking",
  "gpt-5.5": "gpt-5-5",
};

// ─── Browser-like headers ───────────────────────────────────────────────────

function browserHeaders() {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Origin: CHATGPT_BASE,
    Pragma: "no-cache",
    Referer: `${CHATGPT_BASE}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": CHATGPT_USER_AGENT,
  };
}

function oaiHeaders(sessionId, deviceId) {
  return {
    "OAI-Language": "en-US",
    "OAI-Device-Id": deviceId,
    "OAI-Client-Version": OAI_CLIENT_VERSION,
    "OAI-Client-Build-Number": OAI_CLIENT_BUILD_NUMBER,
    "OAI-Session-Id": sessionId,
  };
}

// ─── Per-cookie device id + cache keys ──────────────────────────────────────
// A stable UUID derived from a SHA-256 of the session cookie: each account
// gets its own device id that doesn't change between requests. Output is a
// cache key, not a password hash.

const deviceIdCache = new Map();

function deviceIdFor(cookie) {
  let id = deviceIdCache.get(cookie);
  if (!id) {
    const h = createHash("sha256").update(cookie).digest("hex"); // lgtm[js/insufficient-password-hash]
    id =
      `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-` +
      `${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-` +
      h.slice(20, 32);
    if (deviceIdCache.size >= 200) {
      deviceIdCache.delete(deviceIdCache.keys().next().value);
    }
    deviceIdCache.set(cookie, id);
  }
  return id;
}

function cookieKey(cookie) {
  return createHash("sha256").update(cookie).digest("hex").slice(0, 16); // lgtm[js/insufficient-password-hash]
}

// ─── Session-token family handling ──────────────────────────────────────────

const SESSION_TOKEN_FAMILY_RE = /^__Secure-next-auth\.session-token(?:\.\d+)?$/;

/**
 * Build the Cookie header value from whatever the user pasted.
 *
 * Accepts:
 *   - A bare value:                       "eyJhbGc..."  →  prepended with __Secure-next-auth.session-token=
 *   - An unchunked cookie line:           "__Secure-next-auth.session-token=eyJ..."
 *   - A chunked cookie line:              "__Secure-next-auth.session-token.0=...; __Secure-next-auth.session-token.1=..."
 *   - The full DevTools cookie header:    "Cookie: __Secure-next-auth.session-token.0=...; cf_clearance=..."
 */
function buildSessionCookieHeader(rawInput) {
  let s = String(rawInput ?? "").trim();
  if (/^cookie\s*:\s*/i.test(s)) s = s.replace(/^cookie\s*:\s*/i, "");
  if (/__Secure-next-auth\.session-token(?:\.\d+)?\s*=/.test(s)) {
    return s;
  }
  return `__Secure-next-auth.session-token=${s}`;
}

/**
 * Merge any rotated session-token chunks from a Set-Cookie response into the
 * original cookie blob, preserving every other pasted cookie (cf_clearance,
 * __cf_bm, ...). Returns null if no rotation occurred or nothing changed.
 */
function mergeRefreshedCookie(originalCookie, setCookieHeader) {
  if (!setCookieHeader) return null;
  const matches = Array.from(
    setCookieHeader.matchAll(/(__Secure-next-auth\.session-token(?:\.\d+)?)=([^;,\s]+)/g)
  );
  if (matches.length === 0) return null;

  const refreshed = new Map();
  for (const m of matches) refreshed.set(m[1], m[2]);

  let blob = originalCookie.trim();
  if (/^cookie\s*:\s*/i.test(blob)) blob = blob.replace(/^cookie\s*:\s*/i, "");

  // Bare value (no `=`): the original was just the session-token contents.
  if (!/=/.test(blob)) {
    return Array.from(refreshed, ([k, v]) => `${k}=${v}`).join("; ");
  }

  const pairs = blob.split(/;\s*/).filter(Boolean);
  const result = [];
  let mutated = false;
  let droppedStale = false;
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) {
      result.push(pair);
      continue;
    }
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1);
    if (SESSION_TOKEN_FAMILY_RE.test(name)) {
      if (!refreshed.has(name) || refreshed.get(name) !== value) mutated = true;
      droppedStale = true;
      continue;
    }
    result.push(`${name}=${value}`);
  }
  for (const [name, value] of refreshed) {
    result.push(`${name}=${value}`);
  }
  if (!droppedStale) mutated = true;
  return mutated ? result.join("; ") : null;
}

// ─── Session token cache ────────────────────────────────────────────────────

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5min — accessTokens are short-lived
const TOKEN_CACHE_MAX = 200;
const tokenCache = new Map();

function tokenLookup(cookie) {
  const entry = tokenCache.get(cookieKey(cookie));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    tokenCache.delete(cookieKey(cookie));
    return null;
  }
  return entry;
}

function tokenStore(cookie, entry) {
  if (tokenCache.size >= TOKEN_CACHE_MAX && !tokenCache.has(cookieKey(cookie))) {
    tokenCache.delete(tokenCache.keys().next().value);
  }
  tokenCache.set(cookieKey(cookie), entry);
}

class SessionAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionAuthError";
  }
}

async function exchangeSession(cookie, signal, proxyOptions) {
  const cached = tokenLookup(cookie);
  if (cached) return cached;

  const headers = {
    ...browserHeaders(),
    Accept: "application/json",
    Cookie: buildSessionCookieHeader(cookie),
  };

  const response = await webTlsFetch(SESSION_URL, {
    method: "GET",
    headers,
    timeoutMs: 30_000,
    signal,
    profile: TLS_PROFILE,
    proxyOptions,
  });

  if (response.status === 401 || response.status === 403) {
    throw new SessionAuthError("Invalid session cookie");
  }
  if (response.status >= 400) {
    throw new Error(`Session exchange failed (HTTP ${response.status})`);
  }

  const refreshed = mergeRefreshedCookie(cookie, response.headers.get("set-cookie"));
  let data = {};
  try {
    data = JSON.parse(response.text || "{}");
  } catch {
    /* empty body or non-JSON */
  }
  if (!data.accessToken) {
    throw new SessionAuthError("Session response missing accessToken — cookie likely expired");
  }

  const expiresAt = data.expires ? new Date(data.expires).getTime() : Date.now() + TOKEN_TTL_MS;
  const entry = {
    accessToken: data.accessToken,
    accountId: data.user?.id ?? null,
    expiresAt: Math.min(expiresAt, Date.now() + TOKEN_TTL_MS),
    refreshedCookie: refreshed ?? undefined,
  };
  tokenStore(cookie, entry);
  return entry;
}

// ─── DPL / script-src cache ─────────────────────────────────────────────────
// Sentinel's prekey check inspects whether config[5]/config[6] reference a real
// chatgpt.com deployment (DPL hash + a script URL from the HTML).

let dplCache = null;
const DPL_TTL_MS = 60 * 60 * 1000;

async function fetchDpl(cookie, signal, proxyOptions) {
  if (dplCache && Date.now() < dplCache.expiresAt) {
    return { dpl: dplCache.dpl, scriptSrc: dplCache.scriptSrc };
  }
  const headers = {
    ...browserHeaders(),
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    Cookie: buildSessionCookieHeader(cookie),
  };
  const response = await webTlsFetch(`${CHATGPT_BASE}/`, {
    method: "GET",
    headers,
    timeoutMs: 20_000,
    signal,
    profile: TLS_PROFILE,
    proxyOptions,
  });
  const html = response.text || "";
  const dplMatch = html.match(/data-build="([^"]+)"/);
  const dpl = dplMatch ? `dpl=${dplMatch[1]}` : `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`;
  const scriptMatch = html.match(/<script[^>]+src="(https?:\/\/[^"]*\.js[^"]*)"/);
  const scriptSrc =
    scriptMatch?.[1] ?? `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`;
  dplCache = { dpl, scriptSrc, expiresAt: Date.now() + DPL_TTL_MS };
  return { dpl, scriptSrc };
}

function randomHex(n) {
  return randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n);
}

// ─── Browser fingerprint key lists (prekey config[10..12]) ─────────────────
// The unicode MINUS SIGN (U+2212) matches what real browsers produce via
// Object.toString() — Sentinel checks for it.

const NAVIGATOR_KEYS = [
  "webdriver\u2212false",
  "geolocation",
  "languages",
  "language",
  "platform",
  "userAgent",
  "vendor",
  "hardwareConcurrency",
  "deviceMemory",
  "permissions",
  "plugins",
  "mediaDevices",
];

const DOCUMENT_KEYS = [
  "_reactListeningkfj3eavmks",
  "_reactListeningo743lnnpvdg",
  "location",
  "scrollingElement",
  "documentElement",
];

const WINDOW_KEYS = [
  "webpackChunk_N_E",
  "__NEXT_DATA__",
  "chrome",
  "history",
  "screen",
  "navigation",
  "scrollX",
  "scrollY",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPrekeyConfig(userAgent, dpl, scriptSrc) {
  const screenSizes = [3000, 4000, 3120, 4160];
  const cores = [8, 16, 24, 32];
  const dateStr = new Date().toString();
  const perfNow = performance.now();
  const epochOffset = Date.now() - perfNow;

  return [
    pick(screenSizes),
    dateStr,
    4294705152,
    0, // mutated by solver
    userAgent,
    scriptSrc,
    dpl,
    "en-US",
    "en-US,en",
    0, // mutated by solver
    pick(NAVIGATOR_KEYS),
    pick(DOCUMENT_KEYS),
    pick(WINDOW_KEYS),
    perfNow,
    randomUUID(),
    "",
    pick(cores),
    epochOffset,
  ];
}

// ─── Proof-of-work solver ───────────────────────────────────────────────────
// The browser sends a base64-encoded JSON config; the server combines it with
// a seed and expects a SHA3-512 hash whose hex-prefix is ≤ the difficulty.
// Node's OpenSSL provides sha3-512 natively (verified at runtime).

const POW_YIELD_EVERY = 1000;

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function sha3_512Hex(input) {
  return createHash("sha3-512").update(input, "utf8").digest("hex");
}

async function solvePow({ config, seed, target, prefix, maxIter, label, log }) {
  const cfg = [...config];
  for (let i = 0; i < maxIter; i++) {
    if (i > 0 && i % POW_YIELD_EVERY === 0) await yieldToEventLoop();
    cfg[3] = i;
    const json = JSON.stringify(cfg);
    const b64 = Buffer.from(json).toString("base64");
    const hash = sha3_512Hex(seed + b64);
    if (target && hash.slice(0, target.length) <= target) {
      return `${prefix}${b64}`;
    }
  }
  log?.warn?.(
    "CGPT-WEB",
    `PoW (${label}) exhausted ${maxIter} iterations against target=${target || "<empty>"}; submitting unsolved token (Sentinel may reject)`
  );
  const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64");
  return `${prefix}${b64}`;
}

async function buildPrepareToken(config, log) {
  return solvePow({
    config,
    seed: "",
    target: "0fffff",
    prefix: "gAAAAAC",
    maxIter: 100_000,
    label: "prepare",
    log,
  });
}

async function solveProofOfWork(seed, difficulty, config, log) {
  return solvePow({
    config,
    seed,
    target: (difficulty || "").toLowerCase(),
    prefix: "gAAAAAB",
    maxIter: 500_000,
    label: "conversation",
    log,
  });
}

// ─── Sentinel chat-requirements ─────────────────────────────────────────────

class SentinelBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "SentinelBlockedError";
  }
}

async function prepareChatRequirements(
  { accessToken, accountId, sessionId, deviceId, cookie },
  dplInfo,
  signal,
  proxyOptions,
  log
) {
  const config = buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
  const prekey = await buildPrepareToken(config, log);

  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(sessionId, deviceId),
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: buildSessionCookieHeader(cookie),
    Priority: "u=1, i",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  // Stage 1: POST /chat-requirements/prepare → { prepare_token, ... }
  const prepResp = await webTlsFetch(SENTINEL_PREPARE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ p: prekey }),
    timeoutMs: 30_000,
    signal,
    profile: TLS_PROFILE,
    proxyOptions,
  });
  if (prepResp.status === 401 || prepResp.status === 403) {
    throw new SentinelBlockedError(`Sentinel /prepare blocked (HTTP ${prepResp.status})`);
  }
  if (prepResp.status >= 400) {
    throw new Error(`Sentinel /prepare failed (HTTP ${prepResp.status})`);
  }
  let prepData = {};
  try {
    prepData = JSON.parse(prepResp.text || "{}");
  } catch {
    /* keep empty */
  }
  if (!prepData.prepare_token) {
    return prepData; // pass through whatever we got — caller handles missing fields
  }

  // Stage 2: POST /chat-requirements with the prepare_token in the body.
  const crBody = JSON.stringify({ p: prekey, prepare_token: prepData.prepare_token });
  const crResp = await webTlsFetch(SENTINEL_CR_URL, {
    method: "POST",
    headers,
    body: crBody,
    timeoutMs: 30_000,
    signal,
    profile: TLS_PROFILE,
    proxyOptions,
  });
  if (crResp.status === 401 || crResp.status === 403) {
    throw new SentinelBlockedError(`Sentinel /chat-requirements blocked (HTTP ${crResp.status})`);
  }
  if (crResp.status >= 400) {
    return prepData; // some accounts may not need stage 2
  }
  try {
    const crData = JSON.parse(crResp.text || "{}");
    return { ...crData, prepare_token: prepData.prepare_token };
  } catch {
    return prepData;
  }
}

// ─── OpenAI → ChatGPT message translation (text-only) ───────────────────────

/**
 * Text-only parse: rejects image/audio/file/tool content parts and tool/function
 * roles with a clear error instead of silently dropping them.
 */
function extractMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error("chatgpt-web only supports text message content");
  }
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("chatgpt-web only supports text message content");
    }
    const type = String(item.type || "");
    if (type === "text" || type === "input_text") {
      if (typeof item.text === "string") parts.push(item.text);
    } else {
      throw new Error(`chatgpt-web does not support ${type || "unknown"} message content`);
    }
  }
  return parts.join(" ");
}

/**
 * Fold text-only OpenAI history: system/developer → systemMsg, user/assistant →
 * history, last user message → currentMsg. Any tool involvement is rejected.
 */
function parseOpenAIMessages(messages) {
  let systemMsg = "";
  const history = [];
  for (const msg of messages) {
    if (msg.role === "tool" || msg.role === "function") {
      throw new Error("chatgpt-web does not support tool result messages");
    }
    if (msg.tool_calls !== undefined) {
      throw new Error("chatgpt-web does not support assistant tool calls");
    }
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";
    const content = extractMessageText(msg.content);
    if (!content.trim()) continue;

    if (role === "system") {
      systemMsg += (systemMsg ? "\n" : "") + content;
    } else if (role === "user" || role === "assistant") {
      history.push({ role, content });
    } else {
      throw new Error(`chatgpt-web does not support message role ${role}`);
    }
  }

  let currentMsg = "";
  if (history.length > 0 && history[history.length - 1].role === "user") {
    currentMsg = history.pop().content;
  }
  return { systemMsg, history, currentMsg };
}

/**
 * Build the conversation request body. Critically, prior turns are folded into
 * the system message and only the current user message is sent as a new turn —
 * sending prior assistant/user messages as separate `messages` entries makes
 * ChatGPT CONTINUE the prior assistant response instead of answering fresh.
 */
function buildConversationBody(parsed, modelSlug, parentMessageId) {
  const systemParts = [];
  if (parsed.systemMsg.trim()) {
    systemParts.push(parsed.systemMsg.trim());
  }
  if (parsed.history.length > 0) {
    const formatted = parsed.history
      .map((h) => `${h.role === "assistant" ? "Assistant" : "User"}: ${h.content}`)
      .join("\n\n");
    systemParts.push(`Prior conversation (for context — answer only the new user message below):\n\n${formatted}`);
  }

  const messages = [];
  if (systemParts.length > 0) {
    messages.push({
      id: randomUUID(),
      author: { role: "system" },
      content: { content_type: "text", parts: [systemParts.join("\n\n")] },
    });
  }
  messages.push({
    id: randomUUID(),
    author: { role: "user" },
    content: { content_type: "text", parts: [parsed.currentMsg || ""] },
  });

  return {
    action: "next",
    messages,
    model: modelSlug,
    conversation_id: null,
    parent_message_id: parentMessageId,
    timezone_offset_min: -new Date().getTimezoneOffset(),
    history_and_training_disabled: true, // Temporary Chat — don't clutter the user's history
    suggestions: [],
    websocket_request_id: randomUUID(),
    conversation_mode: { kind: "primary_assistant" },
    supports_buffering: true,
    force_parallel_switch: "auto",
    paragen_cot_summary_display_override: "allow",
  };
}

// ─── ChatGPT SSE parsing ────────────────────────────────────────────────────

async function* readChatGptSseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let eventName = null;

  function flush() {
    if (dataLines.length === 0) {
      eventName = null;
      return null;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    const sseEventName = eventName;
    eventName = null;
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return "done";
    try {
      const parsed = JSON.parse(trimmed);
      if (sseEventName && !parsed.type) parsed.type = sseEventName;
      return parsed;
    } catch {
      return null;
    }
  }

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (line === "") {
          const parsed = flush();
          if (parsed === "done") return;
          if (parsed) yield parsed;
          continue;
        }
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().startsWith("data:")) {
      dataLines.push(buffer.trim().slice(5).trimStart());
    }
    const tail = flush();
    if (tail && tail !== "done") yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extract text deltas from the ChatGPT SSE stream. Events carry CUMULATIVE
 * content (`parts[0]` grows), so we diff against the emitted length. Only emit
 * deltas after the current message enters `in_progress` — echoed prior turns
 * (already-finished messages) get suppressed so streaming clients don't see
 * the previous answer prepended to the new one.
 */
async function* extractContent(eventStream, signal) {
  let currentId = null;
  let currentParts = "";
  let emittedLen = 0;
  let isLive = false;

  for await (const event of readChatGptSseEvents(eventStream, signal)) {
    if (event.error) {
      const msg =
        typeof event.error === "string"
          ? event.error
          : event.error?.message || "ChatGPT stream error";
      yield { error: msg, done: true };
      return;
    }

    const m = event.message;
    if (!m || m.author?.role !== "assistant") continue;

    const id = m.id ?? null;
    const status = m.status ?? "";

    if (id && id !== currentId) {
      currentId = id;
      currentParts = "";
      emittedLen = 0;
      isLive = false;
    }
    if (status === "in_progress") {
      isLive = true;
    }

    const parts = m.content?.parts ?? [];
    if (parts.length === 0) continue;
    const cumulative = parts.map((p) => (typeof p === "string" ? p : "")).join("");
    if (cumulative.length > currentParts.length) {
      currentParts = cumulative;
    }

    if (isLive && currentParts.length > emittedLen) {
      const delta = currentParts.slice(emittedLen);
      emittedLen = currentParts.length;
      yield { delta, answer: currentParts };
    }
  }

  // End-of-stream fallback: single-event reply (cached/instant response) never
  // passed through in_progress — emit accumulated content so it's not empty.
  if (!isLive && currentParts.length > emittedLen) {
    yield { delta: currentParts.slice(emittedLen), answer: currentParts };
  }

  yield { done: true };
}

// ─── Citation-marker cleanup ────────────────────────────────────────────────
// Strip ChatGPT's internal entity/citation markup. API clients need plain text,
// not private-use UI tokens.

const ENTITY_RE = /entity\["[^"]*","([^"]*)"[^\]]*\]/g;
const CHATGPT_REF_TOKEN_RE = /turn\d+(?:search|product|news|image|webpage)\d+/g;

function cleanChatGptText(text) {
  return text
    .replace(ENTITY_RE, "$1")
    .replace(/\uE200cite((?:\uE202[^\uE201\uE202]+)+)\uE201/gu, "")
    .replace(/\uE200url\uE202([^\uE201\uE202]+)\uE202(https?:\/\/[^\uE201]+)\uE201/gu, (_all, label, url) => `[${label}](${url})`)
    .replace(/\uE200url\uE202([^\uE201\uE202]+)\uE202(?:[^\uE201]*\uE201)?/gu, (_all, label) => label.trim())
    .replace(/\uE200cite(?:\uE202[^\uE201\uE202]*)*$/gu, "")
    .replace(/\uE200[a-z_]+(?:\uE202[^\uE201\uE202]*)*\uE201/giu, "")
    .replace(/\uE200[a-z_]+(?:\uE202[^\uE201\uE202]*)*$/giu, "")
    .replace(/\uE202?turn\d+(?:search|product|news|image|webpage)\d+\uE201?/gu, "")
    .replace(/[\uE200\uE201\uE202]/gu, "")
    .replace(CHATGPT_REF_TOKEN_RE, "");
}

// ─── OpenAI output builders ─────────────────────────────────────────────────

function buildStreamingResponse(eventStream, model, cid, created, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let emittedText = "";
      const emitRenderedDelta = (content) => {
        if (!content) return;
        emittedText += content;
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: { content }, finish_reason: null, logprobs: null }],
            })
          )
        );
      };
      // The upstream answer is cumulative; clean it, diff against what we
      // already emitted, and only push the new slice.
      const emitRenderedAnswer = (rawText) => {
        const rendered = cleanChatGptText(rawText);
        if (!rendered || rendered.length <= emittedText.length) return;
        if (!rendered.startsWith(emittedText)) return; // protect against rewrites
        emitRenderedDelta(rendered.slice(emittedText.length));
      };

      try {
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                { index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null },
              ],
            })
          )
        );

        for await (const chunk of extractContent(eventStream, signal)) {
          if (chunk.error) {
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content: `[Error: ${chunk.error}]` },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
              )
            );
            break;
          }
          if (chunk.done) break;
          if (chunk.answer) emitRenderedAnswer(chunk.answer);
        }

        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: { content: `[Stream error: ${err instanceof Error ? err.message : String(err)}]` },
                  finish_reason: "stop",
                  logprobs: null,
                },
              ],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}

async function buildNonStreamingResponse(eventStream, model, cid, created, signal, promptChars) {
  let fullAnswer = "";
  for await (const chunk of extractContent(eventStream, signal)) {
    if (chunk.error) {
      return new Response(
        JSON.stringify({
          error: { message: chunk.error, type: "upstream_error", code: "CHATGPT_ERROR" },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    if (chunk.done) break;
    if (chunk.answer) fullAnswer = chunk.answer; // cumulative — last one wins
  }

  fullAnswer = cleanChatGptText(fullAnswer);
  const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
  const completionTokens = Math.ceil(fullAnswer.length / 4);

  return new Response(
    JSON.stringify({
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: fullAnswer },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ─── Error helpers ──────────────────────────────────────────────────────────

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({
      error: { message, type: "upstream_error", ...(code ? { code } : {}) },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

const CGPT_WEB_HTTP_ERROR_MESSAGES = {
  401: "ChatGPT auth failed — session may have expired. Re-paste your __Secure-next-auth.session-token.",
  403: "ChatGPT auth failed — session may have expired. Re-paste your __Secure-next-auth.session-token.",
  404: "ChatGPT returned 404 — usually the model is no longer available on this account or the chat-requirements-token expired. Retry will start a fresh conversation.",
  413: "ChatGPT returned 413 — the request payload is too large for ChatGPT web's size limit. Reduce the context or use a smaller request.",
  429: "ChatGPT rate limited. Wait a moment and retry.",
};

function describeChatGptWebHttpError(status) {
  return CGPT_WEB_HTTP_ERROR_MESSAGES[status] ?? `ChatGPT returned HTTP ${status}`;
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class ChatGptWebExecutor extends BaseExecutor {
  constructor() {
    super("chatgpt-web", { id: "chatgpt-web", baseUrl: CONV_URL });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const bodyObj = body || {};
    const messages = bodyObj.messages;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Text-only: reject tools / functions explicitly (no tool emulation).
    const tools = bodyObj.tools;
    const functions = bodyObj.functions;
    if (
      (Array.isArray(tools) && tools.length > 0) ||
      (Array.isArray(functions) && functions.length > 0)
    ) {
      return {
        response: errorResponse(400, "chatgpt-web does not support function tools"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    let parsed;
    try {
      parsed = parseOpenAIMessages(messages);
    } catch (err) {
      return {
        response: errorResponse(400, err instanceof Error ? err.message : String(err)),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }
    if (!parsed.currentMsg.trim() && parsed.history.length === 0) {
      return {
        response: errorResponse(400, "Empty user message"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const cookie = credentials?.apiKey;
    if (!cookie) {
      return {
        response: errorResponse(
          401,
          "ChatGPT auth failed — paste your __Secure-next-auth.session-token cookie value."
        ),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const modelSlug = MODEL_MAP[model] || model;
    const sessionId = randomUUID();
    const turnTraceId = randomUUID();
    const deviceId = deviceIdFor(cookie);

    let tokenEntry;
    try {
      tokenEntry = await exchangeSession(cookie, signal, proxyOptions);
    } catch (err) {
      if (err instanceof WebTlsClientUnavailableError) {
        return {
          response: errorResponse(
            503,
            `ChatGPT web transport unavailable: ${err.message}`,
            "TLS_UNAVAILABLE"
          ),
          url: SESSION_URL,
          headers: {},
          transformedBody: body,
        };
      }
      if (err instanceof SessionAuthError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(
            401,
            "ChatGPT auth failed — re-paste your __Secure-next-auth.session-token cookie from chatgpt.com.",
            "HTTP_401"
          ),
          url: SESSION_URL,
          headers: {},
          transformedBody: body,
        };
      }
      log?.error?.(
        "CGPT-WEB",
        `Session exchange failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        response: errorResponse(
          502,
          `ChatGPT session exchange failed: ${err instanceof Error ? err.message : String(err)}`
        ),
        url: SESSION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Use a rotated cookie for the rest of this request if the exchange returned one.
    const effectiveCookie = tokenEntry.refreshedCookie || cookie;

    // DPL + script src so the sentinel prekey looks legit.
    let dplInfo;
    try {
      dplInfo = await fetchDpl(effectiveCookie, signal, proxyOptions);
    } catch (err) {
      log?.warn?.(
        "CGPT-WEB",
        `DPL warmup failed (continuing with fallback): ${err instanceof Error ? err.message : String(err)}`
      );
      dplInfo = {
        dpl: `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`,
        scriptSrc: `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`,
      };
    }

    // Sentinel chat-requirements.
    let reqs;
    try {
      reqs = await prepareChatRequirements(
        {
          accessToken: tokenEntry.accessToken,
          accountId: tokenEntry.accountId,
          sessionId,
          deviceId,
          cookie: effectiveCookie,
        },
        dplInfo,
        signal,
        proxyOptions,
        log
      );
    } catch (err) {
      if (err instanceof WebTlsClientUnavailableError) {
        return {
          response: errorResponse(
            503,
            `ChatGPT web transport unavailable: ${err.message}`,
            "TLS_UNAVAILABLE"
          ),
          url: SENTINEL_PREPARE_URL,
          headers: {},
          transformedBody: body,
        };
      }
      if (err instanceof SentinelBlockedError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(
            403,
            "ChatGPT blocked the request (Sentinel/Turnstile required). Try again later or open chatgpt.com in a browser to refresh state.",
            "SENTINEL_BLOCKED"
          ),
          url: SENTINEL_PREPARE_URL,
          headers: {},
          transformedBody: body,
        };
      }
      log?.error?.(
        "CGPT-WEB",
        `Sentinel failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        response: errorResponse(
          502,
          `ChatGPT sentinel failed: ${err instanceof Error ? err.message : String(err)}`
        ),
        url: SENTINEL_PREPARE_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Solve PoW when required.
    let proofToken = null;
    if (reqs.proofofwork?.required && reqs.proofofwork.seed && reqs.proofofwork.difficulty) {
      const powConfig = buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
      proofToken = await solveProofOfWork(
        reqs.proofofwork.seed,
        reqs.proofofwork.difficulty,
        powConfig,
        log
      );
    }

    const parentMessageId = randomUUID();
    const cgptBody = buildConversationBody(parsed, modelSlug, parentMessageId);

    const headers = {
      ...browserHeaders(),
      ...oaiHeaders(sessionId, deviceId),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${tokenEntry.accessToken}`,
      Cookie: buildSessionCookieHeader(effectiveCookie),
      "x-oai-turn-trace-id": turnTraceId,
    };
    if (tokenEntry.accountId) headers["chatgpt-account-id"] = tokenEntry.accountId;
    if (reqs.token) headers["openai-sentinel-chat-requirements-token"] = reqs.token;
    if (reqs.prepare_token)
      headers["openai-sentinel-chat-requirements-prepare-token"] = reqs.prepare_token;
    if (proofToken) headers["openai-sentinel-proof-token"] = proofToken;

    log?.info?.(
      "CGPT-WEB",
      `Conversation request → ${modelSlug} (pow=${!!proofToken}, stream=${stream !== false})`
    );

    let response;
    try {
      response = await webTlsFetch(CONV_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(cgptBody),
        timeoutMs: 120_000, // generations can take a while
        signal,
        profile: TLS_PROFILE,
        proxyOptions,
      });
    } catch (err) {
      log?.error?.("CGPT-WEB", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      const code = err instanceof WebTlsClientUnavailableError ? "TLS_UNAVAILABLE" : undefined;
      return {
        response: errorResponse(
          err instanceof WebTlsClientUnavailableError ? 503 : 502,
          `ChatGPT connection failed: ${err instanceof Error ? err.message : String(err)}`,
          code
        ),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    if (response.status >= 400) {
      const status = response.status;
      log?.warn?.("CGPT-WEB", `conv ${status}: ${(response.text || "").slice(0, 400)}`);
      if (status === 401 || status === 403) {
        tokenCache.delete(cookieKey(cookie));
      }
      const errMsg = describeChatGptWebHttpError(status);
      log?.warn?.("CGPT-WEB", errMsg);
      return {
        response: errorResponse(status, errMsg, `HTTP_${status}`),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    if (!response.text) {
      return {
        response: errorResponse(502, "ChatGPT returned empty response body"),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    // webTlsClient returns the full body as text — wrap it in a one-shot stream
    // so the SSE parser consumes it uniformly for both stream and non-stream.
    const bodyStream = stringToStream(response.text);
    const cid = `chatcmpl-cgpt-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const promptChars =
      parsed.systemMsg.length + parsed.currentMsg.length +
      parsed.history.reduce((n, h) => n + h.content.length, 0);

    let finalResponse;
    if (stream) {
      finalResponse = new Response(buildStreamingResponse(bodyStream, model, cid, created, signal), {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(
        bodyStream,
        model,
        cid,
        created,
        signal,
        promptChars
      );
    }

    return { response: finalResponse, url: CONV_URL, headers, transformedBody: cgptBody };
  }
}

function stringToStream(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

export default ChatGptWebExecutor;
