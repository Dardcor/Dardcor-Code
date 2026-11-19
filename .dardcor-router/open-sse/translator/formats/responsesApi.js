import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";

export function normalizeResponsesInput(input) {
  if (typeof input === "string") {
    const text = input.trim() === "" ? "..." : input;
    return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] }];
  }
  if (Array.isArray(input)) {
    if (input.length === 0) {
      return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "..." }] }];
    }
    return input;
  }
  return null;
}

export const MAX_RESPONSES_CALL_ID_LEN = 64;

let responsesCallIdSeq = 0;

export function clampResponsesCallId(id) {
  if (typeof id !== "string" || !id) return `call_${Date.now()}_${(responsesCallIdSeq += 1)}`;
  return id.length > MAX_RESPONSES_CALL_ID_LEN ? id.substring(0, MAX_RESPONSES_CALL_ID_LEN) : id;
}

export function coerceResponsesArguments(value) {
  if (value === undefined || value === null || value === "") return "{}";
  if (typeof value !== "string") {
    try {
      return JSON.stringify(value);
    } catch {
      return "{}";
    }
  }
  try {
    JSON.parse(value);
    return value;
  } catch {
    return "{}";
  }
}

export function coerceResponsesOutput(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.map((c) => {
      try {
        return c?.text ?? JSON.stringify(c);
      } catch {
        return String(c);
      }
    }).join("");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function convertResponsesApiFormat(body) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  if (body.instructions) {
    result.messages.push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  let currentAssistantMsg = null;
  let pendingToolCalls = [];
  let pendingToolResults = [];

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

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
      result.messages.push({ role: item.role, content });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL) {
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: ROLE.ASSISTANT,
          content: null,
          tool_calls: []
        };
      }
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") continue;
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: item.name,
          arguments: item.arguments
        }
      });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      pendingToolResults.push({
        role: ROLE.TOOL,
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === RESPONSES_ITEM.REASONING) {
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

  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  delete result.reasoning;

  return result;
}
