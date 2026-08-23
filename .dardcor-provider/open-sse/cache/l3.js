// L3 content-address dedup: a large block in the mutable last message is
// replaced by a compact reference ONLY when an identical full block already
// exists EARLIER in the same outgoing request context (prior messages or
// earlier blocks within the last message). The reference carries the SHA-256
// hash plus a short preview, so it is self-explanatory without a legend. When
// the earlier source is absent, the block is left untouched — no hidden
// server memory, no re-sent full content. Only the last message is mutated
// (never the L0-protected prefix). Disabled by default. Fail-open: any error
// returns the body unchanged.

import crypto from "crypto";
import { OPENAI_BLOCK } from "../translator/schema/index.js";
import { emitCacheEvent } from "./events.js";

export const L3_MIN_CHARS = 1000;  // blocks below this are never deduped
const PREVIEW_CHARS = 48;

// Module-level stats counters (informational only).
let statsTotalRefs = 0;
let statsTotalBytesSaved = 0;

function contentHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 10);
}

// Bounded single-line preview so the reference is recognizable at a glance.
function preview(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

function textOf(block) {
  if (typeof block === "string") return block;
  if (block && typeof block.text === "string") return block.text;
  return null;
}

// Collect hash → preview for every text block in the given message.
function registerMessageText(msg, seen) {
  if (!msg || typeof msg !== "object") return;
  const blocks = Array.isArray(msg.content) ? msg.content
    : typeof msg.content === "string" ? [msg.content]
    : null;
  if (!blocks) return;
  for (const block of blocks) {
    const text = textOf(block);
    if (text === null) continue;
    const hash = contentHash(text);
    if (!seen.has(hash)) seen.set(hash, preview(text));
  }
}

/**
 * Replace repeated large blocks in the last message with compact references.
 * Returns a NEW body when any block was replaced; returns the input unchanged
 * otherwise (or on any error).
 */
export function transform(body, { minChars = L3_MIN_CHARS, provider = "", model = "", onCacheEvent = null } = {}) {
  try {
    if (!body || typeof body !== "object") return body;
    if (!Array.isArray(body.messages) || body.messages.length === 0) return body;

    const last = body.messages[body.messages.length - 1];
    if (!last || typeof last !== "object") return body;
    if (!Array.isArray(last.content)) return body;

    const threshold = Number(minChars) > 0 ? Number(minChars) : L3_MIN_CHARS;

    // Earlier context in this outgoing request: every prior message's text
    // (read-only, never mutated — this is the L0-protected prefix), then
    // blocks already scanned within the last message.
    const seen = new Map();
    for (let i = 0; i < body.messages.length - 1; i++) {
      registerMessageText(body.messages[i], seen);
    }

    let refs = 0;
    let bytesSaved = 0;
    const next = last.content.map((block) => {
      const text = textOf(block);
      if (text === null) return block;
      const hash = contentHash(text);
      const prior = seen.get(hash);
      if (text.length < threshold) {
        // Small block: full content stays, but it can be the source for a
        // later large repeat in the same message.
        if (!prior) seen.set(hash, preview(text));
        return block;
      }
      if (!prior) {
        // No identical full block earlier in this request → keep full content.
        seen.set(hash, preview(text));
        return block;
      }

      const ref = `[L3:${hash}:${prior}]`;
      bytesSaved += text.length - ref.length;
      refs++;
      return { type: OPENAI_BLOCK.TEXT, text: ref };
    });

    if (refs === 0) return body;

    statsTotalRefs += refs;
    statsTotalBytesSaved += bytesSaved;

    emitCacheEvent(onCacheEvent, {
      type: "cache_l3",
      action: "dedup",
      ts: Date.now(),
      provider,
      model,
      refs,
      bytesSaved,
    });

    // Non-mutating: build a NEW body so callers that captured the pre-L3 body
    // for cache keying keep it intact.
    const newLast = { ...last, content: next };
    return {
      ...body,
      messages: body.messages.map((m, i) => (i === body.messages.length - 1 ? newLast : m)),
    };
  } catch {
    return body; // fail-open: never break the request
  }
}

export function l3Stats() {
  return { totalRefs: statsTotalRefs, totalBytesSaved: statsTotalBytesSaved, minChars: L3_MIN_CHARS };
}

export function l3Clear() {
  statsTotalRefs = 0;
  statsTotalBytesSaved = 0;
}
