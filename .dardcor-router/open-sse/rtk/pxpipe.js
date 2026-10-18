import { FORMATS } from "../translator/formats.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MIN_CHARS = 25000;
const EST_CHARS_PER_TOKEN = 4;

function bodyChars(body) {
  try {
    return JSON.stringify(body)?.length || 0;
  } catch {
    return 0;
  }
}

function estTokens(chars) {
  return Math.round(chars / EST_CHARS_PER_TOKEN);
}

function skipped(reason, extra = {}) {
  return { body: null, summary: { applied: false, reason, ...extra } };
}

export async function compressWithPxpipe(body, { enabled, format, model, minChars, timeoutMs, transform } = {}) {
  if (!enabled) return skipped("disabled");
  if (typeof transform !== "function") return skipped("not_installed");
  if (!body) return skipped("missing_body");
  if (format !== FORMATS.CLAUDE) return skipped("unsupported_format", { detail: format });

  const startedAt = Date.now();
  const originalChars = bodyChars(body);
  const threshold = Number(minChars) > 0 ? Number(minChars) : DEFAULT_MIN_CHARS;
  if (originalChars < threshold) {
    return skipped("below_threshold", { originalChars, threshold });
  }

  try {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    const result = await Promise.race([
      transform({
        body: encoded,
        model,
        options: { minCompressChars: threshold },
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), budget)),
    ]);
    if (!result) return skipped("timeout", { originalChars, durationMs: Date.now() - startedAt });
    if (!result.applied) {
      return skipped(result.reason || "passthrough", {
        detail: result.detail,
        originalChars,
        durationMs: Date.now() - startedAt,
      });
    }

    const newBody = JSON.parse(new TextDecoder().decode(result.body));
    const compressedBodyChars = bodyChars(newBody);
    const info = result.info || {};
    const imagedChars = info.compressedChars || 0;
    const imageTokensEst = info.imageTokens
      || (info.imagePixels ? Math.round(info.imagePixels / 750) : (info.imageCount || 0) * 4761);
    const summary = {
      applied: true,
      reason: "applied",
      originalChars,
      compressedBodyChars,
      imagedChars,
      imageCount: info.imageCount || 0,
      imageBytes: info.imageBytes || 0,
      tokensBeforeEst: info.baselineTokens || estTokens(originalChars),
      tokensAfterEst: estTokens(Math.max(0, originalChars - imagedChars)) + imageTokensEst,
      durationMs: Date.now() - startedAt,
      cacheOwnsControl: result.cache?.ownsCacheControl === true,
    };
    summary.tokensSavedEst = Math.max(0, summary.tokensBeforeEst - summary.tokensAfterEst);
    summary.savedPct = summary.tokensBeforeEst > 0
      ? +((summary.tokensSavedEst / summary.tokensBeforeEst) * 100).toFixed(2)
      : 0;
    return { body: newBody, summary };
  } catch (e) {
    return skipped("transform_error", { detail: e?.message || String(e), originalChars, durationMs: Date.now() - startedAt });
  }
}

export function formatPxpipeLog(summary) {
  if (!summary) return null;
  if (!summary.applied) return null;
  return `imaged ${summary.imagedChars}ch → ${summary.imageCount} image(s) | est ${summary.tokensBeforeEst}→${summary.tokensAfterEst} tokens (-${summary.savedPct}%) | ${summary.durationMs}ms`;
}
