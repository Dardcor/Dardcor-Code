import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

function ensureState(state, model) {
  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.model = state.model || model || "commandcode";
    state.chunkIndex = 0;
    state.toolIndex = 0;
    state.toolIndexById = new Map();
    state.openTools = new Set();
    state.openText = false;
    state.finishReason = null;
    state.usage = null;
  }
}

function makeChunk(state, delta, finishReason = null) {
  return buildChunk(
    { id: state.responseId, created: state.created, model: state.model },
    delta,
    finishReason
  );
}

const mapFinishReason = (reason) => toOpenAIFinish(reason, "commandcode");

export function commandCodeToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  if (chunk && typeof chunk === "object" && chunk.object === "chat.completion.chunk") {
    return chunk;
  }

  let event = chunk;
  if (typeof chunk === "string") {
    const line = chunk.trim();
    if (!line) return null;
    const json = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!json || json === "[DONE]") return null;
    try {
      event = JSON.parse(json);
    } catch {
      return null;
    }
  }

  if (!event || typeof event !== "object" || !event.type) return null;

  ensureState(state, event.model);
  const out = [];

  switch (event.type) {
    case "text-delta": {
      const text = event.text || event.delta || "";
      if (!text) break;
      const delta = state.chunkIndex === 0 ? { role: ROLE.ASSISTANT, content: text } : { content: text };
      state.chunkIndex++;
      state.openText = true;
      out.push(makeChunk(state, delta));
      break;
    }
    case "reasoning-delta": {
      const text = event.text || "";
      if (!text) break;
      const delta = reasoningDelta(text, state.chunkIndex === 0);
      state.chunkIndex++;
      out.push(makeChunk(state, delta));
      break;
    }
    case "tool-input-start": {
      const id = event.id || event.toolCallId || fallbackToolCallId(state.toolIndex);
      let idx = state.toolIndexById.get(id);
      if (idx == null) {
        idx = state.toolIndex++;
        state.toolIndexById.set(id, idx);
      }
      state.openTools.add(id);
      const delta = {
        ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
        tool_calls: [{
          index: idx,
          id,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: event.toolName || "", arguments: "" },
        }],
      };
      state.chunkIndex++;
      out.push(makeChunk(state, delta));
      break;
    }
    case "tool-input-delta": {
      const id = event.id || event.toolCallId;
      const idx = state.toolIndexById.get(id);
      if (idx == null) break;
      const delta = {
        tool_calls: [{
          index: idx,
          function: { arguments: event.delta || event.inputTextDelta || "" },
        }],
      };
      out.push(makeChunk(state, delta));
      break;
    }
    case "tool-call": {
      const id = event.toolCallId;
      if (state.toolIndexById.has(id)) break;
      const idx = state.toolIndex++;
      state.toolIndexById.set(id, idx);
      const argsStr = typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {});
      const delta = {
        ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
        tool_calls: [{
          index: idx,
          id,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: event.toolName || "", arguments: argsStr },
        }],
      };
      state.chunkIndex++;
      out.push(makeChunk(state, delta));
      break;
    }
    case "finish-step": {
      state.finishReason = mapFinishReason(event.finishReason);
      if (event.usage) state.usage = event.usage;
      break;
    }
    case "finish": {
      const finishReason = state.finishReason || mapFinishReason(event.finishReason || "stop");
      const finalChunk = makeChunk(state, {}, finishReason);
      const totalUsage = event.totalUsage || state.usage;
      const usage = toOpenAIUsage(totalUsage, "commandcode");
      if (usage) finalChunk.usage = usage;
      out.push(finalChunk);
      break;
    }
    case "error": {
      state.finishReason = OPENAI_FINISH.STOP;
      const errVal = event.error ?? event.message ?? "unknown";
      const errStr = typeof errVal === "string" ? errVal : JSON.stringify(errVal);
      out.push(makeChunk(state, { content: `\n\n[CommandCode error: ${errStr}]` }));
      out.push(makeChunk(state, {}, OPENAI_FINISH.STOP));
      break;
    }
    default:
      break;
  }

  return out.length ? out : null;
}

register(FORMATS.COMMANDCODE, FORMATS.OPENAI, null, commandCodeToOpenAIResponse);
