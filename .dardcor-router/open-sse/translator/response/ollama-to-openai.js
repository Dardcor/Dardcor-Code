import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

export function ollamaToOpenAIResponse(chunk, state) {
  if (!chunk || typeof chunk !== "object") return null;

  if (!state.ollama) {
    state.ollama = {
      id: `chatcmpl-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: chunk.model || state.model
    };
  }

  const { id, created, model } = state.ollama;

  if (chunk.done) {
    const usage = extractUsage(chunk);
    
    let finishReason = toOpenAIFinish(chunk.done_reason, "ollama");
    if (chunk.done_reason === OPENAI_FINISH.TOOL_CALLS || state.hadToolCalls) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }

    const doneChunk = buildChunk({ id, created, model }, {}, finishReason);
    doneChunk.usage = usage;
    return doneChunk;
  }

  const message = chunk.message;
  if (!message) return null;

  const content = typeof message.content === "string" ? message.content : "";
  const thinking = typeof message.thinking === "string" ? message.thinking : "";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : null;

  if (!content && !thinking && !toolCalls) return null;

  if (content) {
    state.accumulatedContent = (state.accumulatedContent || "") + content;
  }
  if (thinking) {
    state.accumulatedThinking = (state.accumulatedThinking || "") + thinking;
  }

  const delta = {};
  if (content) delta.content = content;
  if (thinking) delta.reasoning_content = thinking;
  
  if (toolCalls) {
    state.hadToolCalls = true;
    delta.tool_calls = convertToolCalls(toolCalls);
  }

  return buildChunk({ id, created, model }, delta, null);
}

function extractUsage(ollamaChunk) {
  return toOpenAIUsage(ollamaChunk, "ollama");
}

function convertToolCalls(toolCalls) {
  return toolCalls.map((tc, i) => ({
    index: tc.function?.index ?? i,
    id: tc.id || fallbackToolCallId(i),
    type: OPENAI_BLOCK.FUNCTION,
    function: {
      name: tc.function?.name || "",
      arguments: typeof tc.function?.arguments === "string"
        ? tc.function.arguments
        : JSON.stringify(tc.function?.arguments || {})
    }
  }));
}

export function ollamaBodyToOpenAI(body) {
  const msg = body.message || {};
  const content = msg.content || "";
  const thinking = msg.thinking || "";
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

  const message = { role: ROLE.ASSISTANT };
  if (content) message.content = content;
  if (thinking) message.reasoning_content = thinking;
  if (toolCalls.length > 0) message.tool_calls = convertToolCalls(toolCalls);
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = toOpenAIFinish(body.done_reason, "ollama");
  if (toolCalls.length > 0) finishReason = OPENAI_FINISH.TOOL_CALLS;

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model || "ollama",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: extractUsage(body)
  };
}

register(FORMATS.OLLAMA, FORMATS.OPENAI, null, ollamaToOpenAIResponse);
