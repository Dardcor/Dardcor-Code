import { OPENAI_BLOCK } from "../schema/index.js";

export function collapseTextParts(parts) {
  return parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT ? parts[0].text : parts;
}
