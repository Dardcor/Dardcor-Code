import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

function chunkMeta(state) {
  return { id: state.responseId, created: state.created, model: state.model || "kiro" };
}

export function kiroToOpenAIResponse(chunk, state) {
  
  if (!chunk) return null;

  if (chunk.object === "chat.completion.chunk" && chunk.choices) {
    return chunk;
  }
  
  let data = chunk;
  if (typeof chunk === "string") {
    const lines = chunk.split("\n");
    let eventType = "";
    let eventData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith(":event-type:")) {
        eventType = line.slice(12).trim();
      } else if (line.startsWith("data:")) {
        eventData = line.slice(5).trim();
      } else if (line.startsWith(":content-type:")) {
      } else if (line.trim() && !line.startsWith(":")) {
        eventData = line.trim();
      }
    }

    if (!eventData) return null;

    try {
      data = JSON.parse(eventData);
      data._eventType = eventType;
    } catch {
      data = { text: eventData, _eventType: eventType };
    }
  }

  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.chunkIndex = 0;
  }

  const eventType = data._eventType || data.event || "";

  if (eventType === "assistantResponseEvent" || data.assistantResponseEvent) {
    const content = data.assistantResponseEvent?.content || data.content || "";
    if (!content) return null;

    const openaiChunk = buildChunk(chunkMeta(state), {
      ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
      content: content
    }, null);

    state.chunkIndex++;
    return openaiChunk;
  }

  if (eventType === "reasoningContentEvent" || data.reasoningContentEvent) {
    const reasoning = data.reasoningContentEvent || data;
    const content = (typeof reasoning === "string")
      ? reasoning
      : (reasoning.text || reasoning.content || data.content || "");
    if (!content) return null;

    const openaiChunk = buildChunk(chunkMeta(state), reasoningDelta(content, state.chunkIndex === 0), null);

    state.chunkIndex++;
    return openaiChunk;
  }

  if (eventType === "toolUseEvent" || data.toolUseEvent) {
    state.hadToolUse = true;
    const toolUse = data.toolUseEvent || data;
    const toolCallId = toolUse.toolUseId || fallbackToolCallId();
    const toolName = toolUse.name || "";
    const toolInput = toolUse.input || {};

    const openaiChunk = buildChunk(chunkMeta(state), {
      ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
      tool_calls: [{
        index: 0,
        id: toolCallId,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: toolName,
          arguments: JSON.stringify(toolInput)
        }
      }]
    }, null);

    state.chunkIndex++;
    return openaiChunk;
  }

  if (eventType === "messageStopEvent" || eventType === "done" || data.messageStopEvent) {
    const finishReason = toOpenAIFinish(state.hadToolUse ? "tool_use" : "stop", "kiro");
    state.finishReason = finishReason;

    const openaiChunk = buildChunk(chunkMeta(state), {}, finishReason);

    if (state.usage && typeof state.usage === "object") {
      openaiChunk.usage = state.usage;
    }

    return openaiChunk;
  }

  if (eventType === "usageEvent" || data.usageEvent) {
    const usage = toOpenAIUsage(data.usageEvent || data, "kiro");
    if (usage) state.usage = usage;
    return null;
  }

  return null;
}

register(FORMATS.KIRO, FORMATS.OPENAI, null, kiroToOpenAIResponse);
