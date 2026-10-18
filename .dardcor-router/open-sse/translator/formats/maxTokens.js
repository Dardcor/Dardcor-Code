import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

export function adjustMaxTokens(body, ceiling = DEFAULT_MAX_TOKENS) {
  let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;

  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) {
      maxTokens = DEFAULT_MIN_TOKENS;
    }
  }

  if (body.thinking?.budget_tokens && maxTokens <= body.thinking.budget_tokens) {
    maxTokens = body.thinking.budget_tokens + 1024;
  }

  if (maxTokens > ceiling) maxTokens = ceiling;

  return maxTokens;
}

