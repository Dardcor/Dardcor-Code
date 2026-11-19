
import { FORMATS } from "../translator/formats.js";

const DEBUG_USAGE = process.env.LOG_USAGE_VERBOSE === "1";

export const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

const BUFFER_TOKENS = 2000;

function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function addBufferToUsage(usage) {
  if (!usage || typeof usage !== "object") return usage;

  const result = { ...usage };

  if (result.input_tokens !== undefined) {
    result.input_tokens += BUFFER_TOKENS;
  }

  if (result.prompt_tokens !== undefined) {
    result.prompt_tokens += BUFFER_TOKENS;
  }

  if (result.total_tokens !== undefined) {
    result.total_tokens += BUFFER_TOKENS;
  } else if (result.prompt_tokens !== undefined && result.completion_tokens !== undefined) {
    result.total_tokens = result.prompt_tokens + result.completion_tokens;
  }

  return result;
}

export function filterUsageForFormat(usage, targetFormat) {
  if (!usage || typeof usage !== "object") return usage;

  const pickFields = (fields) => {
    const filtered = {};
    for (const field of fields) {
      if (usage[field] !== undefined) {
        filtered[field] = usage[field];
      }
    }
    return filtered;
  };

  const formatFields = {
    [FORMATS.CLAUDE]: [
      'input_tokens', 'output_tokens', 
      'cache_read_input_tokens', 'cache_creation_input_tokens',
      'estimated'
    ],
    [FORMATS.GEMINI]: [
      'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount',
      'cachedContentTokenCount', 'thoughtsTokenCount',
      'estimated'
    ],
    [FORMATS.OPENAI_RESPONSES]: [
      'input_tokens', 'output_tokens',
      'input_tokens_details', 'output_tokens_details',
      'estimated'
    ],
    default: [
      'prompt_tokens', 'completion_tokens', 'total_tokens',
      'cached_tokens', 'reasoning_tokens',
      'prompt_tokens_details', 'completion_tokens_details',
      'estimated'
    ]
  };

  let fields = formatFields[targetFormat];
  
  if (targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.ANTIGRAVITY) {
    fields = formatFields[FORMATS.GEMINI];
  } else if (targetFormat === FORMATS.OPENAI_RESPONSE) {
    fields = formatFields[FORMATS.OPENAI_RESPONSES];
  } else if (!fields) {
    fields = formatFields.default;
  }

  return pickFields(fields);
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const normalized = {};
  const assignNumber = (key, value) => {
    if (value === undefined || value === null) return;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) normalized[key] = numeric;
  };

  assignNumber("prompt_tokens", usage?.prompt_tokens);
  assignNumber("completion_tokens", usage?.completion_tokens);
  assignNumber("total_tokens", usage?.total_tokens);
  assignNumber("cache_read_input_tokens", usage?.cache_read_input_tokens);
  assignNumber("cache_creation_input_tokens", usage?.cache_creation_input_tokens);
  assignNumber("cached_tokens", usage?.cached_tokens);
  assignNumber("reasoning_tokens", usage?.reasoning_tokens);

  if (usage?.prompt_tokens_details && typeof usage.prompt_tokens_details === "object") {
    normalized.prompt_tokens_details = usage.prompt_tokens_details;
  }
  if (usage?.completion_tokens_details && typeof usage.completion_tokens_details === "object") {
    normalized.completion_tokens_details = usage.completion_tokens_details;
  }

  if (Object.keys(normalized).length === 0) return null;
  return normalized;
}

export function canonicalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const completion = num(usage.completion_tokens ?? usage.output_tokens);
  const reasoning = num(usage.reasoning_tokens);
  const cacheCreation = num(usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_creation_tokens);

  let prompt = num(usage.prompt_tokens ?? usage.input_tokens);
  let cached;

  if (usage.cached_tokens === undefined &&
      (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined)) {
    cached = num(usage.cache_read_input_tokens);
    prompt = prompt + cached + cacheCreation;
  } else {
    cached = num(usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens);
  }

  const result = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    cached_tokens: cached,
    cache_creation_input_tokens: cacheCreation,
  };
  if (reasoning > 0) result.reasoning_tokens = reasoning;
  return result;
}

export function hasValidUsage(usage) {
  if (!usage || typeof usage !== "object") return false;

  const tokenFields = [
    "prompt_tokens", "completion_tokens", "total_tokens",
    "input_tokens", "output_tokens",
    "promptTokenCount", "candidatesTokenCount"
  ];

  for (const field of tokenFields) {
    if (typeof usage[field] === "number" && usage[field] > 0) {
      return true;
    }
  }

  return false;
}

export function extractUsage(chunk) {
  if (!chunk || typeof chunk !== "object") return null;

  if (chunk.type === "message_start" && chunk.message?.usage && typeof chunk.message.usage === "object") {
    const u = chunk.message.usage;
    return normalizeUsage({
      prompt_tokens: u.input_tokens || 0,
      completion_tokens: u.output_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens
    });
  }

  if (chunk.type === "message_delta" && chunk.usage && typeof chunk.usage === "object") {
    return normalizeUsage({
      prompt_tokens: chunk.usage.input_tokens || 0,
      completion_tokens: chunk.usage.output_tokens || 0,
      cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
      cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens
    });
  }

  if ((chunk.type === "response.completed" || chunk.type === "response.done") && chunk.response?.usage && typeof chunk.response.usage === "object") {
    const usage = chunk.response.usage;
    const cachedTokens = usage.input_tokens_details?.cached_tokens;
    return normalizeUsage({
      prompt_tokens: usage.input_tokens || usage.prompt_tokens || 0,
      completion_tokens: usage.output_tokens || usage.completion_tokens || 0,
      cached_tokens: cachedTokens,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
      prompt_tokens_details: cachedTokens ? { cached_tokens: cachedTokens } : undefined
    });
  }

  if (chunk.usage && typeof chunk.usage === "object" && chunk.usage.prompt_tokens !== undefined) {
    return normalizeUsage({
      prompt_tokens: chunk.usage.prompt_tokens,
      completion_tokens: chunk.usage.completion_tokens || 0,
      cached_tokens: chunk.usage.prompt_tokens_details?.cached_tokens || chunk.usage.prompt_cache_hit_tokens,
      reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
      prompt_tokens_details: chunk.usage.prompt_tokens_details,
      completion_tokens_details: chunk.usage.completion_tokens_details
    });
  }

  const usageMeta = chunk.usageMetadata || chunk.response?.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    return normalizeUsage({
      prompt_tokens: usageMeta.promptTokenCount || 0,
      completion_tokens: usageMeta.candidatesTokenCount || 0,
      total_tokens: usageMeta.totalTokenCount,
      cached_tokens: usageMeta.cachedContentTokenCount,
      reasoning_tokens: usageMeta.thoughtsTokenCount
    });
  }

  if (chunk.done === true && typeof chunk.prompt_eval_count === "number") {
    return normalizeUsage({
      prompt_tokens: chunk.prompt_eval_count || 0,
      completion_tokens: chunk.eval_count || 0,
      total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
    });
  }

  return null;
}

export function mergeUsage(prev, next) {
  if (!prev) return next || null;
  if (!next) return prev;
  const merged = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      merged[k] = Math.max(typeof merged[k] === "number" ? merged[k] : 0, v);
    } else if (v && typeof v === "object") {
      merged[k] = v;
    }
  }
  return merged;
}

export function estimateInputTokens(body) {
  if (!body || typeof body !== "object") return 0;

  try {
    const bodyStr = JSON.stringify(body);
    const totalChars = bodyStr.length;

    return Math.ceil(totalChars / 4);
  } catch (err) {
    return 0;
  }
}

export function estimateOutputTokens(contentLength) {
  if (!contentLength || contentLength <= 0) return 0;
  return Math.max(1, Math.floor(contentLength / 4));
}

export function formatUsage(inputTokens, outputTokens, targetFormat) {
  if (targetFormat === FORMATS.CLAUDE) {
    return addBufferToUsage({ 
      input_tokens: inputTokens, 
      output_tokens: outputTokens, 
      estimated: true 
    });
  }

  return addBufferToUsage({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated: true
  });
}

export function estimateUsage(body, contentLength, targetFormat = FORMATS.OPENAI) {
  return formatUsage(
    estimateInputTokens(body),
    estimateOutputTokens(contentLength),
    targetFormat
  );
}

export function logUsage(provider, usage, model = null, connectionId = null, apiKey = null) {
  if (!usage || typeof usage !== "object") return;

  if (!DEBUG_USAGE) return;

  const p = provider?.toUpperCase() || "UNKNOWN";

  const inTokens = usage?.prompt_tokens || usage?.input_tokens || 0;
  const outTokens = usage?.completion_tokens || usage?.output_tokens || 0;
  const accountPrefix = connectionId ? connectionId.slice(0, 8) + "..." : "unknown";

  let msg = `[${getTimeString()}] 📊 ${COLORS.green}[USAGE] ${p} | in=${inTokens} | out=${outTokens} | account=${accountPrefix}${COLORS.reset}`;

  if (usage.estimated) {
    msg += ` ${COLORS.yellow}(estimated)${COLORS.reset}`;
  }

  const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens;
  if (cacheRead) msg += ` | cache_read=${cacheRead}`;

  const cacheCreation = usage.cache_creation_input_tokens;
  if (cacheCreation) msg += ` | cache_create=${cacheCreation}`;

  const reasoning = usage.reasoning_tokens;
  if (reasoning) msg += ` | reasoning=${reasoning}`;

  console.log(msg);
}
