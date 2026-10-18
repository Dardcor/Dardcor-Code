
import { FORMATS } from "../formats.js";

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function fallbackToolCallId(index) {
  return index === undefined ? `call_${Date.now()}` : `call_${index}_${Date.now()}`;
}

export function generateToolCallId(msgIndex = 0, tcIndex = 0, toolName = "") {
  const name = toolName ? `_${toolName.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  return `call_msg${msgIndex}_tc${tcIndex}${name}`;
}

function sanitizeToolId(id) {
  if (!id || typeof id !== "string") return null;
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

export function ensureToolCallIds(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (msg.role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (let j = 0; j < msg.tool_calls.length; j++) {
        const tc = msg.tool_calls[j];
        if (!tc.id || !TOOL_ID_PATTERN.test(tc.id)) {
          const sanitized = sanitizeToolId(tc.id);
          tc.id = sanitized || generateToolCallId(i, j, tc.function?.name);
        }
        if (!tc.type) {
          tc.type = "function";
        }
        if (tc.function?.arguments && typeof tc.function.arguments !== "string") {
          tc.function.arguments = JSON.stringify(tc.function.arguments);
        }
      }
    }

    if (msg.role === "tool" && msg.tool_call_id && !TOOL_ID_PATTERN.test(msg.tool_call_id)) {
      const sanitized = sanitizeToolId(msg.tool_call_id);
      msg.tool_call_id = sanitized || generateToolCallId(i, 0);
    }

    if (Array.isArray(msg.content)) {
      for (let k = 0; k < msg.content.length; k++) {
        const block = msg.content[k];
        if (block.type === "tool_use" && block.id && !TOOL_ID_PATTERN.test(block.id)) {
          const sanitized = sanitizeToolId(block.id);
          block.id = sanitized || generateToolCallId(i, k, block.name);
        }
        if (block.type === "tool_result" && block.tool_use_id && !TOOL_ID_PATTERN.test(block.tool_use_id)) {
          const sanitized = sanitizeToolId(block.tool_use_id);
          block.tool_use_id = sanitized || generateToolCallId(i, k);
        }
      }
    }
  }

  return body;
}

export function getToolCallIds(msg) {
  if (msg.role !== "assistant") return [];

  const ids = [];

  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc.id) ids.push(tc.id);
    }
  }

  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id) {
        ids.push(block.id);
      }
    }
  }

  return ids;
}

export function hasToolResults(msg, toolCallIds) {
  if (!msg || !toolCallIds.length) return false;

  if (msg.role === "tool" && msg.tool_call_id) {
    return toolCallIds.includes(msg.tool_call_id);
  }

  if (msg.role === "user" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_result" && toolCallIds.includes(block.tool_use_id)) {
        return true;
      }
    }
  }

  return false;
}

export function fixMissingToolResponses(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  const newMessages = [];

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    const nextMsg = body.messages[i + 1];

    newMessages.push(msg);

    const toolCallIds = getToolCallIds(msg);
    if (toolCallIds.length === 0) continue;

    if (nextMsg && !hasToolResults(nextMsg, toolCallIds)) {
      for (const id of toolCallIds) {
        newMessages.push({
          role: "tool",
          tool_call_id: id,
          content: ""
        });
      }
    }
  }

  body.messages = newMessages;
  return body;
}

export function defaultClaudeToolType(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map(tool => tool?.type ? tool : { ...tool, type: "custom" });
}

export function shouldDefaultClaudeToolType(provider, finalFormat, tools, PROVIDERS) {
  return (
    finalFormat === FORMATS.CLAUDE
    && Array.isArray(tools)
    && PROVIDERS?.[provider]?.quirks?.requireClaudeToolType === true
  );
}

