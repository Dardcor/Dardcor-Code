import { register } from "../index.js";
import { FORMATS } from "../formats.js";

export function cursorToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  if (chunk.object === "chat.completion.chunk" && chunk.choices) {
    return chunk;
  }

  if (chunk.object === "chat.completion" && chunk.choices) {
    return chunk;
  }

  return chunk;
}

register(FORMATS.CURSOR, FORMATS.OPENAI, null, cursorToOpenAIResponse);
