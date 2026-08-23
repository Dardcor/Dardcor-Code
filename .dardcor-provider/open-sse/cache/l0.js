// L0 prompt-cache orchestration: stable-prefix tracking, breakpoint insertion,
// and the structural compression interlock that keeps token compressors from
// mutating the prefix a provider has cached.
//
// Fail-open by design: no function here throws. Callers treat a null `begin`
// result as "no orchestration" and a thrown `finish` as "request proceeds
// without breakpoints" — cache health never breaks the request path.
//
// State is keyed by cacheKey (provider + resolveSessionId), mirroring the
// session-manager continuity model, so a warm session's metadata (turn count,
// prefix stability, breakpoint count, last provider cache usage) is queryable
// by routing via getSessionInfo().

import crypto from "crypto";
import { CLAUDE_BLOCK } from "../translator/schema/index.js";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";

export const MAX_BREAKPOINTS = 4; // Anthropic's cache-breakpoint ceiling
export const STABLE_TURNS = 2;    // same prefix twice in a row → safe to breakpoint

// L0's own breakpoint marker. Client-provided cache_control blocks are never
// rewritten — only preserved byte-identically.
export const CACHE_CONTROL_EPHEMERAL = Object.freeze({ type: "ephemeral" });

// Session records: cacheKey -> { prefixHash, prefixLen, turns, lastSeen, cacheRead, cacheCreation }
const stateByKey = new Map();

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of stateByKey) {
    if (now - rec.lastSeen > MEMORY_CONFIG.sessionTtlMs) stateByKey.delete(key);
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (cleanup.unref) cleanup.unref();

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

// Deep-copy a value, dropping cache_control markers. Used ONLY for the
// stability gate: markers are added/removed by L0 and translators and are not
// part of what the provider caches. Integrity checks use exact hashes.
function stripCacheControl(value) {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key === "cache_control") continue;
      out[key] = stripCacheControl(value[key]);
    }
    return out;
  }
  return value;
}

// The stable prefix = every message except the last one. The last message is
// the mutable tail (new user turn / tool_result) that changes between
// requests; everything before it is what a provider can cache-hit. Returns
// null for shapes without a messages[] array (kiro/gemini) — those get no
// orchestration.
function prefixMessages(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages) return null;
  return messages.length > 1 ? messages.slice(0, -1) : [];
}

// Canonical (cache_control-stripped) hash of the full cacheable prefix:
// system + tools + message prefix. Used for the two-turn stability gate.
function stabilityHash({ system = null, tools = null, messages = [] } = {}) {
  return contentHash(stripCacheControl({ system, tools, messages }));
}

/**
 * Snapshot the full pre-compression body plus per-section (system / tools /
 * message prefix) clones and EXACT hashes before token savers run. The system
 * prompt snapshot is taken AFTER caveman/ponytail injection, so the injected
 * text is part of the protected prefix.
 * @returns {object|null} orchestration state, or null for unsupported shapes.
 */
export function begin(body) {
  if (!body || typeof body !== "object") return null;
  const prefix = prefixMessages(body);
  if (!prefix) return null;

  const original = structuredClone(body); // true pre-compression clone
  const system = Array.isArray(body.system) || typeof body.system === "string" ? body.system : null;
  const tools = Array.isArray(body.tools) ? body.tools : null;

  return {
    original,
    prefixLen: prefix.length,
    snapshot: {
      system: system !== null ? structuredClone(system) : null,
      tools: tools !== null ? structuredClone(tools) : null,
      messages: prefix.map((m) => structuredClone(m)),
    },
    integrity: {
      system: system !== null ? contentHash(system) : null,
      tools: tools !== null ? contentHash(tools) : null,
      messages: contentHash(prefix),
    },
    hash: stabilityHash({ system, tools, messages: prefix }),
  };
}

/**
 * Structural compression interlock + breakpoint orchestration. Run AFTER all
 * token savers. Returns { body, info } — body is a clone of the true
 * pre-compression body when a saver replaced the request into an incompatible
 * shape. Fail-open: returns the input unchanged on any error.
 *
 * @param {object} body - final request body (may be a saver-replaced object)
 * @param {object} state - result of begin()
 * @param {object} ctx - { cacheKey, provider, model, onCacheEvent }
 */
export function finish(body, state, { cacheKey = "", provider = "", model = "", onCacheEvent = null } = {}) {
  if (!body || !state) return { body, info: null };
  let result = body;
  const info = { turns: 0, stable: false, restored: false, breakpoints: 0, prefixLen: state.prefixLen };

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (messages && messages.length >= state.prefixLen) {
    // Detect every integrity mismatch BEFORE touching the body — the caller's
    // live request object must never be mutated in place. Clone once only when
    // restoration is actually needed; the no-restoration hot path returns the
    // original reference. The last message (mutable tail) is NOT protected.
    const needSystem = state.integrity.system !== null && contentHash(body.system) !== state.integrity.system;
    const needTools = state.integrity.tools !== null && contentHash(body.tools) !== state.integrity.tools;
    const needMessages = state.prefixLen > 0 && contentHash(messages.slice(0, state.prefixLen)) !== state.integrity.messages;
    if (needSystem || needTools || needMessages) {
      // Clone once, then restore onto the clone.
      result = structuredClone(body);
      if (needSystem) {
        result.system = structuredClone(state.snapshot.system);
        info.restored = true;
      }
      if (needTools) {
        result.tools = structuredClone(state.snapshot.tools);
        info.restored = true;
      }
      if (needMessages) {
        result.messages.splice(0, state.prefixLen, ...state.snapshot.messages.map((m) => structuredClone(m)));
        info.restored = true;
      }
    }
  } else {
    // Saver replaced the body into an incompatible shape — fall back to a
    // clone of the true pre-compression body, never the live mutated object.
    result = structuredClone(state.original);
    info.restored = true;
  }

  // Turn counting: a breakpoint is only safe once the prefix it will cover has
  // been observed twice. An append-only conversation always EXTENDS the
  // previous request's prefix (previous history reappears verbatim), so the
  // gate resets only when the client rewrites history or system/tools change.
  const msgs = Array.isArray(result?.messages) ? result.messages : null;
  const rec = stateByKey.get(cacheKey) || { prefixHash: null, prefixLen: 0, turns: 0, lastSeen: 0, cacheRead: 0, cacheCreation: 0 };
  let extendsPrev = false;
  if (rec.prefixHash && msgs && state.prefixLen >= rec.prefixLen) {
    extendsPrev = stabilityHash({
      system: result.system ?? null,
      tools: result.tools ?? null,
      messages: msgs.slice(0, rec.prefixLen),
    }) === rec.prefixHash;
  }
  rec.turns = extendsPrev ? Math.min(rec.turns + 1, STABLE_TURNS) : 1;
  rec.prefixHash = state.hash;
  rec.prefixLen = state.prefixLen;
  rec.lastSeen = Date.now();
  stateByKey.set(cacheKey, rec);

  info.turns = rec.turns;
  info.stable = rec.turns >= STABLE_TURNS;
  if (info.stable) {
    if (result === body) result = structuredClone(body);
    insertBreakpoints(result, MAX_BREAKPOINTS);
  }
  info.breakpoints = countBreakpoints(result);

  try {
    onCacheEvent?.({
      type: "cache_probe",
      ts: Date.now(),
      cacheKey,
      provider,
      model,
      turns: info.turns,
      stable: info.stable,
      restored: info.restored,
      prefixLen: info.prefixLen,
      breakpoints: info.breakpoints,
    });
  } catch { /* stats must not break requests */ }

  return { body: result, info };
}

// Count cache_control blocks across system + messages + tools.
export function countBreakpoints(body) {
  if (!body || typeof body !== "object") return 0;
  let n = 0;
  if (Array.isArray(body.system)) {
    for (const b of body.system) if (b?.cache_control) n++;
  }
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!Array.isArray(msg?.content)) continue;
      for (const b of msg.content) if (b?.cache_control) n++;
    }
  }
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) if (t?.cache_control) n++;
  }
  return n;
}

// Add L0's missing breakpoints (system last block, last prefix message, last
// tool) up to MAX_BREAKPOINTS total. Client-provided cache_control blocks are
// preserved untouched — they are counted and never overwritten.
function insertBreakpoints(body, cap) {
  if (countBreakpoints(body) >= cap) return;

  // 1. Last system block (Claude array form only).
  if (Array.isArray(body.system) && body.system.length > 0) {
    const last = body.system[body.system.length - 1];
    if (last && typeof last === "object" && !last.cache_control) {
      last.cache_control = { ...CACHE_CONTROL_EPHEMERAL };
    }
  }
  if (countBreakpoints(body) >= cap) return;

  // 2. Last non-thinking block of the last prefix message.
  if (Array.isArray(body.messages) && body.messages.length > 1) {
    const last = body.messages[body.messages.length - 2];
    if (last && Array.isArray(last.content) && last.content.length > 0) {
      for (let j = last.content.length - 1; j >= 0; j--) {
        const b = last.content[j];
        if (!b || typeof b !== "object") continue;
        if (b.type === CLAUDE_BLOCK.THINKING || b.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;
        if (!b.cache_control) b.cache_control = { ...CACHE_CONTROL_EPHEMERAL };
        break;
      }
    }
  }
  if (countBreakpoints(body) >= cap) return;

  // 3. Last tool definition (Claude shape; OpenAI tools have no cache_control slot).
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const last = body.tools[body.tools.length - 1];
    if (last && typeof last === "object" && !last.cache_control) {
      last.cache_control = { ...CACHE_CONTROL_EPHEMERAL };
    }
  }
}

// Record authoritative provider cache usage. The provider's own cache_read /
// cache_creation token counts stay the ground truth — L0 only mirrors them.
export function recordUsage(cacheKey, { cacheRead = 0, cacheCreation = 0 } = {}) {
  const rec = stateByKey.get(cacheKey);
  if (!rec) return;
  rec.cacheRead = cacheRead;
  rec.cacheCreation = cacheCreation;
}

// Warm-session metadata for routing: which prefix is stable, since when, and
// what the provider last reported for cache read/write. null when cold.
export function getSessionInfo(cacheKey) {
  const rec = stateByKey.get(cacheKey);
  if (!rec) return null;
  return {
    prefixHash: rec.prefixHash,
    turns: rec.turns,
    stable: rec.turns >= STABLE_TURNS,
    lastSeen: rec.lastSeen,
    cacheRead: rec.cacheRead,
    cacheCreation: rec.cacheCreation,
  };
}

// Emit a cache_usage event when the provider reports cache read/write tokens
// (including a reported-but-zero read: that marks a cold miss after breakpoints
// were set, which routing may want to act on).
export function emitCacheUsage(onCacheEvent, { cacheKey, provider, model, usage = null } = {}) {
  if (!usage || typeof usage !== "object") return;
  const cacheRead = usage.cache_read_input_tokens ?? usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  const cacheCreation = usage.cache_creation_input_tokens;
  if (cacheRead === undefined && cacheCreation === undefined) return;
  const read = Number(cacheRead) || 0;
  const create = Number(cacheCreation) || 0;
  recordUsage(cacheKey, { cacheRead: read, cacheCreation: create });
  try {
    onCacheEvent?.({
      type: "cache_usage",
      ts: Date.now(),
      cacheKey,
      provider,
      model,
      cacheRead: read,
      cacheCreation: create,
    });
  } catch { /* stats must not break requests */ }
}
