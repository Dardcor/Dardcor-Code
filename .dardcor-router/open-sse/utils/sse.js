export function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function chatChunkSse({ id, created, model, delta, finishReason = null }) {
  return sseChunk({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}
