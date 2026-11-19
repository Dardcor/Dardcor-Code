
import crypto from "crypto";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";

const runtimeSessionStore = new Map();
const continuationStore = new Map();

const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of runtimeSessionStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
            runtimeSessionStore.delete(key);
        }
    }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);

if (cleanupInterval.unref) cleanupInterval.unref();

export function deriveSessionId(connectionId) {
    if (!connectionId) {
        return generateBinaryStyleId();
    }

    const existing = runtimeSessionStore.get(connectionId);
    if (existing) {
        existing.lastUsed = Date.now();
        return existing.sessionId;
    }

    const MAX_SESSIONS = 1000;
    if (runtimeSessionStore.size >= MAX_SESSIONS) {
      const oldest = runtimeSessionStore.keys().next().value;
      runtimeSessionStore.delete(oldest);
    }

    const sessionId = generateBinaryStyleId();
    runtimeSessionStore.set(connectionId, { sessionId, lastUsed: Date.now() });
    return sessionId;
}

export function generateBinaryStyleId() {
    return crypto.randomUUID() + Date.now().toString();
}

export function clearSessionStore() {
    runtimeSessionStore.clear();
    assistantSessionStore.clear();
    continuationStore.clear();
}

const assistantSessionStore = new Map();
const ASSISTANT_MIN_LEN = 50;
const ASSISTANT_CAP_LEN = 50;
const MAX_ASSISTANT_SESSIONS = 5000;
const MAX_CONTINUATION_SESSIONS = 5000;

const SESSION_HEADER_KEYS = ["x-session-id", "session-id", "session_id", "x-amp-thread-id"];
const CLAUDE_CODE_SESSION_RE = /_session_([a-f0-9-]+)$/;
const CLAUDE_CODE_SESSION_HEADER = "x-claude-code-session-id";

function sha16(text) {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function normalizeSessionId(value) {
    if (typeof value !== "string") return null;
    const v = value.trim();
    if (!v || v.length > 256) return null;
    return v;
}

function extractClaudeCodeSession(userId) {
    if (typeof userId !== "string" || !userId) return null;
    const m = userId.match(CLAUDE_CODE_SESSION_RE);
    if (m) return m[1];
    if (userId[0] === "{") {
        try { return normalizeSessionId(JSON.parse(userId)?.session_id); } catch { }
    }
    return null;
}

function headerValue(headers, key) {
    if (!headers || typeof headers !== "object") return null;
    return normalizeSessionId(headers[key] ?? headers[key.toLowerCase()]);
}

const ANTIGRAVITY_CONV_RE = /^[a-z]+\/([0-9a-f-]{36})\//i;
function extractAntigravitySession(body) {
    const sid = body?.request?.sessionId;
    if (sid != null && sid !== "") return normalizeSessionId(String(sid));
    const m = typeof body?.requestId === "string" ? body.requestId.match(ANTIGRAVITY_CONV_RE) : null;
    return m ? normalizeSessionId(m[1]) : null;
}

function extractClientSessionId(headers, body, scope = "") {
    const claude = extractClaudeCodeSession(body?.metadata?.user_id)
        || headerValue(headers, CLAUDE_CODE_SESSION_HEADER);
    if (claude) return `claude:${claude}`;
    const antigravity = extractAntigravitySession(body);
    if (antigravity) return `antigravity:${antigravity}`;
    for (const key of SESSION_HEADER_KEYS) {
        const v = headerValue(headers, key);
        if (v) return v;
    }
    const requestId = scope === "kiro" ? null : headerValue(headers, "x-client-request-id");
    if (requestId) return requestId;
    const fromBody =
        normalizeSessionId(body?.prompt_cache_key) ||
        normalizeSessionId(body?.session_id) ||
        normalizeSessionId(body?.conversation_id) ||
        (scope === "kiro" ? null : normalizeSessionId(body?.metadata?.user_id));
    return fromBody || null;
}

function requestMessages(body) {
    if (Array.isArray(body?.messages)) return body.messages;
    if (Array.isArray(body?.input)) return body.input;
    return [];
}

function accumulateAssistantText(body) {
    const items = requestMessages(body);
    if (!items) return "";
    let text = "";
    for (const item of items) {
        if (item?.role !== "assistant") continue;
        if (typeof item.content === "string") text += item.content;
        else if (Array.isArray(item.content)) {
            for (const c of item.content) text += c?.text || c?.output || "";
        }
        if (text.length >= ASSISTANT_CAP_LEN) break;
    }
    return text;
}

function assistantTextSessionId(scope, body) {
    const text = accumulateAssistantText(body);
    if (text.length < ASSISTANT_MIN_LEN) return null;
    const hash = sha16(`${scope}:${text.slice(0, ASSISTANT_CAP_LEN)}`);
    const existing = assistantSessionStore.get(hash);
    if (existing) {
        existing.lastUsed = Date.now();
        return existing.sessionId;
    }
    if (assistantSessionStore.size >= MAX_ASSISTANT_SESSIONS) {
        assistantSessionStore.delete(assistantSessionStore.keys().next().value);
    }
    const sessionId = generateBinaryStyleId();
    assistantSessionStore.set(hash, { sessionId, lastUsed: Date.now() });
    return sessionId;
}

export function resolveSessionIdentity({ headers, body, connectionId, workspaceId, scope = "" } = {}) {
    const client = extractClientSessionId(headers, body, scope);
    if (client) return { sessionId: client, ephemeral: false };
    const fromAssistant = scope === "kiro" ? null : assistantTextSessionId(`${scope}:${connectionId || ""}`, body);
    if (fromAssistant) return { sessionId: fromAssistant, ephemeral: false };
    const ws = normalizeSessionId(workspaceId);
    if (ws) return { sessionId: ws, ephemeral: false };
    if (scope === "kiro") return { sessionId: generateBinaryStyleId(), ephemeral: true };
    return { sessionId: deriveSessionId(connectionId), ephemeral: false };
}

export function resolveSessionId(opts = {}) {
    return resolveSessionIdentity(opts).sessionId;
}

export function resolveContinuationId({ sessionId, connectionId, scope = "", ephemeral = false } = {}) {
    if (ephemeral) return crypto.randomUUID();
    const key = `${scope}:${connectionId || ""}:${sessionId || ""}`;
    const existing = continuationStore.get(key);
    if (existing) {
        existing.lastUsed = Date.now();
        continuationStore.delete(key);
        continuationStore.set(key, existing);
        return existing.continuationId;
    }
    const continuationId = crypto.randomUUID();
    if (continuationStore.size >= MAX_CONTINUATION_SESSIONS) {
        continuationStore.delete(continuationStore.keys().next().value);
    }
    continuationStore.set(key, { continuationId, lastUsed: Date.now() });
    return continuationId;
}

export function captureSessionId(body, credentials, connectionId, scope = "") {
    return resolveSessionId({ headers: credentials?.rawHeaders, body, connectionId, scope });
}

export function toNumericSessionId(sessionId) {
    const v = normalizeSessionId(sessionId);
    if (!v) return null;
    if (/^-?\d+$/.test(v)) return v;
    const h = crypto.createHash("sha256").update(v).digest();
    const n = h.readBigUInt64BE(0) & 0x7fffffffffffffffn;
    return `-${n.toString()}`;
}

const assistantCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of assistantSessionStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) assistantSessionStore.delete(key);
    }
    for (const [key, entry] of continuationStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) continuationStore.delete(key);
    }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (assistantCleanup.unref) assistantCleanup.unref();
