// notion-web.js — Notion AI Web session executor (minimal port of OmniRoute's).
//
// Notion AI has no public inference API. This executor posts to the same
// cookie-authenticated internal endpoint open-source bridges use:
//   POST https://app.notion.com/api/v3/runInferenceTranscript
// with a `token_v2` session cookie (optionally space_id / notion_user_id /
// notion_browser_id from the pasted cookie header).
//
// Minimal by design (differs from OmniRoute):
//   - No thread continuity cache: every request mints a fresh Notion chat
//     (createThread:true + new threadId), so multi-turn OpenAI history maps to
//     one request transcript.
//   - No custom agents (workflowId). Model → food-codename mapping is static;
//     getAvailableModels is used only to select the correct workspace.
//   - Workspace resolution: space_id from the cookie when present, otherwise
//     probe visible spaces and select one where the requested model is enabled.
//   - Text-only: tools / images / attachments are rejected with a clear 400.
//   - Transport is the shared webTlsClient.js (Chrome JA3) ONLY. There is no
//     native-fetch fallback: when tls-client-node is missing, a clear 502 tells
//     the operator exactly what to install.
//
// The response is NDJSON patch-start / patch / record-map. We read the full
// body, parse it, and emit one OpenAI SSE chunk (pseudo-streaming) — safer
// than assuming unverified incremental-delta semantics.
import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { errorResponse } from "../utils/error.js";
import {
  webTlsFetch,
  WebTlsClientUnavailableError,
} from "../services/webTlsClient.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "https://app.notion.com";
const NOTION_URL = `${BASE_URL}/api/v3/runInferenceTranscript`;
const NOTION_SPACES_URL = `${BASE_URL}/api/v3/getSpaces`;
const NOTION_MODELS_URL = `${BASE_URL}/api/v3/getAvailableModels`;
const NOTION_MAX_SPACE_PROBE = 8;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const NOTION_CLIENT_VERSION = "23.13.20260720.1949";
const NOTION_TLS_PROFILE = "chrome_146"; // matches the Chrome UA we send
const NOTION_TIMEOUT_MS =
  Number.parseInt(process.env.DARDCOR_NOTION_TLS_TIMEOUT_MS || "", 10) || 180_000;

// Browser fingerprint headers — make requests look like real Chromium.
const BROWSER_HEADERS = {
  "sec-ch-ua": '"Chromium";v="149", "Not)A;Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  priority: "u=1, i",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

// Static model mapping: friendly picker slugs → Notion food codenames the
// runInferenceTranscript API actually accepts. Seeded from OmniRoute's
// NOTION_WEB_FALLBACK_MODELS (live picker, 2026-07). Unknown ids pass through
// as-is so a freshly seen codename still works.
const NOTION_MODEL_CODENAMES = {
  "gpt-5.6-sol": "orange-mousse",
  "gpt-5.6-terra": "orchid-muffin",
  "gpt-5.6-luna": "olive-jellyroll",
  "gpt-5.2": "oatmeal-cookie",
  "gpt-5.4": "oval-kumquat-medium",
  "gpt-5.5": "opal-quince-medium",
  "gpt-5.4-mini": "oregon-grape-medium",
  "gpt-5.4-nano": "otaheite-apple-medium",
  "gemini-3.5-flash": "vertex-gemini-3.5-flash",
  "gemini-3-flash": "gingerbread",
  "gemini-3.1-pro": "galette-medium-thinking",
  "sonnet-4.6": "almond-croissant-low",
  "sonnet-5": "angel-cake-high",
  "opus-4.6": "avocado-froyo-medium",
  "opus-4.7": "apricot-sorbet-high",
  "opus-4.8": "ambrosia-tart-high",
  "haiku-4.5": "anthropic-haiku-4.5",
  "fable-5": "acai-budino-high",
  "kimi-k2.6": "fireworks-kimi-k2.6",
  "kimi-k2.7-code": "fireworks-kimi-k2.7",
  "deepseek-v4-pro": "baseten-deepseek-v4-pro",
  "glm-5.2": "baseten-glm-5.2",
  "grok-4.3": "xigua-mochi-medium",
  "grok-4.5": "strawberry-whoopiepie",
  "grok-build-0.1": "xinomavro-cake",
};

// ─── Helpers — credential / cookie ──────────────────────────────────────────

function readString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function readProviderSpecificString(providerSpecificData, keys) {
  if (!providerSpecificData || typeof providerSpecificData !== "object") return "";
  for (const key of keys) {
    const value = readString(providerSpecificData[key]);
    if (value) return value;
  }
  return "";
}

/** Normalize a pasted credential to a `name=value` cookie pair. Accepts a bare
 * token or an already-prefixed `token_v2=...` value. */
export function normalizeNotionCookieInput(raw, cookieName = "token_v2") {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  return trimmed.includes("=") ? trimmed : `${cookieName}=${trimmed}`;
}

/** Read `name=value` from a cookie header (case-insensitive name). */
export function readNotionCookieValue(cookie, name) {
  if (!cookie || !name) return "";
  const re = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`, "i");
  const m = cookie.match(re);
  if (!m) return "";
  const raw = m[1].trim();
  // Malformed % sequences in cookie values must not throw.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Resolve the Cookie header to send upstream. Accepts, in priority order:
 * 1. `credentials.apiKey` — a bare token_v2 value, `token_v2=...` pair, or full
 *    Cookie header.
 * 2. `credentials.providerSpecificData.cookie` (full header).
 * 3. Structured `providerSpecificData` fields (token_v2 + optional space_id /
 *    notion_user_id / notion_browser_id) assembled into a cookie header.
 * Optional space_id / notion_browser_id from a pasted cookie are preserved
 * verbatim. NEVER log the returned cookie.
 */
export function resolveNotionWebCookie(credentials) {
  const apiKey = readString(credentials?.apiKey);
  if (apiKey) return normalizeNotionCookieInput(apiKey);

  const ps = credentials?.providerSpecificData;
  const directCookie = readProviderSpecificString(ps, ["cookie"]);
  if (directCookie) return normalizeNotionCookieInput(directCookie);

  const tokenV2 = readProviderSpecificString(ps, ["token_v2", "tokenV2"]);
  const spaceId = readProviderSpecificString(ps, ["space_id", "spaceId"]);
  const userId = readProviderSpecificString(ps, [
    "notion_user_id",
    "notionUserId",
    "user_id",
    "userId",
  ]);
  const browserId = readProviderSpecificString(ps, [
    "notion_browser_id",
    "notionBrowserId",
  ]);
  return [
    tokenV2 ? normalizeNotionCookieInput(tokenV2) : "",
    spaceId ? `space_id=${spaceId}` : "",
    userId ? `notion_user_id=${userId}` : "",
    browserId ? `notion_browser_id=${browserId}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function extractNotionSpaceId(cookie) {
  return (
    readNotionCookieValue(cookie, "space_id") ||
    readNotionCookieValue(cookie, "spaceId") ||
    ""
  );
}

export function extractNotionUserId(cookie) {
  return (
    readNotionCookieValue(cookie, "notion_user_id") ||
    readNotionCookieValue(cookie, "notion_user_id_v2") ||
    readNotionCookieValue(cookie, "user_id") ||
    ""
  );
}

// ─── Workspace resolution (getSpaces, only when space_id is missing) ────────

/** Parse getSpaces JSON: `{ [userId]: { space: { [spaceId]: ... } } }`, plus
 * flat `{ spaces: [{id}] }` / `{ spaceIds: [] }` fallbacks. */
export function parseNotionGetSpaces(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { userId: "", spaceIds: [] };
  }
  const root = data;
  const spaceIds = [];
  let userId = "";

  for (const [key, value] of Object.entries(root)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const spaceMap = value.space;
    if (spaceMap && typeof spaceMap === "object" && !Array.isArray(spaceMap)) {
      for (const id of Object.keys(spaceMap)) {
        if (id && !spaceIds.includes(id)) spaceIds.push(id);
      }
      if (!userId && key && !key.includes(" ")) userId = key;
    }
  }

  if (spaceIds.length === 0) {
    if (Array.isArray(root.spaces)) {
      for (const s of root.spaces) {
        if (s && typeof s === "object" && typeof s.id === "string" && s.id) {
          spaceIds.push(s.id);
          break;
        }
      }
    }
    if (Array.isArray(root.spaceIds) && typeof root.spaceIds[0] === "string") {
      spaceIds.push(root.spaceIds[0]);
    }
  }
  return { userId, spaceIds };
}

function buildNotionBrowserHeaders(cookie, spaceId, userId) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Origin: BASE_URL,
    Referer: `${BASE_URL}/ai`,
    "notion-client-version": NOTION_CLIENT_VERSION,
    "notion-audit-log-platform": "web",
    Cookie: cookie,
    ...BROWSER_HEADERS,
  };
  if (spaceId) headers["x-notion-space-id"] = spaceId;
  if (userId) headers["x-notion-active-user-header"] = userId;
  return headers;
}

function scoreNotionWorkspaceModels(data, notionModel) {
  if (!data || typeof data !== "object" || !Array.isArray(data.models)) return -1;
  let enabled = 0;
  let requestedModelEnabled = false;
  for (const row of data.models) {
    if (!row || typeof row !== "object" || row.isDisabled === true) continue;
    const codename = readString(row.model);
    if (!codename) continue;
    enabled += 1;
    if (notionModel && codename === notionModel) requestedModelEnabled = true;
  }
  if (enabled === 0) return -1;
  return enabled + (requestedModelEnabled ? 10_000 : 0);
}

async function selectNotionWorkspace(cookie, userId, spaceIds, notionModel, signal, proxyOptions) {
  let bestSpaceId = "";
  let bestScore = -1;
  for (const spaceId of spaceIds.slice(0, NOTION_MAX_SPACE_PROBE)) {
    try {
      const res = await webTlsFetch(NOTION_MODELS_URL, {
        method: "POST",
        headers: buildNotionBrowserHeaders(cookie, spaceId, userId || undefined),
        body: JSON.stringify({ spaceId }),
        signal: signal ?? undefined,
        timeoutMs: 30_000,
        profile: NOTION_TLS_PROFILE,
        proxyOptions,
      });
      if (res.status < 200 || res.status >= 300) continue;
      const score = scoreNotionWorkspaceModels(JSON.parse(res.text || ""), notionModel);
      if (score > bestScore) {
        bestScore = score;
        bestSpaceId = spaceId;
      }
    } catch (err) {
      if (err instanceof WebTlsClientUnavailableError) throw err;
    }
  }
  return bestSpaceId;
}

/** Resolve { spaceId, userId }. An explicit cookie space wins; token-only
 * credentials probe visible workspaces so inference does not target a personal
 * or plan-locked space merely because getSpaces listed it first. */
export async function resolveNotionWorkspace(cookie, signal, proxyOptions, notionModel = "") {
  const fromCookie = {
    spaceId: extractNotionSpaceId(cookie),
    userId: extractNotionUserId(cookie),
  };
  if (fromCookie.spaceId) return fromCookie;

  try {
    const res = await webTlsFetch(NOTION_SPACES_URL, {
      method: "POST",
      headers: buildNotionBrowserHeaders(cookie, "", fromCookie.userId || undefined),
      body: "{}",
      signal: signal ?? undefined,
      timeoutMs: 30_000,
      profile: NOTION_TLS_PROFILE,
      proxyOptions,
    });
    const text = res.text || "";
    const parsed = parseNotionGetSpaces(JSON.parse(text));
    const userId = fromCookie.userId || parsed.userId;
    const selectedSpaceId = await selectNotionWorkspace(
      cookie,
      userId,
      parsed.spaceIds,
      notionModel,
      signal,
      proxyOptions
    );
    return { spaceId: selectedSpaceId || parsed.spaceIds[0] || "", userId };
  } catch (err) {
    // TLS missing must surface clearly; everything else keeps cookie values.
    if (err instanceof WebTlsClientUnavailableError) throw err;
    return fromCookie;
  }
}

// ─── Model resolution (static mapping) ──────────────────────────────────────

function clientFacingModelId(model) {
  let m = typeof model === "string" ? model.trim() : "";
  if (m.startsWith("notion-web/")) m = m.slice("notion-web/".length);
  else if (m.startsWith("nw/")) m = m.slice(3);
  return m;
}

/** Strip prefixes and map a client model id to the food codename Notion's
 * transcript API expects. Unknown ids pass through as-is. "notion-ai"/empty →
 * "" (default model, no model field on the wire). */
export function resolveNotionCodename(model) {
  const m = clientFacingModelId(model);
  if (!m || m === "notion-ai") return "";
  return NOTION_MODEL_CODENAMES[m] || NOTION_MODEL_CODENAMES[m.toLowerCase()] || m;
}

// ─── Transcript builder (config + context + steps) ─────────────────────────

/** Normalize OpenAI-style message content to plain text. Throws on non-text
 * parts (images/files/tools) — text-only by design. */
export function extractNotionMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part) parts.push(part);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const type = typeof part.type === "string" ? part.type : "";
    if (type === "text" || type === "input_text") {
      if (typeof part.text === "string" && part.text) parts.push(part.text);
      else if (typeof part.content === "string" && part.content) parts.push(part.content);
    } else {
      throw new Error(`notion-web does not support ${type || "non-text"} message content`);
    }
  }
  return parts.join("\n");
}

function buildNotionConfigStep(model) {
  return {
    id: randomUUID(),
    type: "config",
    value: {
      type: "workflow",
      enableAgentAutomations: true,
      enableAgentIntegrations: true,
      enableCustomAgents: true,
      enableScriptAgent: true,
      enableAgentDiffs: true,
      enableCsvAttachmentSupport: true,
      enableComputer: true,
      enableCreateAndRunThread: true,
      enableAgentGenerateImage: true,
      useWebSearch: true,
      searchScopes: [{ type: "everything" }],
      availableConnectors: [],
      enableUserSessionContext: false,
      isCustomAgent: false,
      isCustomAgentBuilder: false,
      isCustomAgentCreate: false,
      isAgentResearchRequest: false,
      useCustomAgentDraft: false,
      modelFromUser: Boolean(model),
      databaseAgentConfigMode: false,
      isOnboardingAgent: false,
      isMobile: false,
      ...(model ? { model } : {}),
    },
  };
}

function buildNotionContextValue(opts) {
  const contextValue = {
    timezone: "UTC",
    surface: "ai_module",
    currentDatetime: new Date().toISOString(),
  };
  if (opts.spaceId) contextValue.spaceId = opts.spaceId;
  if (opts.userId) contextValue.userId = opts.userId;
  return contextValue;
}

function buildNotionMessageStep(m, contextValue, opts) {
  const text = extractNotionMessageText(m.content);
  if (!text || text.length === 0) return null;
  const role = String(m.role || "").toLowerCase();

  if (role === "system") {
    const existing = typeof contextValue.instructions === "string" ? contextValue.instructions : "";
    contextValue.instructions = existing ? `${existing}\n${text}` : text;
    return null;
  }

  if (role === "assistant" || role === "ai" || role === "model") {
    return {
      id: randomUUID(),
      type: "agent-inference",
      value: [{ type: "text", content: text }],
    };
  }

  const userStep = {
    id: randomUUID(),
    type: "user",
    value: [[text]],
    createdAt: opts.now,
  };
  if (opts.userId) userStep.userId = opts.userId;
  return userStep;
}

export function buildNotionTranscript(messages, opts = {}) {
  const model = typeof opts.notionModel === "string" ? opts.notionModel.trim() : "";
  const now = new Date().toISOString();
  const contextValue = buildNotionContextValue({
    spaceId: opts.spaceId,
    userId: opts.userId,
    now,
  });
  const entries = [
    buildNotionConfigStep(model),
    { id: randomUUID(), type: "context", value: contextValue },
  ];
  for (const m of messages) {
    const step = buildNotionMessageStep(m, contextValue, { userId: opts.userId, now });
    if (step) entries.push(step);
  }
  return entries;
}

// ─── runInferenceTranscript request ─────────────────────────────────────────

function buildNotionInferenceRequestBody(opts) {
  // Minimal: every request is a fresh Notion chat (no thread continuity cache).
  return {
    traceId: randomUUID(),
    spaceId: opts.spaceId,
    threadId: opts.threadId,
    createThread: true,
    generateTitle: true,
    asPatchResponse: true,
    patchResponseVersion: 2,
    isPartialTranscript: false,
    saveAllThreadOperations: true,
    setUnreadState: true,
    createdSource: "ai_module",
    threadType: "workflow",
    supportsCustomAgentNudgeTranscriptStep: true,
    isUserInAnySalesAssistedSpace: false,
    isSpaceSalesAssisted: false,
    transcript: opts.transcript,
    threadParentPointer: { table: "space", id: opts.spaceId, spaceId: opts.spaceId },
    debugOverrides: {
      annotationInferences: {},
      cachedInferences: {},
      emitAgentSearchExtractedResults: true,
      emitInferences: false,
    },
  };
}

function buildNotionExecuteHeaders(opts) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Accept: "application/x-ndjson",
    Cookie: opts.cookie,
    Origin: BASE_URL,
    Referer: `${BASE_URL}/ai`,
    "notion-client-version": NOTION_CLIENT_VERSION,
    "notion-audit-log-platform": "web",
    "x-notion-space-id": opts.spaceId,
    "Accept-Language": "en-US,en;q=0.9",
    ...BROWSER_HEADERS,
  };
  if (opts.userId) headers["x-notion-active-user-header"] = opts.userId;
  return headers;
}

// ─── NDJSON / patch response parsing ────────────────────────────────────────

function sanitizeNotionAssistantText(text) {
  if (!text) return "";
  let clean = text.replace(/^\uFEFF/, "").trim();
  clean = clean.replace(/<\/?lang\b[^>]*\/?>/gi, "");
  clean = clean.replace(/<\/lang>/gi, "");
  if (/^<lang\b/i.test(clean) && !clean.includes(">")) return "";
  return clean.trim();
}

function extractRichText(value) {
  if (!Array.isArray(value)) return "";
  return value
    .map((segment) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
    .join("");
}

function extractAgentInferenceText(value) {
  if (!Array.isArray(value)) return "";
  const parts = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const type = String(item.type || "").toLowerCase();
    if (type === "text" && typeof item.content === "string" && item.content) {
      parts.push(item.content);
    }
  }
  return parts.join("");
}

function extractThreadMessageStep(msg) {
  if (!msg || typeof msg !== "object") return null;
  const valueWrapper = msg.value;
  if (!valueWrapper || typeof valueWrapper !== "object") return null;
  const inner = valueWrapper.value;
  if (!inner || typeof inner !== "object") return null;
  const step = inner.step;
  if (!step || typeof step !== "object") return null;
  return step;
}

function extractStepText(stepObj) {
  const stepType = typeof stepObj.type === "string" ? stepObj.type : "";
  if (stepType === "agent-inference") return extractAgentInferenceText(stepObj.value);
  if (stepType === "markdown-chat" && typeof stepObj.value === "string") return stepObj.value;
  return "";
}

function extractFromRecordMap(recordMap) {
  if (!recordMap || typeof recordMap !== "object" || Array.isArray(recordMap)) return "";
  const tm = recordMap.thread_message;
  if (!tm || typeof tm !== "object" || Array.isArray(tm)) return "";
  let best = "";
  for (const msg of Object.values(tm)) {
    const stepObj = extractThreadMessageStep(msg);
    if (!stepObj) continue;
    const text = extractStepText(stepObj);
    if (text && text.length >= best.length) best = text;
  }
  return best;
}

function applyNotionStreamRecord(rec, state) {
  const type = typeof rec.type === "string" ? rec.type : "";

  if (type === "markdown-chat" && typeof rec.value === "string" && rec.value) {
    state.lastPatchFinal = rec.value;
    return;
  }
  if (type === "agent-inference") {
    const text = extractAgentInferenceText(rec.value);
    if (text) state.lastPatchFinal = text;
    return;
  }
  if (type === "patch" && Array.isArray(rec.v)) {
    for (const rawOp of rec.v) {
      if (!rawOp || typeof rawOp !== "object") continue;
      const o = typeof rawOp.o === "string" ? rawOp.o : "";
      const p = typeof rawOp.p === "string" ? rawOp.p : "";
      const v = rawOp.v;
      if (o === "a" && p.endsWith("/value/-") && v && typeof v === "object") {
        if (v.type === "text" && typeof v.content === "string" && v.content) {
          state.lastPatchFinal = v.content;
        }
        if (v.type === "markdown-chat" && typeof v.value === "string" && v.value) {
          state.lastPatchFinal = v.value;
        }
      } else if (o === "a" && p.endsWith("/s/-") && v && typeof v === "object") {
        if (v.type === "markdown-chat" && typeof v.value === "string" && v.value) {
          state.lastPatchFinal = v.value;
        }
        if (v.type === "agent-inference") {
          const text = extractAgentInferenceText(v.value);
          if (text) state.lastPatchFinal = text;
        }
      } else if ((o === "x" || o === "p") && p.includes("/value") && typeof v === "string" && v) {
        state.lastIncremental += v;
      }
    }
    return;
  }
  if (type === "record-map" || rec.recordMap) {
    const text = extractFromRecordMap(rec.recordMap || rec);
    if (text) state.lastRecordMap = text;
    return;
  }
  const rich = extractRichText(rec.value);
  if (rich) state.lastLegacy = rich;
}

function applyNotionStreamLine(rawLine, state) {
  const line = rawLine.trim();
  if (!line || line === "[DONE]") return;
  const payloadLine = line.startsWith("data:") ? line.slice(5).trim() : line;
  if (!payloadLine) return;
  let record;
  try {
    record = JSON.parse(payloadLine);
  } catch {
    return;
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) return;
  applyNotionStreamRecord(record, state);
}

/**
 * Parse Notion's NDJSON `runInferenceTranscript` response body. Supports legacy
 * rich-text tuples, patch streams (text / markdown-chat ops), and terminal
 * record-map agent-inference steps. Returns the longest non-empty candidate.
 */
export function parseNotionInferenceStream(raw) {
  if (!raw) return "";
  const state = { lastLegacy: "", lastPatchFinal: "", lastIncremental: "", lastRecordMap: "" };
  for (const rawLine of raw.split("\n")) applyNotionStreamLine(rawLine, state);
  return (
    [state.lastRecordMap, state.lastPatchFinal, state.lastIncremental, state.lastLegacy]
      .map(sanitizeNotionAssistantText)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || ""
  );
}

/** Detect Notion in-band errors (often HTTP 200 with NDJSON/JSON error
 * objects), e.g. `{ type:"error", subType:"temporarily-unavailable", ... }`. */
export function extractNotionUpstreamError(raw) {
  if (!raw || !raw.trim()) return null;
  const tryParse = (s) => {
    try {
      const o = JSON.parse(s);
      return o && typeof o === "object" ? o : null;
    } catch {
      return null;
    }
  };

  const candidates = [];
  const whole = tryParse(raw.trim());
  if (whole) candidates.push(whole);
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const o = tryParse(t);
    if (o) candidates.push(o);
  }

  const flat = [];
  const pushNested = (o) => {
    flat.push(o);
    const data = o.data;
    if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.s)) {
      for (const item of data.s) {
        if (item && typeof item === "object" && !Array.isArray(item)) flat.push(item);
      }
    }
    if (Array.isArray(o.s)) {
      for (const item of o.s) {
        if (item && typeof item === "object" && !Array.isArray(item)) flat.push(item);
      }
    }
  };
  for (const o of candidates) pushNested(o);

  for (const o of flat) {
    const type = typeof o.type === "string" ? o.type.toLowerCase() : "";
    const subType = typeof o.subType === "string" ? o.subType : undefined;
    if (type === "premium-feature-unavailable" || subType === "premium-feature-unavailable") {
      const limit = o.featureAvailability?.limit;
      const current = Number.isFinite(limit?.current) ? limit.current : null;
      const total = Number.isFinite(limit?.total) ? limit.total : null;
      const quota = current !== null && total !== null ? ` (${current}/${total} used)` : "";
      return {
        status: 402,
        message:
          `Notion AI credits are exhausted or unavailable for this workspace${quota}. ` +
          "Wait for the quota reset, upgrade the Notion plan, or use a different workspace cookie.",
        subType: "premium-feature-unavailable",
        isRetryable: false,
      };
    }
    const message =
      (typeof o.message === "string" && o.message) ||
      (typeof o.error === "string" && o.error) ||
      "";
    const isError =
      type === "error" ||
      Boolean(subType) ||
      (typeof o.isRetryable === "boolean" && message.toLowerCase().includes("went wrong"));
    if (!isError && !subType) continue;

    const sub = (subType || "").toLowerCase();
    const retryable =
      o.isRetryable === true ||
      sub.includes("temporarily") ||
      sub.includes("unavailable") ||
      sub.includes("rate") ||
      sub.includes("timeout") ||
      sub.includes("overloaded");

    return { message: message || subType || "Notion upstream error", subType, isRetryable: retryable };
  }
  return null;
}

function summarizeNotionResponseShape(raw) {
  if (!raw) return "empty body";
  const records = new Set();
  const addRecord = (value, prefix = "") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const type = readString(value.type);
    const subType = readString(value.subType);
    const detail = ["feature", "featureType", "reason", "code", "message"]
      .map((key) => readString(value[key]))
      .filter(Boolean)
      .join(":");
    const label = [type, subType, detail].filter(Boolean).join(":");
    records.add(`${prefix}${label || `{${Object.keys(value).sort().join(",")}}`}`);
  };
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim().replace(/^data:\s*/, "");
    if (!line || line === "[DONE]") continue;
    try {
      const record = JSON.parse(line);
      addRecord(record);
      if (Array.isArray(record?.data?.s)) {
        for (const nested of record.data.s) addRecord(nested, "data.s/");
      }
    } catch {
      records.add("non-json");
    }
    if (records.size >= 8) break;
  }
  return `${Buffer.byteLength(raw, "utf8")} bytes; records=${[...records].join("|") || "none"}`;
}

// ─── Output shaping ─────────────────────────────────────────────────────────

/** Notion's API does not return token usage — emit a cheap char-based estimate. */
export function estimateNotionUsage(messages, content) {
  const promptText = (messages || [])
    .map((m) => {
      try {
        return extractNotionMessageText(m?.content);
      } catch {
        return "";
      }
    })
    .join("\n");
  const prompt_tokens = promptText ? Math.max(1, Math.ceil(promptText.length / 4)) : 0;
  const completion_tokens = content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
    estimated: true,
  };
}

function chatCompletionResponse(content, model, messages, threadId) {
  const id = threadId ? `chatcmpl-notion-${threadId}` : `chatcmpl-notion-${Date.now()}`;
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: estimateNotionUsage(messages, content),
      notion_thread_id: threadId || undefined,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(threadId ? { "X-Notion-Thread-Id": threadId } : {}),
      },
    }
  );
}

function pseudoStreamResponse(content, model, threadId) {
  const encoder = new TextEncoder();
  const id = threadId ? `chatcmpl-notion-${threadId}` : `chatcmpl-notion-${Date.now()}`;
  const chunk = (delta, finishReason) => ({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: delta ? { content: delta } : {}, finish_reason: finishReason }],
  });
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(content, null))}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk("", "stop"))}\n\n`));
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  });
  return new Response(readable, {
    status: 200,
    headers: {
      ...SSE_HEADERS_NO_BUFFER,
      ...(threadId ? { "X-Notion-Thread-Id": threadId } : {}),
    },
  });
}

// ─── Upstream call ──────────────────────────────────────────────────────────

async function sendNotionInferenceRequest(opts) {
  const { reqBody, reqHeaders, signal, proxyOptions } = opts;
  // Notion's edge rejects Node/undici TLS fingerprints — ALWAYS use the shared
  // Chrome-JA3 webTlsClient transport. There is intentionally NO native-fetch
  // fallback: a missing TLS dependency is a hard, clearly-reported error.
  let status = 0;
  let rawText = "";
  try {
    const tlsRes = await webTlsFetch(NOTION_URL, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(reqBody),
      signal: signal ?? undefined,
      timeoutMs: NOTION_TIMEOUT_MS,
      profile: NOTION_TLS_PROFILE,
      proxyOptions,
    });
    status = tlsRes.status;
    rawText = tlsRes.text ?? "";
  } catch (err) {
    if (err instanceof WebTlsClientUnavailableError) {
      return {
        errorResult: {
          status: 502,
          message:
            "Notion Web requires the optional tls-client-node dependency (browser TLS impersonation). " +
            "Install tls-client-node so its native binary can download — Node's built-in fetch is rejected by Notion's edge.",
        },
      };
    }
    return {
      errorResult: {
        status: err?.name === "AbortError" ? 499 : 502,
        message: `Notion fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    };
  }

  if (status === 401 || status === 403) {
    return {
      errorResult: {
        status,
        message: "Notion session expired or invalid — re-paste token_v2 from app.notion.com",
      },
    };
  }
  if (status < 200 || status >= 300) {
    return {
      errorResult: { status: status || 502, message: `Notion error: ${rawText.slice(0, 500)}` },
    };
  }
  return { rawText };
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class NotionWebExecutor extends BaseExecutor {
  constructor() {
    super("notion-web", { baseUrl: NOTION_URL });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const requestBody = (body || {}) || {};

    // Text-only: reject tools / attachments explicitly (no tool emulation).
    const requestedTools = requestBody.tools;
    const requestedFunctions = requestBody.functions;
    if (
      (Array.isArray(requestedTools) && requestedTools.length > 0) ||
      (Array.isArray(requestedFunctions) && requestedFunctions.length > 0)
    ) {
      return {
        response: errorResponse(400, "notion-web does not support function tools"),
        url: NOTION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const cookie = resolveNotionWebCookie(credentials);
    if (!cookie) {
      return {
        response: errorResponse(
          401,
          "Missing Notion token_v2 cookie — paste it from app.notion.com DevTools → Application → Cookies"
        ),
        url: NOTION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    let messages;
    try {
      messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
      // Throws on image/file/tool parts.
      for (const m of messages) extractNotionMessageText(m?.content);
    } catch (err) {
      return {
        response: errorResponse(400, err instanceof Error ? err.message : String(err)),
        url: NOTION_URL,
        headers: {},
        transformedBody: body,
      };
    }
    if (!messages.some((m) => String(m?.role || "").toLowerCase() === "user")) {
      return {
        response: errorResponse(400, "No user message found"),
        url: NOTION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    try {
      const notionCodename = resolveNotionCodename(model);
      const { spaceId, userId } = await resolveNotionWorkspace(
        cookie,
        signal,
        proxyOptions,
        notionCodename
      );
      if (!spaceId) {
        return {
          response: errorResponse(
            400,
            "Could not resolve Notion spaceId — paste space_id from cookies or ensure token_v2 can call getSpaces"
          ),
          url: NOTION_URL,
          headers: {},
          transformedBody: body,
        };
      }

      const modelId = clientFacingModelId(model) || notionCodename || "notion-ai";

      const transcript = buildNotionTranscript(messages, {
        notionModel: notionCodename,
        spaceId,
        userId: userId || undefined,
      });
      const threadId = randomUUID();
      const reqBody = buildNotionInferenceRequestBody({ spaceId, transcript, threadId });
      const reqHeaders = buildNotionExecuteHeaders({ cookie, spaceId, userId });

      const { rawText, errorResult } = await sendNotionInferenceRequest({
        reqBody,
        reqHeaders,
        signal,
        proxyOptions,
      });

      if (errorResult) {
        return {
          response: errorResponse(errorResult.status, errorResult.message),
          url: NOTION_URL,
          headers: reqHeaders,
          transformedBody: reqBody,
        };
      }

      const raw = rawText || "";
      const upstreamErr = extractNotionUpstreamError(raw);
      if (upstreamErr) {
        return {
          response: errorResponse(
            upstreamErr.status || (upstreamErr.isRetryable ? 503 : 502),
            `Notion ${upstreamErr.subType || "error"}: ${upstreamErr.message}`
          ),
          url: NOTION_URL,
          headers: reqHeaders,
          transformedBody: reqBody,
        };
      }

      const finalText = parseNotionInferenceStream(raw);
      if (!finalText) {
        return {
          response: errorResponse(
            502,
            `No response from Notion AI (${summarizeNotionResponseShape(raw)})`
          ),
          url: NOTION_URL,
          headers: reqHeaders,
          transformedBody: reqBody,
        };
      }

      const response =
        stream !== false
          ? pseudoStreamResponse(finalText, modelId, threadId)
          : chatCompletionResponse(finalText, modelId, messages, threadId);

      return { response, url: NOTION_URL, headers: reqHeaders, transformedBody: reqBody };
    } catch (err) {
      if (err instanceof WebTlsClientUnavailableError) {
        return {
          response: errorResponse(
            502,
            "Notion Web requires the optional tls-client-node dependency (browser TLS impersonation). " +
              "Install tls-client-node so its native binary can download — Node's built-in fetch is rejected by Notion's edge."
          ),
          url: NOTION_URL,
          headers: {},
          transformedBody: body,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        response: errorResponse(502, `Notion error: ${msg}`),
        url: NOTION_URL,
        headers: {},
        transformedBody: body,
      };
    }
  }
}

export const notionWebExecutor = new NotionWebExecutor();

export default NotionWebExecutor;
