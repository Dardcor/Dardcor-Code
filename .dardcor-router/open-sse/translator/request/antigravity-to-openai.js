import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index.js";
import { budgetToEffort } from "../concerns/thinking.js";
import { collapseTextParts } from "../concerns/message.js";

export function antigravityToOpenAIRequest(model, body, stream) {
  const req = body.request || body;
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  if (req.generationConfig) {
    const config = req.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: req.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
    if (config.topK !== undefined) {
      result.top_k = config.topK;
    }

    if (config.thinkingConfig) {
      const effort = budgetToEffort(config.thinkingConfig.thinkingBudget || 0);
      if (effort) result.reasoning_effort = effort;
    }
  }

  if (req.systemInstruction) {
    const systemText = extractText(req.systemInstruction);
    if (systemText) {
      result.messages.push({ role: ROLE.SYSTEM, content: systemText });
    }
  }

  if (req.contents && Array.isArray(req.contents)) {
    for (const content of req.contents) {
      const converted = convertContent(content);
      if (converted) {
        if (Array.isArray(converted)) {
          result.messages.push(...converted);
        } else {
          result.messages.push(converted);
        }
      }
    }
  }

  if (req.tools && Array.isArray(req.tools)) {
    result.tools = [];
    for (const tool of req.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: normalizeSchemaTypes(func.parameters) || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  return result;
}

function normalizeSchemaTypes(schema) {
  if (!schema || typeof schema !== "object") return schema;

  const result = Array.isArray(schema) ? [...schema] : { ...schema };


  if (typeof result.type === "string") {
    result.type = result.type.toLowerCase();
  }

  delete result.enumDescriptions;


  if (result.properties) {
    const normalized = {};
    for (const [key, val] of Object.entries(result.properties)) {
      normalized[key] = normalizeSchemaTypes(val);
    }
    result.properties = normalized;
  }

  if (result.items) {
    result.items = normalizeSchemaTypes(result.items);
  }

  return result;
}

function convertContent(content) {
  const role = content.role === GEMINI_ROLE.MODEL ? ROLE.ASSISTANT : content.role === GEMINI_ROLE.USER ? ROLE.USER : content.role;

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const textParts = [];
  const toolCalls = [];
  const toolResults = [];
  let reasoningContent = "";

  for (const part of content.parts) {
    if (part.thought === true && part.text) {
      reasoningContent += part.text;
      continue;
    }

    if (part.thoughtSignature && part.text !== undefined) {
      if (part.text) {
        textParts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
      }
      continue;
    }

    if (part.text !== undefined && part.text !== "") {
      textParts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    if (part.inlineData) {
      textParts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data)
        }
      });
    }

    if (part.functionCall) {
      toolCalls.push({
        id: part.functionCall.id || `call_${part.functionCall.name}`,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    if (part.functionResponse) {
      toolResults.push({
        role: ROLE.TOOL,
        tool_call_id: part.functionResponse.id || `call_${part.functionResponse.name}`,
        content: JSON.stringify(part.functionResponse.response?.result || part.functionResponse.response || {})
      });
    }
  }

  if (toolResults.length > 0) {
    if (toolCalls.length > 0 || textParts.length > 0 || reasoningContent) {
      const assistantMsg = { role: ROLE.ASSISTANT };
      if (textParts.length > 0) {
        assistantMsg.content = collapseTextParts(textParts);
      }
      if (reasoningContent) {
        assistantMsg.reasoning_content = reasoningContent;
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      return [...toolResults, assistantMsg];
    }
    return toolResults;
  }

  if (toolCalls.length > 0) {
    const msg = { role: ROLE.ASSISTANT };
    if (textParts.length > 0) {
      msg.content = collapseTextParts(textParts);
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    msg.tool_calls = toolCalls;
    return msg;
  }

  if (textParts.length > 0 || reasoningContent) {
    const msg = { role };
    if (textParts.length > 0) {
      msg.content = collapseTextParts(textParts);
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    return msg;
  }

  return null;
}

function extractText(instruction) {
  if (typeof instruction === "string") return instruction;
  if (instruction.parts && Array.isArray(instruction.parts)) {
    return instruction.parts.map(p => p.text || "").join("");
  }
  return "";
}

register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, antigravityToOpenAIRequest, null);
