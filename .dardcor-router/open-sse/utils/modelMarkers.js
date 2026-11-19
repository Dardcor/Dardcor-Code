
const CONTEXT_MARKER = /\[1m\]$/i;

export function stripModelContextMarker(modelStr) {
  if (typeof modelStr !== "string") return { model: modelStr, contextMarker: null };
  const trimmed = modelStr.trim();
  const match = trimmed.match(CONTEXT_MARKER);
  if (!match) return { model: modelStr, contextMarker: null };
  return { model: trimmed.slice(0, -match[0].length), contextMarker: match[0].slice(1, -1).toLowerCase() };
}
