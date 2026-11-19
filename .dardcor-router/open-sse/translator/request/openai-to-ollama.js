import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { parseDataUri } from "../concerns/image.js";
import { safeParseJSON } from "../concerns/json.js";
import { ROLE, OPENAI_BLOCK } from "../schema/index.js";

export function openaiToOllamaRequest(model, body, stream) {
  const result = {
    model: model,
    messages: normalizeMessages(body.messages),
    stream: stream
  };

  if (body.temperature !== undefined) {
    result.options = result.options || {};
    result.options.temperature = body.temperature;
  }

  if (body.max_tokens !== undefined) {
    result.options = result.options || {};
    result.options.num_predict = body.max_tokens;
  }

  if (body.top_p !== undefined) {
    result.options = result.options || {};
    result.options.top_p = body.top_p;
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools;
  }

  if (body.tool_choice) {
    result.tool_choice = body.tool_choice;
  }

  return result;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return messages;

  const result = [];
  const toolCallMap = new Map();

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) {
          toolCallMap.set(tc.id, tc.function.name);
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === ROLE.TOOL) {
      const toolResult = normalizeContent(msg.content);
      if (!toolResult) continue;

      const toolName = toolCallMap.get(msg.tool_call_id) || msg.name || "unknown_tool";

      result.push({
        role: ROLE.TOOL,
        tool_name: toolName,
        content: toolResult
      });
      continue;
    }

    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      const content = normalizeContent(msg.content) || "";
      
      const ollamaToolCalls = msg.tool_calls.map(tc => ({
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          index: tc.index || 0,
          name: tc.function?.name || "",
          arguments: typeof tc.function?.arguments === "string" 
            ? safeParseJSON(tc.function.arguments || "{}", {})
            : tc.function?.arguments || {}
        }
      }));

      result.push({
        role: ROLE.ASSISTANT,
        content: content,
        tool_calls: ollamaToolCalls
      });
      continue;
    }

    const role = msg.role;
    const content = normalizeContent(msg.content);
    const images = extractImagesFromContent(msg.content);

    if (!content && role !== ROLE.ASSISTANT) continue;

    const out = {
      role: role,
      content: content
    };

    if (images.length > 0) {
      out.images = images;
    }

    result.push(out);
  }

  return result;
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .filter(block => block && block.type === OPENAI_BLOCK.TEXT && block.text)
      .map(block => block.text);

    return textParts.join("\n") || "";
  }

  return "";
}

function extractImagesFromContent(content) {
  if (!Array.isArray(content)) return [];

  const images = [];

  for (const block of content) {
    if (!block || block.type !== OPENAI_BLOCK.IMAGE_URL) continue;

    const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
    if (typeof url !== "string" || !url) continue;

    const parsed = parseDataUri(url);
    if (!parsed) continue;

    images.push(parsed.base64);
  }

  return images;
}

register(FORMATS.OPENAI, FORMATS.OLLAMA, openaiToOllamaRequest, null);
