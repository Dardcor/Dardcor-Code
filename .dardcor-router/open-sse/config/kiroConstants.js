
import { extractThinking, parseSuffix } from "../translator/concerns/thinkingUnified.js";
import { effortToBudget } from "../translator/concerns/thinking.js";

export const KIRO_AGENTIC_SUFFIX = "-agentic";
export const KIRO_THINKING_SUFFIX = "-thinking";
export const KIRO_TOOL_NAME_MAX_LENGTH = 64;
export const KIRO_TOOL_DESCRIPTION_MAX_LENGTH = 10237;
export const KIRO_TOOL_ID_MAX_LENGTH = 64;
export const KIRO_CODEWHISPERER_TARGET =
  "AmazonCodeWhispererStreamingService.GenerateAssistantResponse";
export const KIRO_ENDPOINT_FALLBACK_STATUSES = new Set([401, 403, 404]);

export const KIRO_DEFAULT_PROFILE_ARNS = {
  "builder-id": "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
  social: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
};

export const KIRO_DEFAULT_PROFILE_ARN = KIRO_DEFAULT_PROFILE_ARNS["builder-id"];

export function resolveDefaultProfileArn(authMethod) {
  const social = authMethod === "google" || authMethod === "github";
  return social ? KIRO_DEFAULT_PROFILE_ARNS.social : KIRO_DEFAULT_PROFILE_ARNS["builder-id"];
}

export const KIRO_THINKING_BUDGET_DEFAULT = 16000;

export function resolveKiroModelIntent(model) {
  const { cleanModel, override } = parseSuffix(model);
  return {
    model: cleanModel,
    ...resolveKiroModel(cleanModel),
    thinkingOverride: override,
  };
}

export function applyKiroThinkingOverride(body, override) {
  if (!override) return body;

  const next = { ...body };
  if (override.mode === "budget") {
    delete next.output_config;
    delete next.reasoning_effort;
    delete next.reasoning;
    next.thinking = { type: "enabled", budget_tokens: override.budget };
    return next;
  }

  next.output_config = {
    ...(body.output_config || {}),
    effort: override.mode === "level" ? override.level : override.mode,
  };
  return next;
}

export const KIRO_AGENTIC_SYSTEM_PROMPT = `
# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- **NEVER** write entire files in one operation if >300 lines

## MANDATORY CHUNKED WRITE STRATEGY

### For NEW FILES (>300 lines total):
1. FIRST: Write initial chunk (first 250-300 lines) using write_to_file/fsWrite
2. THEN: Append remaining content in 250-300 line chunks using file append operations
3. REPEAT: Continue appending until complete

### For EDITING EXISTING FILES:
1. Use surgical edits (apply_diff/targeted edits) - change ONLY what's needed
2. NEVER rewrite entire files - use incremental modifications
3. Split large refactors into multiple small, focused edits

### For LARGE CODE GENERATION:
1. Generate in logical sections (imports, types, functions separately)
2. Write each section as a separate operation
3. Use append operations for subsequent sections

## EXAMPLES OF CORRECT BEHAVIOR

CORRECT: Writing a 600-line file
- Operation 1: Write lines 1-300 (initial file creation)
- Operation 2: Append lines 301-600

CORRECT: Editing multiple functions
- Operation 1: Edit function A
- Operation 2: Edit function B
- Operation 3: Edit function C

WRONG: Writing 500 lines in single operation -> TIMEOUT
WRONG: Rewriting entire file to change 5 lines -> TIMEOUT
WRONG: Generating massive code blocks without chunking -> TIMEOUT

## WHY THIS MATTERS
- Server has 2-3 minute timeout for operations
- Large writes exceed timeout and FAIL completely
- Chunked writes are FASTER and more RELIABLE
- Failed writes waste time and require retry

REMEMBER: When in doubt, write LESS per operation. Multiple small operations > one large operation.
`.trim();

export function resolveKiroThinkingBudget(body, headers, model) {
  const cfg = extractThinking(body);
  if (cfg) {
    if (cfg.mode === "none") return null;
    if (cfg.mode === "level" && cfg.level === "disabled") return null;
    if (cfg.mode === "budget") return cfg.budget;
    if (cfg.mode === "level") return effortToBudget(cfg.level) ?? KIRO_THINKING_BUDGET_DEFAULT;
    return KIRO_THINKING_BUDGET_DEFAULT;
  }

  if (headers) {
    const beta = pickHeader(headers, "anthropic-beta");
    if (typeof beta === "string" && beta.toLowerCase().includes("interleaved-thinking")) {
      return KIRO_THINKING_BUDGET_DEFAULT;
    }
  }

  if (containsThinkingModeTag(body)) return KIRO_THINKING_BUDGET_DEFAULT;

  if (typeof model === "string" && model) {
    const m = model.toLowerCase();
    if (m.includes("thinking") || m.includes("-reason")) return KIRO_THINKING_BUDGET_DEFAULT;
  }

  return null;
}

export function extractKiroEffortLevel(body) {
  const effort =
    body?.output_config?.effort ??
    body?.reasoning_effort ??
    (typeof body?.reasoning === "object" ? body.reasoning?.effort : null);
  if (typeof effort !== "string") return null;
  const normalized = effort.toLowerCase();
  if (normalized === "none" || normalized === "off" || normalized === "disabled") return null;
  if (normalized === "xhigh" || normalized === "max") return "high";
  if (["low", "medium", "high"].includes(normalized)) return normalized;
  return null;
}

function extractKiroGptEffortLevel(body) {
  const effort =
    body?.output_config?.effort ??
    body?.reasoning_effort ??
    (typeof body?.reasoning === "object" ? body.reasoning?.effort : null);
  if (typeof effort !== "string") return null;
  const normalized = effort.toLowerCase();
  if (normalized === "max") return "xhigh";
  if (["low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized;
  }
  return null;
}

export function buildKiroAdditionalModelRequestFields(body, effortPath = "output_config") {
  const effort = effortPath === "reasoning"
    ? extractKiroGptEffortLevel(body)
    : extractKiroEffortLevel(body);
  if (!effort) return undefined;
  if (effortPath === "reasoning") {
    return { reasoning: { effort } };
  }
  return {
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort },
  };
}

export function resolveKiroEffortPath(model) {
  if (typeof model !== "string") return null;
  const normalized = model.toLowerCase().replace(/-/g, ".");
  if (/(?:^|[/.])gpt[/.]5[/.]6(?:[/.]|$)/.test(normalized)) {
    return "reasoning";
  }
  if (!normalized.includes("claude")) return null;
  const match = normalized.match(/(?:^|[/.])claude(?:[/.][a-z]+)*[/.](\d+)(?:[/.](\d+))?(?:[/.]|$)/);
  if (!match) return null;
  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = minorText === undefined ? null : Number(minorText);
  const dateSuffixMinor = minor !== null && minor >= 1000;
  return major < 4 || (major === 4 && (minor === null || minor <= 5 || dateSuffixMinor))
    ? null
    : "output_config";
}

export function supportsKiroAdditionalModelRequestFields(model) {
  return resolveKiroEffortPath(model) !== null;
}

export function usesKiroNativeGptEffort(body, model) {
  return resolveKiroEffortPath(model) === "reasoning"
    && extractKiroGptEffortLevel(body) !== null;
}

export function buildKiroAdditionalModelRequestFieldsForModel(body, model) {
  const effortPath = resolveKiroEffortPath(model);
  if (!effortPath) return undefined;
  return buildKiroAdditionalModelRequestFields(body, effortPath);
}

export function isThinkingEnabled(body, headers, model) {
  return resolveKiroThinkingBudget(body, headers, model) !== null;
}

export function isAgenticModel(model) {
  return typeof model === "string" && model.endsWith(KIRO_AGENTIC_SUFFIX);
}

export function stripAgenticSuffix(model) {
  if (!isAgenticModel(model)) return model;
  return model.slice(0, -KIRO_AGENTIC_SUFFIX.length);
}

export function isThinkingModel(model) {
  return typeof model === "string" && model.endsWith(KIRO_THINKING_SUFFIX);
}

export function stripThinkingSuffix(model) {
  if (!isThinkingModel(model)) return model;
  return model.slice(0, -KIRO_THINKING_SUFFIX.length);
}

export function resolveKiroModel(model) {
  let upstream = model;
  let agentic = false;
  let thinking = false;
  if (isAgenticModel(upstream)) {
    agentic = true;
    upstream = stripAgenticSuffix(upstream);
  }
  if (isThinkingModel(upstream)) {
    thinking = true;
    upstream = stripThinkingSuffix(upstream);
  }
  return { upstream, agentic, thinking };
}

export function buildThinkingSystemPrefix(budget = KIRO_THINKING_BUDGET_DEFAULT) {
  const safeBudget = Math.max(1, Math.min(32000, Number(budget) || KIRO_THINKING_BUDGET_DEFAULT));
  return `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${safeBudget}</max_thinking_length>`;
}

function pickHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

function containsThinkingModeTag(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role !== "system" && msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") {
      if (containsTagInText(content)) return true;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const text = part?.text;
        if (typeof text === "string" && containsTagInText(text)) return true;
      }
    }
  }
  if (typeof body?.system === "string" && containsTagInText(body.system)) return true;
  return false;
}

function containsTagInText(text) {
  if (!text) return false;
  if (!text.includes("<thinking_mode>")) return false;
  return text.includes("<thinking_mode>enabled</thinking_mode>")
    || text.includes("<thinking_mode>interleaved</thinking_mode>");
}
