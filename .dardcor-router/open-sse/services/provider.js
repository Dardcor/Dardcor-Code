import { PROVIDERS } from "../config/providers.js";
import { OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";

const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: OPENAI_COMPAT_BASE,
};

const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: ANTHROPIC_COMPAT_BASE,
};

function isOpenAICompatible(provider) {
  return typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

function isAnthropicCompatible(provider) {
  return typeof provider === "string" && provider.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

export function resolveOpenAICompatibleApiType(provider, credentials = null) {
  const stored = credentials?.providerSpecificData?.apiType;
  if (stored === "chat" || stored === "responses") return stored;
  return typeof provider === "string" && provider.includes("responses") ? "responses" : "chat";
}

export function detectFormat(body) {
  if (body.input && (Array.isArray(body.input) || typeof body.input === "string") && !body.messages) {
    return "openai-responses";
  }

  if (body.request?.contents && body.userAgent === "antigravity") {
    return "antigravity";
  }

  if (body.contents && Array.isArray(body.contents)) {
    return "gemini";
  }

  if (
    body.stream_options ||
    body.response_format ||
    body.logprobs !== undefined ||
    body.top_logprobs !== undefined ||
    body.n !== undefined ||
    body.presence_penalty !== undefined ||
    body.frequency_penalty !== undefined ||
    body.logit_bias ||
    body.user
  ) {
    return "openai";
  }

  if (body.messages && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0];
    
    if (firstMsg?.content && Array.isArray(firstMsg.content)) {
      const firstContent = firstMsg.content[0];
      
      if (firstContent?.type === "text" && !body.model?.includes("/")) {
        if (body.system || body.anthropic_version) {
          return "claude";
        }
        const hasClaudeImage = firstMsg.content.some(c => 
          c.type === "image" && c.source?.type === "base64"
        );
        const hasOpenAIImage = firstMsg.content.some(c => 
          c.type === "image_url" && c.image_url?.url
        );
        if (hasClaudeImage) return "claude";
        if (hasOpenAIImage) return "openai";
        
        const hasClaudeTool = firstMsg.content.some(c => 
          c.type === "tool_use" || c.type === "tool_result"
        );
        if (hasClaudeTool) return "claude";
      }
    }
    
    if (body.system !== undefined || body.anthropic_version) {
      return "claude";
    }
  }

  return "openai";
}

function getProviderConfig(provider, credentials = null) {
  if (isOpenAICompatible(provider)) {
    const apiType = resolveOpenAICompatibleApiType(provider, credentials);
    return {
      ...PROVIDERS.openai,
      format: apiType === "responses" ? "openai-responses" : "openai",
      baseUrl: OPENAI_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  if (isAnthropicCompatible(provider)) {
    return {
      ...PROVIDERS.anthropic,
      format: "claude",
      baseUrl: ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  return PROVIDERS[provider] || PROVIDERS.openai;
}

export function getTargetFormat(provider, credentials = null) {
  if (isOpenAICompatible(provider)) {
    return resolveOpenAICompatibleApiType(provider, credentials) === "responses" ? "openai-responses" : "openai";
  }
  if (isAnthropicCompatible(provider)) {
    return "claude";
  }
  const config = getProviderConfig(provider, credentials);
  return config.format || "openai";
}

export function resolveTransport(provider, sourceFormat) {
  const config = PROVIDERS[provider];
  const transports = config?.transports;
  if (!Array.isArray(transports) || !transports.length) return null;
  return transports.find(t => t.format === sourceFormat) || null;
}

export function isLastMessageFromUser(body) {
  const messages = body.messages || body.contents;
  if (!messages?.length) return true;
  const lastMsg = messages[messages.length - 1];
  return lastMsg?.role === "user";
}

export function hasThinkingConfig(body) {
  return !!(body.reasoning_effort || body.thinking?.type === "enabled");
}

export function normalizeThinkingConfig(body) {
  if (!isLastMessageFromUser(body)) {
    delete body.thinking;
  }
  return body;
}
