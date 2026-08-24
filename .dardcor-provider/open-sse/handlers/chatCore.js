import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { applyThinking, extractThinking, stripThinkingSuffix } from "../translator/concerns/thinkingUnified.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, TOKEN_SAVER_HEADER, LEGACY_TOKEN_SAVER_HEADER } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail, saveMetrics, buildCacheMetricRows, buildSaverMetricRows } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { supportsGrokCliReasoningEffort } from "../config/grokCli.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog, estimateRequestTokens } from "../rtk/index.js";
import { DEFAULT_AUTO_TRIGGER_TOKENS } from "../rtk/constants.js";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../rtk/headroom.js";
import { compressWithPxpipe } from "../rtk/pxpipe.js";
import { begin as beginCacheOrchestration, finish as finishCacheOrchestration } from "../cache/l0.js";
import { l1Key as l1CacheKey, isCacheable as isCacheableRequest, l1Lookup, l1Store, cacheScope } from "../cache/l1.js";
import { l2Lookup, lastUserText, looksLikeCodeGeneration } from "../cache/l2.js";
import { transform as l3Transform } from "../cache/l3.js";
import { emitCacheEvent } from "../cache/events.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { normalizeToolSchemas } from "../utils/toolSchema.js";

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
/**
 * Remove translator-internal continuity fields from the outbound upstream
 * body. The Responses→Chat request translator stashes reasoning
 * `encrypted_content` on assistant messages so a later openai→responses
 * round-trip can restore the store=false continuity blob; that stash must
 * never reach an upstream provider. Chat-native proxies reject the unknown
 * assistant-message field and answer every turn with a literal "400" body
 * (observed with multi-turn Codex sessions via OpenAI-compatible nodes).
 */
export function stripContinuityFields(body) {
  if (!body || !Array.isArray(body.messages)) return body;
  for (const msg of body.messages) {
    if (msg && typeof msg === "object") {
      delete msg.encrypted_content;
      delete msg.reasoning_encrypted_content;
    }
  }
  return body;
}

export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, rtkMode, tokenSaverAutoTriggerTokens, headroomEnabled, headroomUrl, headroomCompressUserMessages, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, pxpipeEnabled, pxpipeMinChars, pxpipeTimeoutMs, pxpipeTransform, onPxpipeEvent, onCacheEvent, onTokenSaverEvent, sourceFormatOverride, providerThinking, cacheL1Enabled, cacheL2Enabled, cacheL3Enabled, semanticCacheModel, semanticCacheThreshold, semanticCacheTtl, semanticCacheMaxEntries, cacheL3MinChars, semanticEmbed, bodyLoggingEnabled }) {
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();
  // Stable per-session color so all lines of one CLI conversation share a tag
  const sessionSeed = (() => {
    try {
      return resolveSessionId({ headers: clientRawRequest?.headers, body, connectionId, scope: provider });
    } catch {
      return connectionId || "";
    }
  })();
  const reqTag = log?.tagForSession ? log.tagForSession(sessionSeed) : (log?.nextTag ? log.nextTag() : "");

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const targetFormat = modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider, credentials);
  if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport;
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  // Privacy-gated request-body logging: bodyLoggingEnabled=false forces the
  // no-op logger even when ENABLE_REQUEST_LOGS is set.
  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model, { enabled: bodyLoggingEnabled });
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: undefined });
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  let translatedBody;
  let toolNameMap;
  let customToolNames;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: stripThinkingSuffix(upstreamModel) };
    if (provider === "codex") {
      const suffixThinking = {};
      applyThinking(sourceFormat, upstreamModel, suffixThinking, provider);
      if (suffixThinking.reasoning_effort) {
        const reasoning = translatedBody.reasoning;
        translatedBody.reasoning = {
          ...(reasoning && typeof reasoning === "object" && !Array.isArray(reasoning) ? reasoning : {}),
          effort: suffixThinking.reasoning_effort,
        };
        delete translatedBody.reasoning_effort;
      }
    }
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model);
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, upstreamModel, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    customToolNames = translatedBody._customToolNames;
    delete translatedBody._customToolNames;
    translatedBody.model = stripThinkingSuffix(upstreamModel);
    stripContinuityFields(translatedBody);
  }

  normalizeToolSchemas(translatedBody);

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // Request line: one correlated summary (fmt + thinking + counts + account)
  if (log?.line) {
    const clientModel = clientRawRequest?.body?.model || `${provider}/${model}`;
    const msgN = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || body.messages?.length || body.input?.length || 0;
    const toolN = translatedBody.tools?.length || body.tools?.length || 0;
    const fmtStr = passthrough ? `FMT: ${sourceFormat} (passthrough)` : `FMT: ${sourceFormat}→${targetFormat}`;
    const showThinking = provider !== "grok-cli" || supportsGrokCliReasoningEffort(model);
    const think = showThinking ? log.fmtThink?.(extractThinking(translatedBody)) : null;
    const acc = credentials?.connectionName || credentials?.connectionId?.slice(0, 8) || "-";
    const parts = [
      `POST ${clientModel} → ${provider}/${model}`,
      fmtStr,
      stream ? "STREAM" : "JSON",
      `${msgN} MSG`,
    ];
    if (toolN) parts.push(`${toolN} TOOL`);
    if (think) parts.push(`THINK:${think}`);
    parts.push(`ACC:${acc}`);
    log.line(reqTag, "▶", parts.join(" · "));
  }

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  // Per-request opt-out: client can bypass all token savers via header.
  // New x-dardcor-token-saver wins; legacy x-9router-token-saver still accepted.
  const saverHeaderValue =
    clientRawRequest?.headers?.[TOKEN_SAVER_HEADER] ??
    clientRawRequest?.headers?.[LEGACY_TOKEN_SAVER_HEADER];
  const tokenSaverEnabled = saverHeaderValue?.toLowerCase() !== "off";

  // Live token-saver telemetry. Fail-open: a throwing subscriber must never
  // break the request, and absent callback is a no-op.
  const saverStages = [];
  const saverEmit = (event) => {
    try {
      if (event?.stage) saverStages.push(event);
      // Persist saver savings ONLY once the request reaches provider dispatch
      // (cache hits return before this point); savings never count otherwise.
      if (event?.stage === "provider") {
        const rows = buildSaverMetricRows(saverStages, { provider, model });
        rows.push({ kind: "saver", name: "dispatch", outcome: "provider", provider, model });
        saveMetrics(rows).catch(() => {});
      }
      onTokenSaverEvent?.({ ...event, provider, model, ts: Date.now() });
    } catch { /* telemetry must never break requests */ }
  };
  const telemetryNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : undefined;

  // Token-saver flags accumulator for the single "⚙" log line below.
  const xf = [];

  // Caveman/Ponytail inject system prompts. They run BEFORE the L0 snapshot so
  // their injected system text is captured as part of the protected cached
  // prefix (and survives the compression interlock).
  if (tokenSaverEnabled && cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    xf.push(`CAVEMAN:${cavemanLevel}`);
    saverEmit({ stage: "caveman", applied: true, level: cavemanLevel });
  }
  if (tokenSaverEnabled && ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    xf.push(`PONYTAIL:${ponytailLevel}`);
    saverEmit({ stage: "ponytail", applied: true, level: ponytailLevel });
  }

  // L0 prompt-cache orchestration: snapshot the whole pre-compression body
  // (system, tools, message prefix) before any compressor can touch it. The
  // interlock after the savers restores any section RTK / Headroom / PXPIPE
  // mutated, and inserts missing breakpoints once the prefix has been stable
  // for two session turns. Fail-open: any error here just disables
  // orchestration for this request.
  const cacheKey = `${provider}:${sessionSeed}`;
  let cacheState = null;
  try {
    cacheState = beginCacheOrchestration(translatedBody);
  } catch { /* fail-open: no cache orchestration this request */ }

  // RTK: compress tool_result content — ONE pass, exclusive mode. The L0
  // orchestration snapshot (cacheState) carries prefixLen (message count of the
  // stable cached prefix) ONLY for messages[]-shaped bodies; Kiro and other
  // shapes get no orchestration, so start stays 0 and they keep full-body
  // compression. RTK mutates AND counts only the live tail from prefixLen
  // onward, so stats never include the restored L0-protected prefix.
  const rtkAutoTriggerRaw = Number(tokenSaverAutoTriggerTokens);
  const rtkAutoTrigger = Number.isFinite(rtkAutoTriggerRaw) && rtkAutoTriggerRaw >= 0
    ? rtkAutoTriggerRaw
    : DEFAULT_AUTO_TRIGGER_TOKENS;
  const rtkAutoOn = rtkAutoTrigger === 0 || estimateRequestTokens(translatedBody) >= rtkAutoTrigger;
  const rtkStats = compressMessages(translatedBody, tokenSaverEnabled && rtkEnabled && rtkAutoOn, {
    start: cacheState && cacheState.prefixLen > 0 ? cacheState.prefixLen : 0,
    mode: rtkMode || undefined,
  });
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);
  if (rtkStats) {
    saverEmit({
      stage: "rtk",
      bytesBefore: rtkStats.bytesBefore,
      bytesAfter: rtkStats.bytesAfter,
      hits: rtkStats.hits.length,
    });
  }

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(translatedBody, { enabled: tokenSaverEnabled && headroomEnabled, url: headroomUrl, model: upstreamModel, format: finalFormat, compressUserMessages: headroomCompressUserMessages, diagnostics: headroomDiagnostics });
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  if (headroomLine) {
    log?.info?.("HEADROOM", `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`);
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${formatHeadroomSizeLog(headroomDiagnostics)}`);
    }
  } else if (tokenSaverEnabled && headroomEnabled) log?.warn?.("HEADROOM", `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`);

  if (tokenSaverEnabled && headroomEnabled) {
    const hr = { stage: "headroom", applied: !!headroomStats };
    if (headroomDiagnostics?.before?.bodyBytes != null) hr.bodyBefore = headroomDiagnostics.before.bodyBytes;
    if (headroomDiagnostics?.after?.bodyBytes != null) hr.bodyAfter = headroomDiagnostics.after.bodyBytes;
    if (telemetryNumber(headroomStats?.tokens_before) !== undefined) hr.tokensBefore = telemetryNumber(headroomStats.tokens_before);
    if (telemetryNumber(headroomStats?.tokens_after) !== undefined) hr.tokensAfter = telemetryNumber(headroomStats.tokens_after);
    if (telemetryNumber(headroomStats?.tokens_saved) !== undefined) hr.tokensSaved = telemetryNumber(headroomStats.tokens_saved);
    if (!headroomStats && headroomDiagnostics?.reason) hr.reason = String(headroomDiagnostics.reason).slice(0, 120);
    saverEmit(hr);
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary = null;
  if (tokenSaverEnabled && pxpipeEnabled) {
    const pxpipeResult = await compressWithPxpipe(translatedBody, {
      enabled: true, format: finalFormat, model: upstreamModel,
      minChars: pxpipeMinChars, timeoutMs: pxpipeTimeoutMs, transform: pxpipeTransform,
    });
    pxpipeSummary = pxpipeResult.summary;
    if (pxpipeResult.body) translatedBody = pxpipeResult.body;
    if (pxpipeSummary?.applied) xf.push(`PXPIPE:${pxpipeSummary.imageCount}img`);
    try { onPxpipeEvent?.({ provider, model, ...pxpipeSummary }); } catch { /* stats must not break requests */ }
    saverEmit({
      stage: "pxpipe",
      applied: pxpipeSummary?.applied === true,
      reason: pxpipeSummary?.reason ? String(pxpipeSummary.reason).slice(0, 120) : undefined,
      tokensBeforeEst: telemetryNumber(pxpipeSummary?.tokensBeforeEst),
      tokensAfterEst: telemetryNumber(pxpipeSummary?.tokensAfterEst),
      tokensSavedEst: telemetryNumber(pxpipeSummary?.tokensSavedEst),
      savedPct: telemetryNumber(pxpipeSummary?.savedPct),
      imageCount: telemetryNumber(pxpipeSummary?.imageCount),
    });
  }

  // Cache interlock: restore the cached prefix if RTK/Headroom/PXPIPE mutated
  // it (or the whole body if a saver replaced the shape), then insert missing
  // breakpoints once the prefix is stable. Fail-open: on any error the request
  // proceeds without breakpoints.
  if (cacheState) {
    try {
      const l0 = finishCacheOrchestration(translatedBody, cacheState, { cacheKey, provider, model, onCacheEvent });
      if (l0.body !== translatedBody) translatedBody = l0.body;
      if (l0.info) {
        log?.debug?.("CACHE", `key=${cacheKey.slice(0, 24)}… turns=${l0.info.turns} stable=${l0.info.stable} bp=${l0.info.breakpoints}${l0.info.restored ? " prefix-restored" : ""}`);
      }
    } catch { /* fail-open: cache orchestration must never break the request */ }
  }

  if (xf.length && log?.line) log.line(reqTag, "⚙", xf.join(" · "));

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  // --- L1/L2 response cache: lookup before provider dispatch ---
  // Only deterministic (temperature=0 / seed-pinned) non-streaming, tool-free
  // requests are cacheable. X-Dardcor-Bypass: cache-l1,cache-l2,cache-l3.
  const cacheBypass = new Set(
    (clientRawRequest?.headers?.["x-dardcor-bypass"] || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const l1On = !!cacheL1Enabled && !cacheBypass.has("cache-l1") && !cacheBypass.has("cache");
  const l2On = !!cacheL2Enabled && typeof semanticEmbed === "function" && !!semanticCacheModel
    && !cacheBypass.has("cache-l2") && !cacheBypass.has("cache");
  const l3On = !!cacheL3Enabled && !cacheBypass.has("cache-l3") && !cacheBypass.has("cache");

  let cacheWriteCtx = null;
  if (!stream && (l1On || l2On)) {
    try {
      // Scope isolates entries across router API keys + provider accounts; the
      // raw scope only ever feeds the SHA-256 key.
      const scope = cacheScope(connectionId, apiKey);
      const key = l1CacheKey({ provider, model, sourceFormat, targetFormat, body: translatedBody, scope });
      const cacheable = isCacheableRequest(translatedBody, { stream });
      if (cacheable) {
        let hit = null;
        let l2Hit = null;
        let l2Attempted = true;
        if (l1On) {
          hit = l1Lookup(key);
          if (hit) emitCacheEvent(onCacheEvent, { type: "cache_l1", action: "hit", ts: Date.now(), provider, model });
        }
        if (!hit && l2On) {
          // Mirror L2's own gate (empty user text / code-shaped prompts) so a
          // skipped semantic attempt is recorded as a bypass, never a miss.
          const userText = lastUserText(translatedBody);
          l2Attempted = !!(userText && !looksLikeCodeGeneration(userText));
          if (l2Attempted) {
            l2Hit = await l2Lookup({
              provider, model, scope, sourceFormat, targetFormat, body: translatedBody,
              semanticEmbed, threshold: semanticCacheThreshold, ttlMs: semanticCacheTtl,
              maxEntries: semanticCacheMaxEntries, onCacheEvent,
            });
          }
        }
        saveMetrics(buildCacheMetricRows({ stream, cacheable: true, l1On, l2On, l1Hit: !!hit, l2Hit: !!l2Hit, l2Attempted, provider, model })).catch(() => {});
        if (hit || l2Hit) {
          const entry = hit || l2Hit.value;
          if (!hit && l2Hit && l1On) l1Store(key, entry);
          const layer = hit ? "L1" : "L2";
          trackPendingRequest(model, provider, connectionId, false);
          appendRequestLog({ model, provider, connectionId, status: "200 OK (CACHE)" }).catch(() => { });
          saveRequestDetail(buildRequestDetail({
            provider, model, connectionId,
            latency: { ttft: 0, total: Date.now() - requestStartTime },
            tokens: {},
            request: extractRequestConfig(body, stream),
            providerRequest: translatedBody,
            response: { content: "[cache hit]", thinking: null },
            status: "success"
          })).catch(() => { });
          if (onRequestSuccess) Promise.resolve().then(onRequestSuccess).catch(() => { });
          if (log?.line) {
            const sim = l2Hit ? ` sim=${(l2Hit.similarity * 100).toFixed(1)}%` : "";
            log.line(reqTag, "⚡", `CACHE ${layer} HIT · ${provider}/${model}${sim}`);
          }
          return {
            success: true,
            response: new Response(entry.body, {
              status: entry.status || 200,
              headers: {
                "Content-Type": entry.contentType || "application/json",
                "Access-Control-Allow-Origin": "*",
                "X-Dardcor-Cache": "HIT",
                "X-Dardcor-Cache-Layer": layer,
              },
            }),
          };
        }
        // Miss → remember to store after the provider responds. `body` is the
        // pre-L3 body (L3 runs after, non-mutating) so the stored entry keys
        // and embeds exactly what was queried.
        cacheWriteCtx = {
          key,
          layers: [l1On && "L1", l2On && "L2"].filter(Boolean),
          scope,
          body: translatedBody,
        };
      } else {
        saveMetrics(buildCacheMetricRows({ stream, cacheable: false, l1On, l2On, provider, model })).catch(() => {});
      }
    } catch { /* fail-open: response cache must never break the request */ }
  }

  // L3: dedup repeated large content blocks in the mutable tail (never the
  // L0-protected prefix). Runs AFTER the lookup so L1/L2 keys stay on the
  // untransformed body.
  if (l3On) {
    try {
      translatedBody = l3Transform(translatedBody, { minChars: cacheL3MinChars, provider, model, onCacheEvent });
    } catch { /* fail-open */ }
  }

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log, provider, model, reqTag
  });

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  // Execute request
  saverEmit({ stage: "provider" });
  let providerResponse, providerUrl, providerHeaders, finalBody;
  // Most executors return their registry format. Cursor AgentService is an
  // exception: it is decoded by the executor into OpenAI-compatible output.
  let providerResponseFormat = targetFormat;
  try {
    const result = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    providerResponseFormat = result.responseFormat || targetFormat;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    if (log?.errorLine) {
      log.errorLine(reqTag, "✗", `ERROR 502 · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${error.stack ? `\n    ${error.stack}` : ""}`);
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    try {
      // Mutate credentials after each successful refresh: rotating refresh_token
      // providers (xAI/grok-cli) issue a new RT on every refresh; without this,
      // refreshWithRetry's 2nd/3rd attempt reuses the already-consumed RT →
      // invalid_grant → auth_failed retryable=false.
      const newCredentials = await refreshWithRetry(async () => {
        const result = await executor.refreshCredentials(credentials, log);
        if (result?.refreshToken && result.refreshToken !== credentials.refreshToken) {
          if (result.accessToken) credentials.accessToken = result.accessToken;
          credentials.refreshToken = result.refreshToken;
        }
        return result;
      }, 3, log);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        if (log?.line) log.line(reqTag, "🔑", `TOKEN REFRESHED · ${provider}/${model}`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          const retryResult = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions });
          if (retryResult.response.ok) {
            providerResponse = retryResult.response;
            providerUrl = retryResult.url;
            providerResponseFormat = retryResult.responseFormat || targetFormat;
          }
        } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    if (log?.errorLine) {
      const urlStr = providerUrl ? `\n    URL: ${providerUrl}` : "";
      log.errorLine(reqTag, "✗", `ERROR ${statusCode} · ${provider}/${model} · ${Date.now() - requestStartTime}ms${urlStr}\n    ${errMsg}`);
    }
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, pxpipe: pxpipeSummary, reqTag, log, cacheKey, onCacheEvent, cacheWrite: cacheWriteCtx, semanticEmbed, semanticCacheThreshold, semanticCacheTtl, semanticCacheMaxEntries };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => { });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, customToolNames, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, reqLogger, toolNameMap, customToolNames, trackDone, appendLog });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, userAgent, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
