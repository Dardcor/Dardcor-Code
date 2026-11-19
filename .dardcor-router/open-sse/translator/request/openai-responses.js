import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
} from "../formats/responsesApi.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";

const MAX_TOOL_NAME_LEN = 128;

export function openaiResponsesToOpenAIRequest(model, body, stream, credentials) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  if (body.instructions) {
    result.messages.push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  let currentAssistantMsg = null;
  let pendingToolResults = [];
  let pendingReasoning = "";
  let pendingReasoningEncrypted = "";
  const additionalTools = [];
  const customToolNames = new Set();

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  const extractReasoningText = (item) => {
    if (Array.isArray(item.summary)) {
      const txt = item.summary.map(s => s?.text || "").filter(Boolean).join("\n");
      if (txt) return txt;
    }
    if (Array.isArray(item.content)) {
      const txt = item.content.map(c => c?.text || "").filter(Boolean).join("\n");
      if (txt) return txt;
    }
    return "";
  };

  const attachPendingReasoning = (msg) => {
    if (pendingReasoning) msg.reasoning_content = pendingReasoning;
    if (pendingReasoningEncrypted) msg.encrypted_content = pendingReasoningEncrypted;
    pendingReasoning = "";
    pendingReasoningEncrypted = "";
  };

  for (const item of inputItems) {
    const itemType = item.type || (item.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }

      const content = Array.isArray(item.content)
        ? item.content.map(c => {
          if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.INPUT_IMAGE) {
            const url = c.image_url || c.file_id || "";
            return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: c.detail || "auto" } };
          }
          return c;
        })
        : item.content;
      const msg = { role: item.role, content };
      if (item.role === ROLE.ASSISTANT) attachPendingReasoning(msg);
      else {
        pendingReasoning = "";
        pendingReasoningEncrypted = "";
      }
      result.messages.push(msg);
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL) {
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: ROLE.ASSISTANT,
          content: null,
          tool_calls: []
        };
        attachPendingReasoning(currentAssistantMsg);
      }
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") continue;
      if (itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL) customToolNames.add(item.name);
      const toolInput = itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL
        ? { input: typeof item.input === "string" ? item.input : JSON.stringify(item.input ?? "") }
        : item.arguments;
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: item.name,
          arguments: typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput ?? {})
        }
      });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }
      result.messages.push({
        role: ROLE.TOOL,
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === RESPONSES_ITEM.ADDITIONAL_TOOLS) {
      if (Array.isArray(item.tools)) additionalTools.push(...item.tools);
    }
    else if (itemType === RESPONSES_ITEM.REASONING) {
      const txt = extractReasoningText(item);
      if (txt) pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${txt}` : txt;
      if (typeof item.encrypted_content === "string" && item.encrypted_content) {
        pendingReasoningEncrypted = item.encrypted_content;
      }
      continue;
    }
  }

  if (currentAssistantMsg) {
    result.messages.push(currentAssistantMsg);
  }
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      result.messages.push(tr);
    }
  }

  const responseTools = [
    ...(Array.isArray(body.tools) ? body.tools : []),
    ...additionalTools,
  ];
  if (responseTools.length > 0) {
    result.tools = responseTools
      .map(tool => {
        if (tool.function) return tool;
        const name = tool.name;
        if (!name || typeof name !== "string" || name.trim() === "") return null;
        if (tool.type === "custom") {
          customToolNames.add(name);
          const formatHint = [tool.format?.syntax, tool.format?.definition].filter(Boolean).join("\n");
          return {
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name,
              description: [String(tool.description || ""), formatHint].filter(Boolean).join("\n\n"),
              parameters: {
                type: "object",
                properties: {
                  input: {
                    type: "string",
                    description: "Raw freeform input for this custom tool"
                  }
                },
                required: ["input"],
                additionalProperties: false
              }
            }
          };
        }
        return {
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name,
            description: String(tool.description || ""),
            parameters: normalizeToolParameters(tool.parameters),
            strict: tool.strict
          }
        };
      })
      .filter(Boolean);
  }
  if (customToolNames.size > 0) result._customToolNames = [...customToolNames];

  if (result.max_output_tokens !== undefined) {
    if (result.max_tokens === undefined) result.max_tokens = result.max_output_tokens;
    delete result.max_output_tokens;
  }

  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  if (typeof result.reasoning?.effort === "string") {
    result.reasoning_effort = result.reasoning.effort;
  }
  delete result.reasoning;
  delete result.client_metadata;

  return result;
}

function extractInstructionsText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c?.text === "string") return c.text;
      if (typeof c?.content === "string") return c.content;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function normalizeToolParameters(params) {
  if (!params) return { type: "object", properties: {} };
  if (params.type === "object" && !params.properties) return { ...params, properties: {} };
  return params;
}

function buildReasoningInputItem(msg) {
  if (!msg || typeof msg !== "object") return null;

  const encrypted =
    (typeof msg.encrypted_content === "string" && msg.encrypted_content) ||
    (typeof msg.reasoning_encrypted_content === "string" && msg.reasoning_encrypted_content) ||
    (typeof msg.reasoning?.encrypted_content === "string" && msg.reasoning.encrypted_content) ||
    "";

  let summaryText = "";
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
    summaryText = msg.reasoning_content;
  } else if (typeof msg.reasoning === "string" && msg.reasoning.trim()) {
    summaryText = msg.reasoning;
  } else if (Array.isArray(msg.reasoning_details)) {
    summaryText = msg.reasoning_details
      .map((d) => (typeof d?.text === "string" ? d.text : typeof d?.content === "string" ? d.content : ""))
      .filter(Boolean)
      .join("\n");
  }

  if (!encrypted && !summaryText) return null;

  const item = { type: RESPONSES_ITEM.REASONING };
  if (summaryText) {
    item.summary = [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: summaryText }];
  }
  if (encrypted) item.encrypted_content = encrypted;
  return item;
}

export function openaiToOpenAIResponsesRequest(model, body, stream, credentials) {
  if (body.input) {
    const out = { ...body, model, stream: true };
    if (out.max_output_tokens === undefined) {
      if (out.max_completion_tokens !== undefined) out.max_output_tokens = out.max_completion_tokens;
      else if (out.max_tokens !== undefined) out.max_output_tokens = out.max_tokens;
    }
    delete out.max_tokens;
    delete out.max_completion_tokens;
    return out;
  }

  const result = {
    model,
    input: [],
    stream: true,
    store: false
  };

  let hasSystemMessage = false;
  const messages = body.messages || [];

  for (const msg of messages) {
    if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
      if (!hasSystemMessage) {
        result.instructions = extractInstructionsText(msg.content);
        hasSystemMessage = true;
      }
      continue;
    }

    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      if (msg.role === ROLE.ASSISTANT) {
        const reasoningItem = buildReasoningInputItem(msg);
        if (reasoningItem) result.input.push(reasoningItem);
      }

      const contentType = msg.role === ROLE.USER ? RESPONSES_ITEM.INPUT_TEXT : RESPONSES_ITEM.OUTPUT_TEXT;
      const content = typeof msg.content === "string"
        ? [{ type: contentType, text: msg.content }]
        : Array.isArray(msg.content)
          ? msg.content.map(c => {
            if (c.type === OPENAI_BLOCK.TEXT) return { type: contentType, text: c.text };
            if (c.type === OPENAI_BLOCK.IMAGE_URL) {
              const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
              return { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: url, detail: c.image_url?.detail || "auto" };
            }
            if (c.type === RESPONSES_ITEM.INPUT_IMAGE) return c;
            const text = c.text || c.content || JSON.stringify(c);
            return { type: contentType, text: typeof text === "string" ? text : JSON.stringify(text) };
          })
          : [];

      if (content.length > 0) {
        result.input.push({
          type: RESPONSES_ITEM.MESSAGE,
          role: msg.role,
          content
        });
      }
    }

    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const name = typeof tc.function?.name === "string" ? tc.function.name.trim() : "";
        if (!name) continue;
        result.input.push({
          type: RESPONSES_ITEM.FUNCTION_CALL,
          call_id: clampResponsesCallId(tc.id),
          name: name.slice(0, MAX_TOOL_NAME_LEN),
          arguments: coerceResponsesArguments(tc.function?.arguments)
        });
      }
    }

    if (msg.role === ROLE.TOOL) {
      result.input.push({
        type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
        call_id: clampResponsesCallId(msg.tool_call_id),
        output: coerceResponsesOutput(msg.content)
      });
    }
  }

  if (!hasSystemMessage) {
    result.instructions = "";
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.map(tool => {
      if (tool.type === OPENAI_BLOCK.FUNCTION) {
        const name = typeof tool.function?.name === "string" ? tool.function.name.trim() : "";
        if (!name) return null;
        return {
          type: OPENAI_BLOCK.FUNCTION,
          name: name.slice(0, MAX_TOOL_NAME_LEN),
          description: String(tool.function.description || ""),
          parameters: normalizeToolParameters(tool.function.parameters),
          strict: tool.function.strict
        };
      }
      return tool;
    }).filter(Boolean);
  }

  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.max_output_tokens !== undefined) {
    result.max_output_tokens = body.max_output_tokens;
  } else if (body.max_completion_tokens !== undefined) {
    result.max_output_tokens = body.max_completion_tokens;
  } else if (body.max_tokens !== undefined) {
    result.max_output_tokens = body.max_tokens;
  }
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.reasoning !== undefined) result.reasoning = body.reasoning;
  if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort, summary: "auto" };
  if (body.service_tier !== undefined) result.service_tier = body.service_tier;
  if (body.prompt_cache_key !== undefined) result.prompt_cache_key = body.prompt_cache_key;

  return result;
}

register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, openaiResponsesToOpenAIRequest, null);
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, openaiToOpenAIResponsesRequest, null);
