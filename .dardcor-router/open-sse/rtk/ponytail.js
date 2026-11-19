
import { injectSystemPrompt } from "./systemInject.js";
import { PONYTAIL_PROMPTS } from "./ponytailPrompt.js";

export function injectPonytail(body, format, level) {
  injectSystemPrompt(body, format, PONYTAIL_PROMPTS[level]);
}
