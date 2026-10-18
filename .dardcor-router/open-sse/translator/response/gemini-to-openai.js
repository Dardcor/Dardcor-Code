import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH, DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { encodeDataUri } from "../concerns/image.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";
import { storeGeminiThoughtSignature } from "../../services/thoughtSignatureStore.js";

function chunkMeta(state) {
  return { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model };
}

function emitFunctionCall(functionCall, state, signature = null) {
  const rawName = functionCall.name;
  const fcName = state.toolNameMap?.get(rawName) || rawName;
  const fcArgs = functionCall.args || {};
  const toolCallIndex = state.functionIndex++;
  const callId = functionCall.id || `${fcName}-${Date.now()}-${toolCallIndex}`;
  if (signature) {
    storeGeminiThoughtSignature(callId, signature, state.sessionId);
  }
  const toolCall = {
    id: callId,
    index: toolCallIndex,
    type: OPENAI_BLOCK.FUNCTION,
    function: { name: fcName, arguments: JSON.stringify(fcArgs) },
  };
  state.geminiToolCallCount = (state.geminiToolCallCount || 0) + 1;
  return buildChunk(chunkMeta(state), { tool_calls: [toolCall] }, null);
}

export function geminiToOpenAIResponse(chunk, state) {
  if (!chunk) return null;
  
  const response = chunk.response || chunk;
  if (!response || !response.candidates?.[0]) return null;

  const results = [];
  const candidate = response.candidates[0];
  const content = candidate.content;

  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || "gemini";
    state.functionIndex = 0;
    state.geminiToolCallCount = 0;
    results.push(buildChunk(chunkMeta(state), { role: ROLE.ASSISTANT }, null));
  }

  if (content?.parts) {
    for (const part of content.parts) {
      const hasThoughtSig = part.thoughtSignature || part.thought_signature;
      if (hasThoughtSig && typeof hasThoughtSig === "string") {
        state.pendingThoughtSignature = hasThoughtSig;
      }
      const isThought = part.thought === true;

      if (hasThoughtSig) {
        const hasTextContent = part.text !== undefined && part.text !== "";
        const hasFunctionCall = !!part.functionCall;

        if (!hasTextContent && !hasFunctionCall) {
          continue;
        }

        if (hasTextContent) {
          results.push(buildChunk(
            chunkMeta(state),
            isThought ? reasoningDelta(part.text) : { content: part.text },
            null
          ));
        }

        if (hasFunctionCall) {
          results.push(emitFunctionCall(part.functionCall, state, hasThoughtSig));
          state.pendingThoughtSignature = null;
        }
        continue;
      }

      if (part.text !== undefined && part.text !== "") {
        results.push(buildChunk(
          chunkMeta(state),
          isThought ? reasoningDelta(part.text) : { content: part.text },
          null
        ));
      }

      if (part.functionCall) {
        const sig = state.pendingThoughtSignature || null;
        results.push(emitFunctionCall(part.functionCall, state, sig));
        state.pendingThoughtSignature = null;
      }

      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || DEFAULT_IMAGE_MIME;
        results.push(buildChunk(
          chunkMeta(state),
          {
            images: [{
              type: OPENAI_BLOCK.IMAGE_URL,
              image_url: { url: encodeDataUri(mimeType, inlineData.data) }
            }]
          },
          null
        ));
      }
    }
  }

  const usageMeta = response.usageMetadata || chunk.usageMetadata;
  const geminiUsage = toOpenAIUsage(usageMeta, "gemini");
  if (geminiUsage) state.usage = geminiUsage;

  if (candidate.finishReason) {
    let finishReason = toOpenAIFinish(candidate.finishReason, "gemini");
    if (finishReason === OPENAI_FINISH.STOP && state.geminiToolCallCount > 0) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }
    
    const finalChunk = buildChunk(chunkMeta(state), {}, finishReason);
    
    if (state.usage) {
      finalChunk.usage = state.usage;
    }
    
    results.push(finalChunk);
    state.finishReason = finishReason;
  }

  return results.length > 0 ? results : null;
}

register(FORMATS.GEMINI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.VERTEX, FORMATS.OPENAI, null, geminiToOpenAIResponse);

