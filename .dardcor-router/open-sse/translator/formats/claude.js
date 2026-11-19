import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";
import { adjustMaxTokens } from "./maxTokens.js";
import { applyCloaking } from "../../utils/claudeCloaking.js";
import { resolveSessionId } from "../../utils/sessionManager.js";
import { isValidClaudeSignature } from "../../utils/claudeSignature.js";
import { PROVIDERS } from "../../providers/index.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig.js";

const CACHE_CONTROL_5M = { type: "ephemeral" };
const CACHE_CONTROL_1H = { type: "ephemeral", ttl: "1h" };

export function lastCacheableToolIndex(tools) {
  if (!Array.isArray(tools)) return -1;
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i]?.defer_loading !== true) return i;
  }
  return -1;
}

export function hasValidContent(msg) {
  if (typeof msg.content === "string" && msg.content.trim()) return true;
  if (msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
    const block = msg.content;
    return !!((block.type === CLAUDE_BLOCK.TEXT && block.text?.trim()) ||
      block.type === CLAUDE_BLOCK.TOOL_USE ||
      block.type === CLAUDE_BLOCK.TOOL_RESULT ||
      block.type === CLAUDE_BLOCK.IMAGE ||
      block.type === CLAUDE_BLOCK.DOCUMENT);
  }
  if (Array.isArray(msg.content)) {
    return msg.content.some(block =>
      (block.type === CLAUDE_BLOCK.TEXT && block.text?.trim()) ||
      block.type === CLAUDE_BLOCK.TOOL_USE ||
      block.type === CLAUDE_BLOCK.TOOL_RESULT ||
      block.type === CLAUDE_BLOCK.IMAGE ||
      block.type === CLAUDE_BLOCK.DOCUMENT
    );
  }
  return false;
}
function normalizeMessageContent(msg) {
  const c = msg?.content;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    delete c.cache_control;
    msg.content = [c];
  }
  return msg;
}

function countCacheControlBlocks(body) {
  let n = 0;
  if (Array.isArray(body?.system)) for (const b of body.system) if (b?.cache_control) n++;
  if (Array.isArray(body?.tools)) for (const t of body.tools) if (t?.cache_control) n++;
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (Array.isArray(m?.content)) {
        for (const b of m.content) if (b?.cache_control) n++;
      } else if (m?.content && typeof m.content === "object" && m.content.cache_control) n++;
    }
  }
  return n;
}
function capCacheControlBlocks(body) {
  const isHead = (b) => {
    const sys = Array.isArray(body?.system) ? body.system : [];
    if (sys.length && sys[sys.length - 1] === b) return true;
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    const lastTool = lastCacheableToolIndex(tools);
    return lastTool >= 0 && tools[lastTool] === b;
  };
  const marked = [];
  if (Array.isArray(body?.system)) for (const b of body.system) if (b?.cache_control) marked.push(b);
  if (Array.isArray(body?.tools)) for (const t of body.tools) if (t?.cache_control) marked.push(t);
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (Array.isArray(m?.content)) for (const b of m.content) if (b?.cache_control) marked.push(b);
    }
  }
  const head = marked.filter(isHead);
  const rest = marked.filter(b => !isHead(b));
  const keep = Math.max(0, 4 - head.length);
  for (const b of rest.slice(0, Math.max(0, rest.length - keep))) delete b.cache_control;
}

export function fixToolUseOrdering(messages) {
  if (messages.length <= 1) return messages;

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      if (hasToolUse) {
        const newContent = [];
        let foundToolUse = false;

        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
            newContent.push(block);
          } else if (!foundToolUse) {
            newContent.push(block);
          }
        }

        msg.content = newContent;
      }
    }
  }

  const merged = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];

    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: CLAUDE_BLOCK.TEXT, text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];

      const toolResults = [...lastContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT)];
      const otherContent = [...lastContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT)];

      last.content = [...toolResults, ...otherContent];
    } else {
      const content = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }

  return merged;
}

const ADAPTIVE_THINKING_UNSUPPORTED = /haiku/i;

function handlesThinkingBlocks(provider) {
  return provider === "claude" || provider?.startsWith("anthropic-compatible") || provider === "deepseek";
}

function buildThinkingPlaceholder(provider) {
  const block = {
    type: CLAUDE_BLOCK.THINKING,
    thinking: ".",
  };

  if (provider !== "deepseek") {
    block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
  }

  return block;
}

const CLAUDE_SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

function hasForeignServerToolUseId(block) {
  return block?.type === CLAUDE_BLOCK.SERVER_TOOL_USE
    && !CLAUDE_SERVER_TOOL_USE_ID.test(String(block.id ?? ""));
}

export function normalizeClaudePassthrough(body, model = "") {
  if (!body || typeof body !== "object") return body;

  if (body.thinking?.type === "adaptive" && ADAPTIVE_THINKING_UNSUPPORTED.test(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  if (ADAPTIVE_THINKING_UNSUPPORTED.test(model) && body.output_config?.effort != null) {
    delete body.output_config.effort;
    if (Object.keys(body.output_config).length === 0) delete body.output_config;
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) normalizeMessageContent(msg);
  }

  if (Array.isArray(body.messages)) {
    const messages = [];
    for (const msg of body.messages) {
      if (msg.role !== ROLE.SYSTEM) {
        messages.push(msg);
        continue;
      }
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(b => (typeof b === "string" ? b : b?.text || "")).join("\n")
          : "";
      if (!text.trim()) continue;

      const block = { type: CLAUDE_BLOCK.TEXT, text };
      const prev = messages[messages.length - 1];
      if (prev?.role === ROLE.USER) {
        const content = typeof prev.content === "string"
          ? [{ type: CLAUDE_BLOCK.TEXT, text: prev.content }]
          : Array.isArray(prev.content) ? [...prev.content] : [];
        messages[messages.length - 1] = { ...prev, content: [...content, block] };
        continue;
      }
      messages.push({ role: ROLE.USER, content: [block] });
    }
    body.messages = messages;
  }

  const thinkingEnabled = body.thinking?.type === "enabled";
  const droppedServerToolUseIds = new Set();
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== ROLE.ASSISTANT || !Array.isArray(msg.content)) continue;
      let hasToolUse = false;
      let hasKeptThinking = false;
      const kept = [];
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
          if (isValidClaudeSignature(block.signature)) {
            hasKeptThinking = true;
            kept.push(block);
          }
          continue;
        }
        if (hasForeignServerToolUseId(block)) {
          if (block.id != null) droppedServerToolUseIds.add(String(block.id));
          continue;
        }
        if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
        kept.push(block);
      }
      msg.content = kept;
      if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
        msg.content.unshift(buildThinkingPlaceholder("claude"));
      }
    }
  }

  if (droppedServerToolUseIds.size > 0 && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!Array.isArray(msg.content)) continue;
      const kept = msg.content.filter(block => !(
        (block?.type === CLAUDE_BLOCK.TOOL_RESULT || block?.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT)
        && droppedServerToolUseIds.has(String(block.tool_use_id ?? ""))
      ));
      if (kept.length !== msg.content.length) {
        msg.content = kept;
      }
    }
  }

  if (Array.isArray(body.messages)) {
    body.messages = body.messages.filter(msg => {
      if (typeof msg.content === "string") return msg.content.trim().length > 0;
      if (!Array.isArray(msg.content)) return true;
      msg.content = msg.content.filter(block =>
        !(block?.type === CLAUDE_BLOCK.TEXT && !String(block.text ?? "").trim()));
      return msg.content.length > 0;
    });
  }

  return body;
}

function markLastCacheableBlock(msg) {
  if (!Array.isArray(msg?.content)) return false;
  for (let i = msg.content.length - 1; i >= 0; i--) {
    const block = msg.content[i];
    if (typeof block !== "object" || block === null) continue;
    if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;
    block.cache_control = { ...CACHE_CONTROL_5M };
    return true;
  }
  return false;
}

export function anchorClaudeCache(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) normalizeMessageContent(msg);
  }
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      if (t?.defer_loading === true) delete t.cache_control;
    }
  }

  if (Array.isArray(body.system)) {
    const last = body.system.length - 1;
    body.system.forEach((block, i) => {
      if (typeof block !== "object" || block === null) return;
      if (i === last) block.cache_control = { ...CACHE_CONTROL_1H };
      else delete block.cache_control;
    });
  }

  if (Array.isArray(body.tools)) {
    const last = lastCacheableToolIndex(body.tools);
    body.tools.forEach((tool, i) => {
      if (i === last) tool.cache_control = { ...CACHE_CONTROL_1H };
      else delete tool.cache_control;
    });
  }

  if (countCacheControlBlocks(body) >= 4) {
    capCacheControlBlocks(body);
    return body;
  }

  if (Array.isArray(body.messages)) {
    let anchored = null;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) delete block.cache_control;

      if (anchored || msg.role !== ROLE.ASSISTANT) continue;
      anchored = markLastCacheableBlock(msg);
    }

    if (!anchored) {
      for (let i = body.messages.length - 1; i >= 0 && !anchored; i--) {
        anchored = markLastCacheableBlock(body.messages[i]);
      }
    }
  }

  return body;
}

export function prepareClaudeRequest(body, provider = null, apiKey = null, connectionId = null, rawHeaders = null, sessionId = null) {
  if (PROVIDERS[provider]?.quirks?.dropOutputConfig) {
    delete body.output_config;
  }

  if (body.max_tokens) {
    const ceiling = getCapabilitiesForModel(provider, body.model).maxOutput || DEFAULT_MAX_TOKENS;
    if (body.max_tokens > ceiling) body.max_tokens = ceiling;

    if (body.thinking?.type === "enabled" && body.thinking.budget_tokens && body.thinking.budget_tokens >= body.max_tokens) {
      body.max_tokens = Math.min(body.thinking.budget_tokens + 1024, ceiling);
      if (body.thinking.budget_tokens >= body.max_tokens) {
        body.thinking.budget_tokens = Math.max(1024, body.max_tokens - 1024);
      }
    }
  }

  if (body.system && Array.isArray(body.system)) {
    body.system = body.system.map((block, i) => {
      const { cache_control, ...rest } = block;
      if (i === body.system.length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });
  }

  if (body.messages && Array.isArray(body.messages)) {
    const len = body.messages.length;
    let filtered = [];

    for (let i = 0; i < len; i++) {
      const msg = body.messages[i];
      normalizeMessageContent(msg);

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }

      const isFinalAssistant = i === len - 1 && msg.role === "assistant";
      if (isFinalAssistant || hasValidContent(msg)) {
        filtered.push(msg);
      }
    }

    filtered = fixToolUseOrdering(filtered);

    body.messages = filtered;

    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === "user";
    const thinkingEnabled = body.thinking?.type === "enabled" && lastMessageIsUser;

    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];

      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        if (!lastAssistantProcessed && msg.content.length > 0) {
          for (let j = msg.content.length - 1; j >= 0; j--) {
            const block = msg.content[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          lastAssistantProcessed = true;
        }

        if (handlesThinkingBlocks(provider)) {
          let hasToolUse = false;
          let hasKeptThinking = false;

          const isClaudeNative = provider === "claude";
          const isDeepSeek = provider === "deepseek";
          const kept = [];
          for (const block of msg.content) {
            const isThinking = block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING;
            if (isThinking) {
              if (isClaudeNative) {
                if (isValidClaudeSignature(block.signature)) {
                  hasKeptThinking = true;
                  kept.push(block);
                }
              } else if (isDeepSeek) {
                hasKeptThinking = true;
                kept.push(block);
              } else {
                block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
                hasKeptThinking = true;
                kept.push(block);
              }
              continue;
            }
            if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
            kept.push(block);
          }
          msg.content = kept;

          if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
            msg.content.unshift(buildThinkingPlaceholder(provider));
          }
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools)) {
    if (provider !== "claude") {
      const supportedTypes = PROVIDERS[provider]?.quirks?.claudeSupportedToolTypes;
      const hasWhitelist = Array.isArray(supportedTypes);
      body.tools = body.tools
        .filter(tool => {
          const t = tool?.type;
          if (!t || t === "function") return true;
          if (hasWhitelist) return supportedTypes.includes(t);
          return false;
        })
        .map(tool => {
          if (tool.function) {
            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters,
            };
          }
          if (hasWhitelist) return tool;
          const { type, ...rest } = tool;
          return rest;
        });
    }

    const lastCacheable = lastCacheableToolIndex(body.tools);
    body.tools = body.tools.map((tool, i) => {
      const { cache_control, ...rest } = tool;
      if (i === lastCacheable) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });

    if (body.tools.length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  if ((provider === "claude" || provider?.startsWith("anthropic-compatible")) && apiKey) {
    const sid = sessionId || resolveSessionId({ headers: rawHeaders, body, connectionId, scope: "claude" });
    body = applyCloaking(body, apiKey, sid);
  }

  return body;
}
