/**
 * bench/harness.js — Phase 9 runtime adapter for the offline benchmark runner.
 *
 * The ONLY module that touches open-sse at runtime. It:
 *  1. Installs a mock `globalThis.fetch` BEFORE any open-sse module evaluates,
 *     so `utils/proxyFetch.js` captures it as its `originalFetch` and every
 *     executor call lands on the MockProvider with zero network. The wrapper
 *     also captures the outbound (post-compression / post-translation)
 *     request body for the cache-integrity check.
 *  2. Registers bench/resolve-hook.mjs so the `@/` and `open-sse/` bare
 *     specifiers inside open-sse resolve under plain Node.
 *  3. Replays fixture turns through the real `handleChatCore` pipeline
 *     (RTK → caveman/ponytail → L0 begin → translation → executor → mock),
 *     collecting cache events, measured usage from the mock's real BPE
 *     accounting, latency/TTFB, and cost.
 *
 * Safety: if anything fails to import or a fetch does not match the mock's
 * chat-completions contract, the harness errors loudly — it never silently
 * falls back to the network.
 */

import { register } from "node:module";
import { fileURLToPath } from "node:url";

// Environment isolation MUST happen before any open-sse/src module evaluates:
// proxyFetch.js reads proxy env at call time, and src/lib/db/paths.js reads
// DATA_DIR when its module first loads.
if (typeof process !== "undefined") {
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    delete process.env[k];
  }
  if (!process.env.DATA_DIR) {
    process.env.DATA_DIR = fileURLToPath(new URL("../.bench-data", import.meta.url));
  }
}

// ---------------------------------------------------------------------------
// fetch installation (must run before the open-sse dynamic import)
// ---------------------------------------------------------------------------

let activeProvider = null; // MockProvider instance for the current iteration
let lastOutboundBody = null; // parsed outbound body of the most recent fetch
let fetchInstalled = false; // installMockFetch() ran — required before loadOpenSse()

/**
 * Install the network-free fetch wrapper. Call BEFORE loadOpenSse().
 * Every upstream call (via proxyAwareFetch → originalFetch) is served by the
 * active MockProvider; the outbound JSON body is captured for integrity
 * checks. Any non-chat-completions URL is answered with a 404 — the harness
 * never forwards to the real network.
 */
export function installMockFetch() {
  const wrapper = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (typeof init?.body === "string" && /\/chat\/completions$/.test(url)) {
      try {
        lastOutboundBody = JSON.parse(init.body);
      } catch {
        lastOutboundBody = null;
      }
    } else {
      lastOutboundBody = null;
    }
    if (!activeProvider) {
      throw new Error("bench harness: no active MockProvider installed for fetch (network would be required)");
    }
    return activeProvider.fetch(input, init);
  };
  // Capture BEFORE proxyFetch.js evaluates (it caches globalThis.fetch at load).
  globalThis.fetch = wrapper;
  fetchInstalled = true;
  return () => {
    // best-effort restore; proxyFetch may have replaced globalThis.fetch after load
    try { delete globalThis.fetch; } catch { /* noop */ }
    fetchInstalled = false;
  };
}

/** Select which MockProvider serves the next fetches (per measured iteration). */
export function setActiveProvider(provider) {
  activeProvider = provider;
  lastOutboundBody = null;
}

/** Outbound body of the most recent turn's executor fetch (for integrity). */
export function takeLastOutboundBody() {
  return lastOutboundBody;
}

// ---------------------------------------------------------------------------
// lazy open-sse load
// ---------------------------------------------------------------------------

let openSsePromise = null;

/**
 * Register the alias hook and dynamically import chatCore + utilities.
 * Fails closed when installMockFetch() has not run: importing open-sse before
 * the mock fetch is installed would let utils/proxyFetch.js capture the real
 * fetch and route executor calls to the network.
 */
export function loadOpenSse() {
  if (!fetchInstalled) {
    throw new Error("bench harness: loadOpenSse() called before installMockFetch() — install the mock fetch first so open-sse captures it as its transport");
  }
  if (!openSsePromise) {
    openSsePromise = (async () => {
      register(new URL("./resolve-hook.mjs", import.meta.url));
      const [{ handleChatCore }, { MockProvider }, tokenizer, pricing] = await Promise.all([
        import("../open-sse/handlers/chatCore.js"),
        import("./mockProvider.js"),
        import("../open-sse/utils/tokenizer.js"),
        import("../open-sse/providers/pricing.js"),
      ]);
      return { handleChatCore, MockProvider, ...tokenizer, ...pricing };
    })();
  }
  return openSsePromise;
}

// ---------------------------------------------------------------------------
// logger + settings mapping
// ---------------------------------------------------------------------------

/** No-op logger satisfying every method chatCore touches. */
export function createNoopLog() {
  return {
    debug() {}, info() {}, warn() {}, error() {}, errorLine() {}, line() {},
    tagForSession() { return ""; },
    nextTag() { return ""; },
    fmtThink() { return null; },
  };
}

/**
 * Map a matrix config onto handleChatCore's settings knobs. Offline-safe:
 * headroom (external proxy) and pxpipe (Claude-only) are excluded per the
 * matrix's documentedLimitations; L2 fails closed to a miss because no
 * embeddings backend exists offline (semanticEmbed stays null).
 */
export function settingsFromConfig(config) {
  const s = config?.settings ?? {};
  return {
    cacheL1Enabled: !!s.cacheL1Enabled,
    cacheL2Enabled: !!s.cacheL2Enabled,
    cacheL3Enabled: !!s.cacheL3Enabled,
    semanticCacheModel: "", // offline: no embeddings backend → L2 fails closed
    semanticCacheThreshold: Number(s.semanticCacheThreshold) > 0 ? Number(s.semanticCacheThreshold) : 0.92,
    semanticCacheTtl: 3600000,
    semanticCacheMaxEntries: 100,
    cacheL3MinChars: Number(s.cacheL3MinChars) > 0 ? Number(s.cacheL3MinChars) : 1000,
    rtkEnabled: !!s.rtkEnabled,
    cavemanEnabled: !!s.cavemanEnabled,
    cavemanLevel: s.cavemanLevel || "full",
    ponytailEnabled: !!s.ponytailEnabled,
    ponytailLevel: s.ponytailLevel || "full",
    headroomEnabled: false, // external local /v1/compress proxy — excluded offline
    headroomUrl: "",
    headroomCompressUserMessages: false,
    pxpipeEnabled: false, // Claude-format-only image compressor — excluded offline
    pxpipeMinChars: 0,
    pxpipeTimeoutMs: 0,
    pxpipeTransform: null,
    stream: Boolean(config?.stream),
  };
}

// ---------------------------------------------------------------------------
// turn / fixture replay
// ---------------------------------------------------------------------------

function parseModelRef(model) {
  if (typeof model !== "string") return { provider: "mock", model: "mock/model" };
  const slash = model.indexOf("/");
  if (slash === -1) return { provider: "mock", model };
  return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
}

/**
 * Replay a single fixture turn through the real chatCore pipeline.
 * @param {object} opts - { turn, config, runId, provider, countTokens, costFn }
 * @returns {object} { id, ok, cached, error, latencyMs, ttfbMs, usage, events, costUsd, outboundBytes }
 */
export async function replayTurn({ turn, config, runId, provider, countTokens, costFn }) {
  const { handleChatCore } = await loadOpenSse();
  const settings = settingsFromConfig(config);
  const stream = settings.stream;

  const body = structuredClone(turn.request || {});
  body.stream = stream;
  if (stream) body.stream_options = { include_usage: true }; // real usage over estimates
  const { provider: providerId, model: modelId } = parseModelRef(body.model);
  const events = [];
  const sessionId = `bench-${runId}`;

  const clientRawRequest = {
    endpoint: "http://mock.test/v1/chat/completions",
    body,
    headers: {
      "x-session-id": sessionId,
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
    },
  };

  const credentials = {
    apiKey: "bench-mock-key",
    runtimeTransport: { baseUrl: "http://mock.test/v1/chat/completions" },
  };

  lastOutboundBody = null;
  const t0 = process.hrtime.bigint();
  try {
    const result = await handleChatCore({
      body,
      modelInfo: { provider: providerId, model: modelId },
      credentials,
      log: createNoopLog(),
      onCredentialsRefreshed: null,
      onRequestSuccess: null,
      onDisconnect: null,
      clientRawRequest,
      connectionId: runId,
      userAgent: "miawrouter-bench/1",
      apiKey: "bench-router-key",
      ccFilterNaming: false,
      ...settings,
      onCacheEvent: (e) => events.push(e),
      onPxpipeEvent: null,
      semanticEmbed: null, // offline: L2 fails closed to a miss
      sourceFormatOverride: null,
      providerThinking: null,
    });

    if (!result || !result.response) {
      return { id: turn.id, ok: false, error: "chatCore returned no response", latencyMs: msSince(t0), ttfbMs: null, usage: null, events, costUsd: null };
    }
    if (result.success === false) {
      const errText = await result.response.text().catch(() => "");
      return {
        id: turn.id, ok: false, error: `chatCore error (${result.status}): ${errText.slice(0, 300)}`,
        latencyMs: msSince(t0), ttfbMs: null, usage: null, events, costUsd: null,
      };
    }

    const cacheHit = (result.response.headers.get("x-miaw-cache") || "").toUpperCase() === "HIT";
    const { latencyMs, ttfbMs } = await drainResponseBody(result.response);

    let usage = null;
    if (cacheHit) {
      usage = null; // no upstream call on a response-cache hit
    } else if (provider.history.length > 0) {
      usage = provider.history[provider.history.length - 1].usage ?? null;
    }

    let costUsd = null;
    if (!cacheHit && usage && typeof costFn === "function") {
      try { costUsd = costFn(providerId, modelId, usage); } catch { costUsd = null; }
    }

    return { id: turn.id, ok: true, cached: cacheHit, error: null, latencyMs, ttfbMs, usage, events, costUsd, outboundBytes: outboundBytesOf() };
  } catch (err) {
    return {
      id: turn.id, ok: false, error: `${err?.message || String(err)}`,
      latencyMs: msSince(t0), ttfbMs: null, usage: null, events, costUsd: null,
    };
  }
}

/**
 * Drain a Response body, returning total latency and time-to-first-byte.
 * TTFB is null when the stream produced no chunk (zero-chunk/error bodies):
 * a first byte that never arrived is not measured, never fabricated.
 */
export async function drainResponseBody(response) {
  const t0 = process.hrtime.bigint();
  let ttfbNs = null;
  const reader = response?.body?.getReader?.();
  if (reader) {
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
      if (ttfbNs === null) ttfbNs = process.hrtime.bigint();
    }
  } else if (typeof response?.text === "function") {
    await response.text();
  }
  return { latencyMs: msSince(t0), ttfbMs: ttfbNs === null ? null : Number(ttfbNs - t0) / 1e6 };
}

function outboundBytesOf() {
  if (lastOutboundBody === null) return 0;
  try { return Buffer.byteLength(JSON.stringify(lastOutboundBody), "utf8"); } catch { return 0; }
}

function msSince(t0) {
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

/**
 * Replay a full fixture: `warmup` passes (results discarded, shared cache
 * state warms) followed by `iterations` measured passes. Each pass uses a
 * fresh MockProvider (cold provider-prefix simulation) over the same
 * connectionId, so L0/L1 module state carries warm-up across passes exactly
 * as it would in a long-lived process.
 *
 * @returns {object} raw run result consumable by report.aggregateRun()
 */
export async function replayFixture({ fixture, config, runId, iterations = 1, warmup = 0, countTokens, costFn }) {
  const { MockProvider } = await loadOpenSse();
  const note = [];
  const strategy = config?.settings?.comboStrategy;
  if (strategy) {
    note.push(`routing strategy "${strategy}" is app-layer combo expansion, not exercised by the single-provider offline harness; direct route to the mock only`);
  }

  const runIteration = async () => {
    const provider = new MockProvider();
    setActiveProvider(provider);
    const turns = [];
    let originalTokens = 0;
    for (const turn of fixture.turns) {
      if (typeof countTokens === "function") originalTokens += countTokens(turn.request || {}) || 0;
      turns.push(await replayTurn({ turn, config, runId, provider, countTokens, costFn }));
    }
    return { turns, providerTotals: providerTotals(provider), originalTokens };
  };

  for (let i = 0; i < warmup; i++) {
    await runIteration(); // discarded — warms L0/L1 module state + JIT
  }
  const iterationsOut = [];
  for (let i = 0; i < iterations; i++) {
    iterationsOut.push(await runIteration());
  }
  return { run: { id: runId, config: config?.id, fixture: fixture.id }, config, iterations: iterationsOut, note: note.length ? note.join("; ") : null };
}

function providerTotals(provider) {
  return {
    promptTokens: provider.totalPromptTokens,
    completionTokens: provider.totalCompletionTokens,
    cacheReadTokens: provider.totalCacheReadTokens,
    cacheCreationTokens: provider.totalCacheCreationTokens,
  };
}
