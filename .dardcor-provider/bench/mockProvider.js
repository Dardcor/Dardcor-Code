/**
 * bench/mockProvider.js — Phase 9 deterministic mock upstream for the
 * benchmark harness (MIAWROUTER_AGENT_PROMPT_V2.md §10).
 *
 * A network-free, OpenAI-compatible chat-completions provider. It stands in
 * for any real LLM API during fixture replay so the harness runs offline in CI.
 * Real-provider mode is deliberately NOT implemented here — network stays an
 * explicit opt-in for the later runner that consumes these contracts.
 *
 * Properties:
 *  - Deterministic. Same request body → same response body and same usage.
 *    Nothing depends on the clock (fixed `created`), randomness, or the wire.
 *  - Stream-aware. `body.stream: true` → SSE (`text/event-stream`),
 *    `body.stream: false`/absent → JSON. Content is identical in both modes.
 *  - Real token accounting. Prompt/completion counts come from the `gpt-tokenizer`
 *    o200k_base BPE encoder, never an estimate.
 *  - Cache-aware usage. The mock simulates the L0 provider prompt-cache an LLM
 *    API reports: a stable token prefix seen on a previous request in the same
 *    instance is billed as `cache_read_input_tokens`, the new tail as
 *    `cache_creation_input_tokens`. Also surfaces the OpenAI/DeepSeek-style
 *    `prompt_tokens_details.cached_tokens`.
 *  - Instance-isolated. Counters, history, and the simulated prompt-cache are
 *    per-instance; two instances never share state. A fresh instance replays a
 *    fixture "cold"; reusing an instance across replays models warm-up.
 *
 * Usage:
 *   import { MockProvider } from "./mockProvider.js";
 *   const provider = new MockProvider();
 *   const res = await provider.fetch("http://mock/v1/chat/completions", {
 *     method: "POST",
 *     body: JSON.stringify({ model: "mock/model", messages: [...] }),
 *   });
 *   // or hand it to code that expects a fetch function:
 *   const fetch = provider.createFetch();
 */

import { encode } from "gpt-tokenizer/encoding/o200k_base";

export const MOCK_PROVIDER_DEFAULT_MODEL = "mock/claude-opus-4-6";
export const MOCK_PROVIDER_MIN_BREAKPOINT_TOKENS = 16;
export const MOCK_PROVIDER_FIXED_CREATED = 1_700_000_000; // deterministic `created` epoch

// Candidate L0 auto-breakpoints (in tokens) that a stable prefix is checked
// against, newest-longest wins. Mirrors the "largest stable prefixes" rule of
// §4 L0; kept small so synthetic fixtures actually exercise it.
const CACHE_BREAKPOINT_TOKENS = [64, 256, 1024];

// --- tiny deterministic primitives (no deps) -----------------------------------

/** FNV-1a 32-bit. Stable across runs/engines. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic sequence from a 32-bit seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable request fingerprint. Drops the transport flags (`stream`,
 * `stream_options`) so the response content is byte-identical whether the
 * caller asked for JSON or SSE; everything else is keyed canonically.
 */
function requestFingerprint(body) {
  const { stream, stream_options, ...stable } = body;
  const keys = Object.keys(stable).sort();
  return JSON.stringify(stable, keys);
}

/** Deterministic completion prose for a request — stable per fingerprint. */
const RESPONSE_WORD_POOL =
  "Refactored minimal diff kept cache prefix stable across turns deterministic " +
  "fixtures replay offline usage accounted from actuals never estimates done"
    .split(" ");

function makeCompletionContent(fingerprint) {
  const rand = mulberry32(fnv1a(fingerprint));
  const n = 10 + Math.floor(rand() * 14);
  const words = [];
  for (let i = 0; i < n; i++) {
    words.push(RESPONSE_WORD_POOL[Math.floor(rand() * RESPONSE_WORD_POOL.length)]);
  }
  return `${words.join(" ")}.`;
}

// --- small response/stream helpers ---------------------------------------------

function jsonResponse(status, obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * OpenAI-style SSE stream for a completion. The delta sequence reconstructs
 * exactly `content`; the terminal chunk carries `finish_reason`, plus usage
 * when the caller asked for it via `stream_options.include_usage`.
 */
function sseResponse({ id, model, created, content, usage, includeUsage }) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const push = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const chunk = (delta, finishReason = null, extra = {}) =>
        push({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
          ...extra,
        });

      chunk({ role: "assistant", content: "" });
      for (let i = 0; i < content.length; i += 12) {
        chunk({ content: content.slice(i, i + 12) });
      }
      const finalChunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      if (includeUsage) finalChunk.usage = usage;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

// --- the provider ---------------------------------------------------------------

/**
 * Deterministic OpenAI-compatible chat-completions mock.
 * @param {object} [options]
 * @param {string} [options.model] - model id echoed in responses.
 * @param {number} [options.minCacheBreakpointTokens] - prefixes shorter than this
 *   are never billed as cache reads.
 */
export class MockProvider {
  constructor(options = {}) {
    this.model = options.model ?? MOCK_PROVIDER_DEFAULT_MODEL;
    this.minBreakpoint = options.minCacheBreakpointTokens ?? MOCK_PROVIDER_MIN_BREAKPOINT_TOKENS;
    // Per-instance state — this is what makes instances isolated.
    this._cache = new Set(); // prefix-hash -> seen
    this._history = [];
    this._totals = {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  }

  /** Drop-in `fetch(url, init)`; bound so it can be detached or passed around. */
  fetch = async (input, init = {}) => {
    let url;
    try {
      url = typeof input === "string" ? new URL(input) : new URL(input.url);
    } catch {
      return jsonResponse(400, { error: { message: "bad mock request URL", type: "invalid_request_error" } });
    }
    const method = (init.method || (input && input.method) || "GET").toUpperCase();
    if (method !== "POST" || !/\/chat\/completions$/.test(url.pathname)) {
      return jsonResponse(404, {
        error: {
          message: `mock provider only serves POST /v1/chat/completions (got ${method} ${url.pathname})`,
          type: "mock_not_found",
        },
      });
    }
    let body;
    try {
      body = JSON.parse(init.body ?? "");
    } catch {
      return jsonResponse(400, { error: { message: "invalid JSON body", type: "invalid_request_error" } });
    }
    if (!body || !Array.isArray(body.messages)) {
      return jsonResponse(400, { error: { message: "missing messages array", type: "invalid_request_error" } });
    }
    return this._handleChat(body);
  };

  /** Returns a bare `(url, init) => Promise<Response>` usable as global fetch. */
  createFetch() {
    return (input, init) => this.fetch(input, init);
  }

  // --- accessors ---------------------------------------------------------------

  get requestCount() {
    return this._history.length;
  }

  get history() {
    return this._history;
  }

  get totalPromptTokens() {
    return this._totals.promptTokens;
  }

  get totalCompletionTokens() {
    return this._totals.completionTokens;
  }

  get totalCacheReadTokens() {
    return this._totals.cacheReadTokens;
  }

  get totalCacheCreationTokens() {
    return this._totals.cacheCreationTokens;
  }

  // --- internals ---------------------------------------------------------------

  _handleChat(body) {
    const model = body.model || this.model;
    const fingerprint = requestFingerprint(body);
    const id = `chatcmpl-mock-${fnv1a(fingerprint).toString(16).padStart(8, "0")}`;
    const created = MOCK_PROVIDER_FIXED_CREATED;

    const content = makeCompletionContent(fingerprint);
    const promptTokens = encode(JSON.stringify(body.messages));
    const { readTokens, creationTokens } = this._accountCache(promptTokens);
    const completionTokens = encode(content).length;

    const usage = {
      prompt_tokens: promptTokens.length,
      completion_tokens: completionTokens,
      total_tokens: promptTokens.length + completionTokens,
      cache_read_input_tokens: readTokens,
      cache_creation_input_tokens: creationTokens,
      prompt_tokens_details: { cached_tokens: readTokens },
    };

    this._totals.promptTokens += promptTokens.length;
    this._totals.completionTokens += completionTokens;
    this._totals.cacheReadTokens += readTokens;
    this._totals.cacheCreationTokens += creationTokens;
    this._history.push({
      id,
      request: body,
      usage,
      stream: Boolean(body.stream),
      model,
    });

    if (body.stream) {
      return sseResponse({
        id,
        model,
        created,
        content,
        usage,
        includeUsage: Boolean(body.stream_options && body.stream_options.include_usage),
      });
    }

    return jsonResponse(200, {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage,
    });
  }

  /**
   * Deterministic L0 prompt-cache simulation on the token sequence.
   *
   * The longest previously-seen prefix (at a configured breakpoint) is billed
   * as cache-read; this request's prefixes at every breakpoint are then
   * recorded, and the unread tail is billed as cache-creation. Deterministic:
   * a fresh instance replays cold, a reused instance warms up.
   *
   * ponytail: no TTL, no 4-breakpoint cap, no per-session stickiness. Add when
   * the harness needs to model cache expiry or eviction.
   */
  _accountCache(promptTokens) {
    const breakpoints = CACHE_BREAKPOINT_TOKENS.filter(
      (p) => p >= this.minBreakpoint && p <= promptTokens.length
    );
    let readTokens = 0;
    for (let i = breakpoints.length - 1; i >= 0; i--) {
      const p = breakpoints[i];
      if (this._cache.has(this._prefixHash(promptTokens, p))) {
        readTokens = p;
        break;
      }
    }
    for (const p of breakpoints) {
      this._cache.add(this._prefixHash(promptTokens, p));
    }
    const creationTokens = Math.max(0, promptTokens.length - readTokens);
    return { readTokens, creationTokens };
  }

  _prefixHash(tokens, length) {
    return fnv1a(tokens.slice(0, length).join(","));
  }
}
