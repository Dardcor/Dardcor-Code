
import { injectSystemPrompt } from "./systemInject.js";
import { CAVEMAN_PROMPTS } from "./cavemanPrompts.js";

export function injectCaveman(body, format, level) {
  injectSystemPrompt(body, format, CAVEMAN_PROMPTS[level]);
}
