import { ROLE } from "../schema/index.js";

export function reasoningDelta(text, withRole = false) {
  return withRole
    ? { role: ROLE.ASSISTANT, reasoning_content: text }
    : { reasoning_content: text };
}

export function extractReasoningText(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta.reasoning === "string" && delta.reasoning) return delta.reasoning;
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d) => (typeof d === "string" ? d : d?.text || d?.content || "")).join("");
  }
  return "";
}
