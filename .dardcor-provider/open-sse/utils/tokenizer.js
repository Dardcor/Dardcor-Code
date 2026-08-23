/**
 * Real BPE token counting for OpenAI-family models via gpt-tokenizer.
 *
 * OpenAI models get exact counts from the same encodings OpenAI ships;
 * any other model family (Claude, Gemini, GLM, …) falls back to an honest
 * chars/4 estimate marked as such. Provider-reported usage stays the
 * authoritative source — these counters only feed the provider-missing-usage
 * fallback and the /v1/messages/count_tokens route.
 */

import { encode as encodeO200k } from "gpt-tokenizer/encoding/o200k_base";
import { encode as encodeCl100k } from "gpt-tokenizer/encoding/cl100k_base";

// o200k_base: GPT-4o / GPT-4.1 / GPT-4.5 / GPT-5 and the o1/o3/o4 reasoning line
const O200K_RE = /\b(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o1|o3|o4)\b/i;
// cl100k_base: older GPT models (gpt-4, gpt-4-turbo, gpt-3.5, davinci line)
const CL100K_RE = /\b(gpt-4|gpt-3\.5|gpt-35|text-davinci|davinci|curie|babbage|ada)\b/i;

const ENCODERS = {
  o200k_base: encodeO200k,
  cl100k_base: encodeCl100k,
};

/**
 * Pick the BPE encoding for a model id, or null when the model is not an
 * OpenAI-family model (chars/4 fallback applies then).
 * @param {string} model - model id (may include provider prefix, e.g. "cx/gpt-5.4")
 * @returns {"o200k_base"|"cl100k_base"|null}
 */
export function selectEncoding(model) {
  if (typeof model !== "string" || !model) return null;
  // o200k families must win over cl100k's gpt-4 prefix (gpt-4o / gpt-4.1 / gpt-4.5)
  if (O200K_RE.test(model)) return "o200k_base";
  if (CL100K_RE.test(model)) return "cl100k_base";
  return null;
}

/**
 * Token counting metadata for a model: which encoding (if any) applies and
 * whether the count is exact BPE or an estimate.
 * @param {string} model
 * @returns {{encoding: ("o200k_base"|"cl100k_base"|null), exact: boolean}}
 */
export function tokenCounterInfo(model) {
  const encoding = selectEncoding(model);
  return { encoding, exact: encoding !== null };
}

/**
 * Count tokens in a text string. Exact BPE for OpenAI-family models,
 * honest chars/4 estimate for everything else. Never throws.
 * @param {string} text
 * @param {string} [model]
 * @returns {number}
 */
export function countTextTokens(text, model) {
  if (text == null) return 0;
  const str = typeof text === "string" ? text : String(text);
  if (!str) return 0;
  const encoding = selectEncoding(model);
  if (encoding) {
    try {
      return ENCODERS[encoding](str).length;
    } catch {
      // Fall through to the estimate on encoder failure — never throw.
    }
  }
  return Math.ceil(str.length / 4);
}

/**
 * Count tokens for a whole request body (messages, system, tools, …).
 * Stringifies then counts so any body shape is covered.
 * @param {object} body - request body (may carry its own .model)
 * @param {string} [model] - overrides body.model
 * @returns {number}
 */
export function countBodyTokens(body, model) {
  if (body == null) return 0;
  try {
    return countTextTokens(JSON.stringify(body), model ?? body?.model);
  } catch {
    return 0;
  }
}
