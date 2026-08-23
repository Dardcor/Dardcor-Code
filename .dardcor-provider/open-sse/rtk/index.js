// RTK port: compress tool_result content in LLM request bodies
// Injected at the top of translateRequest (before any format translation)
import { stripVTControlCharacters } from "node:util";
import { RAW_CAP, DEFAULT_RTK_MODE, MODE_MIN_COMPRESS_SIZE, CHARS_PER_TOKEN } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";

/**
 * Compress tool_result content in-place. Returns stats or null if disabled/failed.
 * @param {object} body - request body (messages[], input[], or Kiro conversationState)
 * @param {boolean} enabled - master switch
 * @param {object} [opts]
 * @param {number} [opts.start=0] - message index to begin compressing from.
 *   Messages before `start` are left untouched AND uncounted, so the stats
 *   reflect only the live tail — never an L0-protected cached prefix. Kiro
 *   bodies have no prefix index and are always compressed in full.
 * @param {string} [opts.mode=standard] - exclusive lite/standard/aggressive
 *   mode; selects the per-blob compression threshold. Defaults keep the
 *   historical behavior (MIN_COMPRESS_SIZE = 500B).
 */
export function compressMessages(body, enabled, { start = 0, mode } = {}) {
  if (!enabled) return null;
  if (!body) return null;
  const minCompressSize = MODE_MIN_COMPRESS_SIZE[mode] ?? MODE_MIN_COMPRESS_SIZE[DEFAULT_RTK_MODE];

  // Kiro format: conversationState.history + conversationState.currentMessage
  if (body.conversationState) {
    return compressKiroFormat(body, minCompressSize);
  }

  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  // Clamp: start must be a valid index into the array.
  const from = Number.isInteger(start) && start > 0 ? Math.min(start, items.length) : 0;

  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (let i = from; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") {
          msg.output = compressText(msg.output, stats, "openai-responses-string", minCompressSize);
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "openai-responses-array", minCompressSize);
            }
          }
        }
        continue;
      }

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      if (msg.role === "tool" && typeof msg.content === "string") {
        msg.content = compressText(msg.content, stats, "openai-tool", minCompressSize);
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === "tool") {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "openai-tool-array", minCompressSize);
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue; // preserve error traces

        if (typeof block.content === "string") {
          // Shape 2: claude string form
          block.content = compressText(block.content, stats, "claude-string", minCompressSize);
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "claude-array", minCompressSize);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressMessages error:", e.message);
    return null;
  }
  return stats;
}

// Compress Kiro format: conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text
function compressKiroFormat(body, minCompressSize) {
  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    const state = body.conversationState;
    const allMessages = [...(Array.isArray(state?.history) ? state.history : [])];
    if (state?.currentMessage) allMessages.push(state.currentMessage);

    for (const msg of allMessages) {
      const toolResults = msg?.userInputMessage?.userInputMessageContext?.toolResults;
      if (!Array.isArray(toolResults)) continue;

      for (const tr of toolResults) {
        if (tr.status === "error") continue; // preserve error traces
        if (!Array.isArray(tr.content)) continue;

        for (const part of tr.content) {
          if (part && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "kiro-tool-result", minCompressSize);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressKiroFormat error:", e.message);
    return null;
  }
  return stats;
}

function compressText(text, stats, shape, minCompressSize) {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < minCompressSize || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const cleanText = stripVTControlCharacters(text);
  const fn = autoDetectFilter(cleanText);
  const out = fn ? safeApply(fn, cleanText) : cleanText;

  // Safety: never return empty, never grow the input
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += out.length;
  stats.hits.push({
    shape,
    filter: fn ? fn.filterName || fn.name : "terminal-noise",
    saved: bytesIn - out.length,
  });
  return out;
}

// Deterministic request-size estimate: total characters across the message
// payload (messages[] / input[]), or the whole body for other shapes (Kiro),
// at CHARS_PER_TOKEN characters per token. Same body → same estimate; never
// depends on an external service. Fail-open: returns 0 on any error, which
// keeps RTK off unless the auto-trigger is 0 (always).
export function estimateRequestTokens(body) {
  try {
    if (!body || typeof body !== "object") return 0;
    let chars = 0;
    const items = Array.isArray(body.messages) ? body.messages
      : Array.isArray(body.input) ? body.input
      : null;
    if (items) {
      for (const m of items) chars += countChars(m);
    } else {
      chars = countChars(body);
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
  } catch {
    return 0;
  }
}

function countChars(value, depth = 0) {
  if (value === null || value === undefined) return 0;
  const t = typeof value;
  if (t === "string") return value.length;
  if (t === "number" || t === "boolean") return String(value).length;
  if (t !== "object" || depth > 4) return 0;
  let n = 0;
  if (Array.isArray(value)) {
    for (const item of value) n += countChars(item, depth + 1);
  } else {
    for (const key of Object.keys(value)) n += countChars(value[key], depth + 1);
  }
  return n;
}

// Convenience: format a log line from stats
export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
